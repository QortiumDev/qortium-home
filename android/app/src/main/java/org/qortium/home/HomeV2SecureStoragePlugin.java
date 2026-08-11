package org.qortium.home;

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
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "HomeV2SecureStorage")
public class HomeV2SecureStoragePlugin extends Plugin {
    private static final String KEY_ALIAS = "qortium-home-v2-remembered-unlock";
    private static final String PREFS = "HomeV2SecureStorage";

    private SecretKey getOrCreateKey() throws Exception {
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

    private String preferenceKey(String accountId) {
        return "account:" + accountId;
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
            getContext().getSharedPreferences(PREFS, 0).edit()
                    .putString(preferenceKey(accountId), stored).apply();
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
        String stored = getContext().getSharedPreferences(PREFS, 0)
                .getString(preferenceKey(accountId), null);
        JSObject result = new JSObject();
        if (stored == null) {
            result.put("value", JSONObject.NULL);
            call.resolve(result);
            return;
        }
        try {
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
                result.put("value", new String(plaintext, StandardCharsets.UTF_8));
            } finally {
                Arrays.fill(plaintext, (byte) 0);
            }
            call.resolve(result);
        } catch (Exception exception) {
            getContext().getSharedPreferences(PREFS, 0).edit()
                    .remove(preferenceKey(accountId)).apply();
            result.put("value", JSONObject.NULL);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String accountId = call.getString("accountId");
        if (accountId != null) {
            getContext().getSharedPreferences(PREFS, 0).edit()
                    .remove(preferenceKey(accountId)).apply();
        }
        call.resolve();
    }
}
