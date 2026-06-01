package org.qortium.home;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "WalletBackup")
public class WalletBackupPlugin extends Plugin {

    @PluginMethod
    public void saveWallet(PluginCall call) {
        String content = call.getString("content");
        String fileName = sanitizeFileName(call.getString("fileName"));

        if (content == null || content.trim().isEmpty()) {
            call.reject("Wallet backup content is required.");
            return;
        }

        Intent saveIntent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        saveIntent.addCategory(Intent.CATEGORY_OPENABLE);
        saveIntent.setType("application/json");
        saveIntent.putExtra(Intent.EXTRA_TITLE, fileName);
        saveIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);

        try {
            startActivityForResult(call, saveIntent, "saveWalletResult");
        } catch (ActivityNotFoundException exception) {
            call.reject("No Android document picker is available for wallet backups.", exception);
        }
    }

    @ActivityCallback
    private void saveWalletResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject response = new JSObject();
            response.put("canceled", true);
            call.resolve(response);
            return;
        }

        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();

        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("Wallet backup was not saved.");
            return;
        }

        String content = call.getString("content");
        String fileName = sanitizeFileName(call.getString("fileName"));

        if (content == null || content.trim().isEmpty()) {
            call.reject("Wallet backup content is required.");
            return;
        }

        try (OutputStream outputStream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (outputStream == null) {
                call.reject("Unable to open wallet backup destination.");
                return;
            }

            outputStream.write(content.getBytes(StandardCharsets.UTF_8));
        } catch (Exception exception) {
            call.reject("Unable to write wallet backup.", exception);
            return;
        }

        JSObject response = new JSObject();
        response.put("canceled", false);
        response.put("fileName", fileName);
        response.put("uri", uri.toString());
        call.resolve(response);
    }

    private String sanitizeFileName(String value) {
        String fileName = value == null ? "" : value.trim().replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_");

        if (fileName.isEmpty()) {
            fileName = "qortium-wallet.json";
        }

        if (!fileName.toLowerCase().endsWith(".json")) {
            fileName = fileName + ".json";
        }

        return fileName;
    }
}
