package org.qortium.home;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Iterator;
import org.json.JSONObject;

@CapacitorPlugin(name = "HomeV2ProfileRecovery")
public class HomeV2ProfileRecoveryPlugin extends Plugin {
    private static final String CAPACITOR_PREFS = "CapacitorStorage";
    private static final String CONTROL_PREFS = "HomeV2ProfileRecovery";
    private static final String BACKUP_FILE = "home-v2-recovery/profile-v1.json";

    private static String sha256(byte[] value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder result = new StringBuilder();
        for (byte item : digest) result.append(String.format("%02x", item));
        return result.toString();
    }

    private static String canonicalPreferences(JSONObject preferences) throws Exception {
        List<String> keys = new ArrayList<>();
        Iterator<String> iterator = preferences.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        Collections.sort(keys);
        JSONObject canonical = new JSONObject();
        for (String key : keys) canonical.put(key, preferences.getString(key));
        return canonical.toString();
    }

    private static JSONObject snapshot(Context context) throws Exception {
        Map<String, ?> values = context.getSharedPreferences(CAPACITOR_PREFS, 0).getAll();
        List<String> keys = new ArrayList<>(values.keySet());
        Collections.sort(keys);
        JSONObject preferences = new JSONObject();
        for (String key : keys) {
            Object value = values.get(key);
            if (!(value instanceof String)) throw new IllegalStateException("A Home preference is not a string.");
            preferences.put(key, value);
        }
        String canonical = canonicalPreferences(preferences);
        JSONObject manifest = new JSONObject();
        manifest.put("createdAtEpochMs", System.currentTimeMillis());
        manifest.put("preferences", preferences);
        manifest.put("sha256", sha256(canonical.getBytes(StandardCharsets.UTF_8)));
        manifest.put("version", 1);
        return manifest;
    }

    private static File backupFile(Context context) {
        return new File(context.getFilesDir(), BACKUP_FILE);
    }

    private static String readUtf8(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString("UTF-8");
        }
    }

    private static void writeUtf8Atomic(File target, String value) throws Exception {
        File temporary = new File(target.getPath() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        if (!temporary.renameTo(target)) throw new IllegalStateException("Unable to finalize profile backup.");
    }

    private static JSONObject readAndVerify(Context context) throws Exception {
        JSONObject manifest = new JSONObject(readUtf8(backupFile(context)));
        if (manifest.getInt("version") != 1) throw new IllegalStateException("Unsupported backup version.");
        JSONObject preferences = manifest.getJSONObject("preferences");
        String actual = sha256(canonicalPreferences(preferences).getBytes(StandardCharsets.UTF_8));
        if (!actual.equals(manifest.getString("sha256"))) throw new IllegalStateException("Backup hash mismatch.");
        return manifest;
    }

    public static boolean ensureBackupBeforeRenderer(Context context) {
        try {
            File target = backupFile(context);
            if (!target.exists()) {
                target.getParentFile().mkdirs();
                writeUtf8Atomic(target, snapshot(context).toString(2));
            }
            readAndVerify(context);
            return true;
        } catch (Exception exception) {
            return false;
        }
    }

    @PluginMethod
    public void ensureBackup(PluginCall call) {
        try {
            if (!ensureBackupBeforeRenderer(getContext())) {
                throw new IllegalStateException("Home profile backup verification failed.");
            }
            JSONObject manifest = readAndVerify(getContext());
            JSObject result = new JSObject();
            result.put("createdAtEpochMs", manifest.getLong("createdAtEpochMs"));
            result.put("ready", true);
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("Unable to create or verify the Home profile backup.", exception);
        }
    }

    @PluginMethod
    public void requestRestore(PluginCall call) {
        try {
            readAndVerify(getContext());
            getContext().getSharedPreferences(CONTROL_PREFS, 0).edit()
                    .putBoolean("restoreRequested", true).apply();
            call.resolve();
        } catch (Exception exception) {
            call.reject("No verified Home profile backup is available.", exception);
        }
    }

    public static boolean restoreIfRequested(Context context) {
        SharedPreferences control = context.getSharedPreferences(CONTROL_PREFS, 0);
        if (!control.getBoolean("restoreRequested", false)) return false;
        try {
            JSONObject manifest = readAndVerify(context);
            JSONObject preferences = manifest.getJSONObject("preferences");
            SharedPreferences.Editor editor = context.getSharedPreferences(CAPACITOR_PREFS, 0).edit().clear();
            Iterator<String> keys = preferences.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                editor.putString(key, preferences.getString(key));
            }
            if (!editor.commit()) throw new IllegalStateException("Preference restore did not commit.");
            control.edit().putBoolean("restoreRequested", false).commit();
            return true;
        } catch (Exception exception) {
            return false;
        }
    }
}
