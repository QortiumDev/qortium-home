package org.qortium.home;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/**
 * Opens one http(s) link in the system browser after Home's OPEN_EXTERNAL_LINK
 * approval.
 *
 * Deliberately an explicit ACTION_VIEW intent rather than window.open(): the
 * Capacitor WebView has no multi-window support, so a "_blank" open becomes a
 * top-level navigation, and a link that resolves to Home's own origin would
 * replace the shell instead of leaving the app. An intent can only ever hand
 * the URL to another application. The scheme is re-checked here so the plugin
 * cannot be pointed at intent:, file: or content: targets even by a caller
 * that skipped the renderer-side validation.
 */
@CapacitorPlugin(name = "ExternalLink")
public class ExternalLinkPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String raw = call.getString("url");
        if (raw == null || raw.trim().isEmpty()) {
            call.reject("A url is required.");
            return;
        }

        Uri uri;
        try {
            uri = Uri.parse(raw.trim());
        } catch (Exception exception) {
            call.reject("The link could not be parsed.");
            return;
        }

        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null || host.trim().isEmpty()) {
            call.reject("Only absolute http or https links can be opened.");
            return;
        }
        String normalizedScheme = scheme.toLowerCase(Locale.ROOT);
        if (!normalizedScheme.equals("http") && !normalizedScheme.equals("https")) {
            call.reject("Only http and https links can be opened.");
            return;
        }

        Intent viewIntent = new Intent(Intent.ACTION_VIEW, uri);
        viewIntent.addCategory(Intent.CATEGORY_BROWSABLE);
        viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getActivity().startActivity(viewIntent);
            JSObject response = new JSObject();
            response.put("opened", true);
            call.resolve(response);
        } catch (ActivityNotFoundException exception) {
            call.reject("No browser is available to open this link.", exception);
        } catch (Exception exception) {
            call.reject("Unable to open the link.", exception);
        }
    }
}
