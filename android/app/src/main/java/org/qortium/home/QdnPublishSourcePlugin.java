package org.qortium.home;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "QdnPublishSource")
public class QdnPublishSourcePlugin extends Plugin {
    private static final int DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

    @PluginMethod
    public void selectFile(PluginCall call) {
        Intent openIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        openIntent.addCategory(Intent.CATEGORY_OPENABLE);
        openIntent.setType("*/*");
        openIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            startActivityForResult(call, openIntent, "selectFileResult");
        } catch (ActivityNotFoundException exception) {
            call.reject("No Android document picker is available for QDN publish files.", exception);
        }
    }

    @ActivityCallback
    private void selectFileResult(PluginCall call, ActivityResult result) {
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
            call.reject("QDN publish file was not selected.");
            return;
        }

        int maxBytes = call.getInt("maxBytes", DEFAULT_MAX_BYTES);

        try {
            byte[] bytes = readUriBytes(uri, maxBytes);
            JSObject response = new JSObject();
            response.put("canceled", false);
            response.put("dataBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            response.put("fileName", getDisplayName(uri));
            response.put("mimeType", getContext().getContentResolver().getType(uri));
            response.put("size", bytes.length);
            response.put("uri", uri.toString());
            call.resolve(response);
        } catch (Exception exception) {
            call.reject(exception.getMessage() == null ? "Unable to read QDN publish file." : exception.getMessage(), exception);
        }
    }

    private byte[] readUriBytes(Uri uri, int maxBytes) throws Exception {
        try (InputStream inputStream = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            if (inputStream == null) {
                throw new Exception("Unable to open QDN publish file.");
            }

            byte[] buffer = new byte[8192];
            int totalBytes = 0;
            int readBytes;

            while ((readBytes = inputStream.read(buffer)) != -1) {
                totalBytes += readBytes;

                if (maxBytes > 0 && totalBytes > maxBytes) {
                    throw new Exception("Selected QDN publish file is too large.");
                }

                outputStream.write(buffer, 0, readBytes);
            }

            return outputStream.toByteArray();
        }
    }

    private String getDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);

                if (nameIndex >= 0) {
                    String displayName = cursor.getString(nameIndex);

                    if (displayName != null && !displayName.trim().isEmpty()) {
                        return displayName.trim();
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall back to the URI path below.
        }

        String path = uri.getLastPathSegment();

        return path == null || path.trim().isEmpty() ? "qdn-resource" : path.trim();
    }
}
