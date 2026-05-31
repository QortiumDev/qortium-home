package org.qortium.home;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.net.URLConnection;

@CapacitorPlugin(name = "QdnFileOpener")
public class QdnFileOpenerPlugin extends Plugin {

    private static final String QDN_DOWNLOADS_DIR = "qdn-downloads";

    @PluginMethod
    public void openFile(PluginCall call) {
        String filePath = call.getString("filePath");

        if (filePath == null || filePath.trim().isEmpty()) {
            call.reject("Downloaded QDN file path is required.");
            return;
        }

        File downloadedFile;

        try {
            downloadedFile = getSafeDownloadedFile(filePath.trim());
        } catch (IllegalArgumentException | IOException exception) {
            call.reject(exception.getMessage());
            return;
        }

        Uri fileUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            downloadedFile
        );
        String mimeType = getMimeType(call, downloadedFile);
        Intent openIntent = new Intent(Intent.ACTION_VIEW);

        openIntent.setDataAndType(fileUri, mimeType);
        openIntent.setClipData(ClipData.newUri(getContext().getContentResolver(), downloadedFile.getName(), fileUri));
        openIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        Intent chooserIntent = Intent.createChooser(openIntent, "Open QDN resource");
        chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        chooserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(chooserIntent);
        } catch (ActivityNotFoundException exception) {
            call.reject("No Android app is available to open this QDN file.", exception);
            return;
        }

        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }

    private File getSafeDownloadedFile(String filePath) throws IOException {
        File downloadRoot = new File(getContext().getFilesDir(), QDN_DOWNLOADS_DIR).getCanonicalFile();
        Uri fileUri = Uri.parse(filePath);
        String scheme = fileUri.getScheme();
        String path = "file".equals(scheme) ? fileUri.getPath() : filePath;

        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("Downloaded QDN file path is invalid.");
        }

        File downloadedFile = new File(path).getCanonicalFile();
        String downloadedPath = downloadedFile.getPath();
        String downloadRootPath = downloadRoot.getPath();

        if (!downloadedPath.equals(downloadRootPath) && !downloadedPath.startsWith(downloadRootPath + File.separator)) {
            throw new IllegalArgumentException("Downloaded QDN file must be inside Qortium Home app data.");
        }

        if (!downloadedFile.isFile()) {
            throw new IllegalArgumentException("Downloaded QDN file was not found.");
        }

        return downloadedFile;
    }

    private String getMimeType(PluginCall call, File downloadedFile) {
        String requestedMimeType = call.getString("mimeType");

        if (requestedMimeType != null && !requestedMimeType.trim().isEmpty()) {
            return requestedMimeType.trim();
        }

        String guessedMimeType = URLConnection.guessContentTypeFromName(downloadedFile.getName());

        return guessedMimeType != null ? guessedMimeType : "*/*";
    }
}
