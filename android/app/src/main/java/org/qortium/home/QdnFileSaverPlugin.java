package org.qortium.home;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "QdnFileSaver")
public class QdnFileSaverPlugin extends Plugin {

    private static final String DEFAULT_MIME_TYPE = "application/octet-stream";

    @PluginMethod
    public void saveFile(PluginCall call) {
        String path = call.getString("path");

        if (path == null || path.trim().isEmpty()) {
            call.reject("Temporary QDN download path is required.");
            return;
        }

        String fileName = sanitizeFileName(call.getString("fileName"));
        String mimeType = getMimeType(call);

        Intent saveIntent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        saveIntent.addCategory(Intent.CATEGORY_OPENABLE);
        saveIntent.setType(mimeType);
        saveIntent.putExtra(Intent.EXTRA_TITLE, fileName);
        saveIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);

        try {
            startActivityForResult(call, saveIntent, "saveFileResult");
        } catch (ActivityNotFoundException exception) {
            call.reject("No Android document picker is available to save QDN downloads.", exception);
        }
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
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
            call.reject("QDN download was not saved.");
            return;
        }

        String path = call.getString("path");

        if (path == null || path.trim().isEmpty()) {
            call.reject("Temporary QDN download path is required.");
            return;
        }

        File sourceFile;

        try {
            sourceFile = getSafeCacheFile(path.trim());
        } catch (IllegalArgumentException | IOException exception) {
            call.reject(exception.getMessage());
            return;
        }

        long totalBytes;

        try (InputStream inputStream = new FileInputStream(sourceFile);
             OutputStream outputStream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (outputStream == null) {
                call.reject("Unable to open QDN download destination.");
                return;
            }

            byte[] buffer = new byte[8192];
            int readBytes;
            totalBytes = 0;

            while ((readBytes = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, readBytes);
                totalBytes += readBytes;
            }

            outputStream.flush();
        } catch (Exception exception) {
            call.reject("Unable to write QDN download.", exception);
            return;
        }

        // Best-effort cleanup of the temporary cache file.
        sourceFile.delete();

        JSObject response = new JSObject();
        response.put("canceled", false);
        response.put("uri", uri.toString());
        response.put("name", getDisplayName(uri, call.getString("fileName")));
        response.put("size", totalBytes);
        call.resolve(response);
    }

    @PluginMethod
    public void openSavedFile(PluginCall call) {
        String uriString = call.getString("uri");

        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("Saved file URI is required.");
            return;
        }

        Uri uri = Uri.parse(uriString.trim());
        String mimeType = getContext().getContentResolver().getType(uri);

        if (mimeType == null || mimeType.trim().isEmpty()) {
            String requested = call.getString("mimeType");
            mimeType = (requested != null && !requested.trim().isEmpty()) ? requested.trim() : "*/*";
        }

        Intent viewIntent = new Intent(Intent.ACTION_VIEW);
        viewIntent.setDataAndType(uri, mimeType);
        viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            getActivity().startActivity(Intent.createChooser(viewIntent, "Open with"));
            JSObject response = new JSObject();
            response.put("opened", true);
            call.resolve(response);
        } catch (ActivityNotFoundException exception) {
            call.reject("No app is available to open this file.", exception);
        } catch (Exception exception) {
            call.reject("Unable to open the saved file.", exception);
        }
    }

    private File getSafeCacheFile(String path) throws IOException {
        File cacheRoot = getContext().getCacheDir().getCanonicalFile();
        Uri fileUri = Uri.parse(path);
        String scheme = fileUri.getScheme();
        String resolvedPath = "file".equals(scheme) ? fileUri.getPath() : path;

        if (resolvedPath == null || resolvedPath.trim().isEmpty()) {
            throw new IllegalArgumentException("Temporary QDN download path is invalid.");
        }

        File sourceFile = new File(resolvedPath).getCanonicalFile();
        String sourcePath = sourceFile.getPath();
        String cacheRootPath = cacheRoot.getPath();

        if (!sourcePath.equals(cacheRootPath) && !sourcePath.startsWith(cacheRootPath + File.separator)) {
            throw new IllegalArgumentException("Temporary QDN download must be inside Qortium Home app cache.");
        }

        if (!sourceFile.isFile()) {
            throw new IllegalArgumentException("Temporary QDN download file was not found.");
        }

        return sourceFile;
    }

    private String getMimeType(PluginCall call) {
        String requestedMimeType = call.getString("mimeType");

        if (requestedMimeType != null && !requestedMimeType.trim().isEmpty()) {
            return requestedMimeType.trim();
        }

        return DEFAULT_MIME_TYPE;
    }

    private String sanitizeFileName(String value) {
        String fileName = value == null ? "" : value.trim().replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_");

        if (fileName.isEmpty()) {
            fileName = "qdn-download";
        }

        return fileName;
    }

    private String getDisplayName(Uri uri, String fallbackName) {
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
            // Fall back to the sanitized suggested name below.
        }

        return sanitizeFileName(fallbackName);
    }
}
