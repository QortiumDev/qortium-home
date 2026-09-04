package org.qortium.home;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "HomeV2SecureStorage")
public class HomeV2SecureStoragePlugin extends Plugin {
    static final String ADMIN_CREDENTIAL_ID = "home-v2-qortium-node-api-key-v1";
    private static final String KEY_ALIAS = "qortium-home-v2-remembered-unlock";
    private static final String PREFS = "HomeV2SecureStorage";

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        java.security.Key key = keyStore.getKey(KEY_ALIAS, null);
        if (key instanceof SecretKey) return (SecretKey) key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    private static String preferenceKey(String accountId) {
        return "account:" + accountId;
    }

    static void writeProtectedValue(Context context, String accountId, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        cipher.updateAAD(accountId.getBytes(StandardCharsets.UTF_8));
        byte[] plaintext = value.getBytes(StandardCharsets.UTF_8);
        byte[] encrypted;
        try {
            encrypted = cipher.doFinal(plaintext);
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
        String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." +
                Base64.encodeToString(encrypted, Base64.NO_WRAP);
        context.getSharedPreferences(PREFS, 0).edit()
                .putString(preferenceKey(accountId), stored).apply();
    }

    static String readProtectedValue(Context context, String accountId) throws Exception {
        String stored = context.getSharedPreferences(PREFS, 0)
                .getString(preferenceKey(accountId), null);
        if (stored == null) return null;
        String[] parts = stored.split("\\.", 2);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid ciphertext.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        cipher.updateAAD(accountId.getBytes(StandardCharsets.UTF_8));
        byte[] plaintext = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
        try {
            return new String(plaintext, StandardCharsets.UTF_8);
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
    }

    static void removeProtectedValue(Context context, String accountId) {
        context.getSharedPreferences(PREFS, 0).edit()
                .remove(preferenceKey(accountId)).apply();
    }

    private static String createBindingId() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        StringBuilder value = new StringBuilder(32);
        for (byte item : bytes) value.append(String.format("%02x", item & 0xff));
        Arrays.fill(bytes, (byte) 0);
        return value.toString();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        try {
            getOrCreateKey();
            JSObject result = new JSObject();
            result.put("available", true);
            call.resolve(result);
        } catch (Exception exception) {
            JSObject result = new JSObject();
            result.put("available", false);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void wrap(PluginCall call) {
        String accountId = call.getString("accountId");
        String value = call.getString("value");
        if (accountId == null || accountId.trim().isEmpty() || value == null || value.isEmpty()) {
            call.reject("Account and unlock material are required.");
            return;
        }
        try {
            writeProtectedValue(getContext(), accountId, value);
            call.resolve();
        } catch (Exception exception) {
            call.reject("Unable to protect remembered unlock material.", exception);
        }
    }

    @PluginMethod
    public void unwrap(PluginCall call) {
        String accountId = call.getString("accountId");
        if (accountId == null || accountId.trim().isEmpty()) {
            call.reject("Account is required.");
            return;
        }
        if (ADMIN_CREDENTIAL_ID.equals(accountId)) {
            call.reject("Administrative credentials cannot be unwrapped into JavaScript.");
            return;
        }
        JSObject result = new JSObject();
        try {
            String value = readProtectedValue(getContext(), accountId);
            result.put("value", value == null ? JSONObject.NULL : value);
            call.resolve(result);
        } catch (Exception exception) {
            removeProtectedValue(getContext(), accountId);
            result.put("value", JSONObject.NULL);
            call.resolve(result);
        }
    }

    /**
     * Returns only non-secret routing metadata from the protected Qortium
     * admin record. The API key is deliberately never placed in a JSObject.
     * Records predating binding ids are upgraded entirely in native code.
     */
    @PluginMethod
    public void describeAdminRecord(PluginCall call) {
        String accountId = call.getString("accountId");
        if (!ADMIN_CREDENTIAL_ID.equals(accountId)) {
            call.reject("Credential identifier is required.");
            return;
        }
        JSObject result = new JSObject();
        try {
            String value = readProtectedValue(getContext(), accountId);
            if (value == null) {
                result.put("present", false);
                call.resolve(result);
                return;
            }
            JSONObject record = new JSONObject(value);
            String apiKey = record.optString("apiKey", "").trim();
            String nodeApiUrl = record.optString("nodeApiUrl", "");
            if (record.optInt("version", 0) != 1 || apiKey.isEmpty() ||
                    apiKey.length() > 512 || nodeApiUrl.isEmpty()) {
                throw new IllegalArgumentException("Invalid administrative credential.");
            }
            String bindingId = record.optString("bindingId", "");
            if (!bindingId.matches("^[0-9a-f]{32}$")) {
                bindingId = createBindingId();
                record.put("bindingId", bindingId);
                writeProtectedValue(getContext(), accountId, record.toString());
            }
            result.put("bindingId", bindingId);
            result.put("nodeApiUrl", nodeApiUrl);
            result.put("present", true);
            call.resolve(result);
        } catch (Exception exception) {
            removeProtectedValue(getContext(), accountId);
            result.put("present", false);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String accountId = call.getString("accountId");
        if (accountId != null) {
            removeProtectedValue(getContext(), accountId);
        }
        call.resolve();
    }
}
