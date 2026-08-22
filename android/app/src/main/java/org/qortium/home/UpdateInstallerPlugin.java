package org.qortium.home;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

@CapacitorPlugin(name = "UpdateInstaller")
public class UpdateInstallerPlugin extends Plugin {

    private static final String UPDATE_DOWNLOADS_DIR = "app-updates";

    @PluginMethod
    public void installApk(PluginCall call) {
        String filePath = call.getString("filePath");
        String expectedDigest = call.getString("expectedDigest");

        if (filePath == null || filePath.trim().isEmpty()) {
            call.reject("Downloaded update path is required.");
            return;
        }

        if (expectedDigest == null || !expectedDigest.matches("^sha256:[a-fA-F0-9]{64}$")) {
            call.reject("A verified SHA-256 digest is required before installing an update.");
            return;
        }

        File apkFile;

        try {
            apkFile = getSafeApkFile(filePath.trim());
            verifyDigest(apkFile, expectedDigest.toLowerCase(Locale.ROOT));
        } catch (IllegalArgumentException | IOException exception) {
            call.reject(exception.getMessage());
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            openUnknownAppsSettings();
            call.reject("Allow Qortium Home to install unknown apps, then tap Install APK again.");
            return;
        }

        Uri apkUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apkFile
        );

        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(installIntent);
        } catch (ActivityNotFoundException exception) {
            call.reject("No Android package installer is available.", exception);
            return;
        }

        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }

    private void verifyDigest(File apkFile, String expectedDigest) throws IOException {
        final MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new IOException("SHA-256 verification is unavailable.", exception);
        }

        byte[] buffer = new byte[64 * 1024];
        try (FileInputStream input = new FileInputStream(apkFile)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }

        String expectedHex = expectedDigest.substring("sha256:".length());
        byte[] expected = hexToBytes(expectedHex);
        if (!MessageDigest.isEqual(expected, digest.digest())) {
            throw new IllegalArgumentException("Downloaded update no longer matches its verified SHA-256 digest.");
        }
    }

    private byte[] hexToBytes(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int index = 0; index < value.length(); index += 2) {
            result[index / 2] = (byte) Integer.parseInt(value.substring(index, index + 2), 16);
        }
        return result;
    }

    private File getSafeApkFile(String filePath) throws IOException {
        File updateRoot = new File(getContext().getFilesDir(), UPDATE_DOWNLOADS_DIR).getCanonicalFile();
        Uri fileUri = Uri.parse(filePath);
        String scheme = fileUri.getScheme();
        String path = "file".equals(scheme) ? fileUri.getPath() : filePath;

        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("Downloaded update path is invalid.");
        }

        File apkFile = new File(path).getCanonicalFile();
        String apkPath = apkFile.getPath();
        String updateRootPath = updateRoot.getPath();

        if (!apkPath.equals(updateRootPath) && !apkPath.startsWith(updateRootPath + File.separator)) {
            throw new IllegalArgumentException("Downloaded update must be inside Qortium Home app data.");
        }

        if (!apkFile.getName().toLowerCase().endsWith(".apk")) {
            throw new IllegalArgumentException("Downloaded update must be an APK file.");
        }

        if (!apkFile.isFile()) {
            throw new IllegalArgumentException("Downloaded update file was not found.");
        }

        return apkFile;
    }

    private void openUnknownAppsSettings() {
        Intent settingsIntent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(settingsIntent);
        } catch (ActivityNotFoundException ignored) {
            Intent fallbackIntent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallbackIntent);
        }
    }
}
