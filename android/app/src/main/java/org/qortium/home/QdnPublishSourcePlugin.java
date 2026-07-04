package org.qortium.home;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

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

    @PluginMethod
    public void selectDirectory(PluginCall call) {
        Intent openIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        openIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        openIntent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        openIntent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);

        try {
            startActivityForResult(call, openIntent, "selectDirectoryResult");
        } catch (ActivityNotFoundException exception) {
            call.reject("No Android folder picker is available for QDN preview folders.", exception);
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

    @ActivityCallback
    private void selectDirectoryResult(PluginCall call, ActivityResult result) {
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
            call.reject("QDN preview folder was not selected.");
            return;
        }

        int permissionFlags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;

        if (permissionFlags != 0) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, permissionFlags);
            } catch (Exception ignored) {
                // Temporary read permission from the picker is enough for this preview upload.
            }
        }

        int maxBytes = call.getInt("maxBytes", DEFAULT_MAX_BYTES);

        try {
            DocumentFile directory = DocumentFile.fromTreeUri(getContext(), uri);

            if (directory == null || !directory.isDirectory()) {
                throw new Exception("Selected QDN preview source is not a folder.");
            }

            DirectoryArchive archive = zipDirectory(directory, maxBytes);
            JSObject response = new JSObject();
            response.put("canceled", false);
            response.put("dataBase64", Base64.encodeToString(archive.bytes, Base64.NO_WRAP));
            response.put("fileName", getDirectoryArchiveName(directory, uri));
            response.put("mimeType", "application/zip");
            response.put("size", archive.bytes.length);
            response.put("uri", uri.toString());
            call.resolve(response);
        } catch (Exception exception) {
            call.reject(exception.getMessage() == null ? "Unable to read QDN preview folder." : exception.getMessage(), exception);
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

    private DirectoryArchive zipDirectory(DocumentFile directory, int maxBytes) throws Exception {
        DirectoryArchiveState state = new DirectoryArchiveState(maxBytes);

        try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
             ZipOutputStream zipOutputStream = new ZipOutputStream(outputStream)) {
            state.outputStream = outputStream;
            state.zipOutputStream = zipOutputStream;

            for (DocumentFile child : directory.listFiles()) {
                addDocumentToZip(child, "", state);
            }

            zipOutputStream.finish();

            if (state.fileCount == 0) {
                throw new Exception("Selected QDN preview folder is empty.");
            }

            if (!state.hasRootIndex) {
                throw new Exception("Selected QDN preview folder must contain index.html or index.htm at its top level.");
            }

            byte[] bytes = outputStream.toByteArray();

            if (maxBytes > 0 && bytes.length > maxBytes) {
                throw new Exception("Selected QDN preview folder is too large.");
            }

            return new DirectoryArchive(bytes);
        }
    }

    private void addDocumentToZip(DocumentFile document, String parentPath, DirectoryArchiveState state) throws Exception {
        String name = sanitizeZipEntrySegment(document.getName());

        if (name.isEmpty()) {
            return;
        }

        String entryPath = parentPath.isEmpty() ? name : parentPath + "/" + name;

        if (document.isDirectory()) {
            for (DocumentFile child : document.listFiles()) {
                addDocumentToZip(child, entryPath, state);
            }
            return;
        }

        if (!document.isFile()) {
            return;
        }

        if (parentPath.isEmpty()) {
            String lowerName = name.toLowerCase(Locale.US);
            state.hasRootIndex = state.hasRootIndex || lowerName.equals("index.html") || lowerName.equals("index.htm");
        }

        ZipEntry zipEntry = new ZipEntry(entryPath);
        state.zipOutputStream.putNextEntry(zipEntry);

        try (InputStream inputStream = getContext().getContentResolver().openInputStream(document.getUri())) {
            if (inputStream == null) {
                throw new Exception("Unable to open QDN preview folder file: " + entryPath);
            }

            byte[] buffer = new byte[8192];
            int readBytes;

            while ((readBytes = inputStream.read(buffer)) != -1) {
                state.totalInputBytes += readBytes;

                if (state.maxBytes > 0 && state.totalInputBytes > state.maxBytes) {
                    throw new Exception("Selected QDN preview folder is too large.");
                }

                state.zipOutputStream.write(buffer, 0, readBytes);

                if (state.maxBytes > 0 && state.outputStream.size() > state.maxBytes) {
                    throw new Exception("Selected QDN preview folder is too large.");
                }
            }
        } finally {
            state.zipOutputStream.closeEntry();
        }

        state.fileCount += 1;
    }

    private String sanitizeZipEntrySegment(String value) {
        if (value == null) {
            return "";
        }

        String sanitized = value.replace('\\', '/');
        int slashIndex = sanitized.lastIndexOf('/');

        if (slashIndex >= 0) {
            sanitized = sanitized.substring(slashIndex + 1);
        }

        sanitized = sanitized.replaceAll("[\\x00-\\x1F]", "_").trim();

        if (sanitized.equals(".") || sanitized.equals("..")) {
            return "";
        }

        return sanitized;
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

    private String getDirectoryArchiveName(DocumentFile directory, Uri uri) {
        String name = directory.getName();

        if (name == null || name.trim().isEmpty()) {
            name = getDisplayName(uri);
        }

        name = sanitizeResponseFileName(name, "qdn-preview-folder");

        if (name.toLowerCase(Locale.US).endsWith(".zip")) {
            return name;
        }

        return name + ".zip";
    }

    private String sanitizeResponseFileName(String value, String fallback) {
        if (value == null) {
            return fallback;
        }

        String sanitized = value.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1F]", "_").replaceAll("\\s+", " ").trim();

        return sanitized.isEmpty() ? fallback : sanitized;
    }

    private static class DirectoryArchive {
        private final byte[] bytes;

        private DirectoryArchive(byte[] bytes) {
            this.bytes = bytes;
        }
    }

    private static class DirectoryArchiveState {
        private final int maxBytes;
        private ByteArrayOutputStream outputStream;
        private ZipOutputStream zipOutputStream;
        private int totalInputBytes = 0;
        private int fileCount = 0;
        private boolean hasRootIndex = false;

        private DirectoryArchiveState(int maxBytes) {
            this.maxBytes = maxBytes;
        }
    }
}
