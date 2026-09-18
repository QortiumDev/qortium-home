package org.qortium.home;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Settings > Developer "Allow remote debugging of app tabs" switch.
 *
 * WebView.setWebContentsDebuggingEnabled is process-wide: it exposes every
 * WebView in the app (the Home shell and every app tab share the one WebView)
 * to chrome://inspect over USB. It used to be on only for debuggable builds;
 * this plugin lets a release build opt in, persisted in its own preference
 * file (NOT CapacitorStorage, so a restored profile backup never silently
 * re-enables it) and applied again at startup before the WebView loads.
 * A debuggable build stays always-on, exactly as before.
 */
@CapacitorPlugin(name = "RemoteDebugging")
public class RemoteDebuggingPlugin extends Plugin {
    private static final String PREFS = "HomeV2RemoteDebugging";
    private static final String KEY_ENABLED = "enabled";

    private static boolean isDebuggableBuild(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private static boolean isEnabledPreference(Context context) {
        return context.getSharedPreferences(PREFS, 0).getBoolean(KEY_ENABLED, false);
    }

    private static void apply(Context context) {
        WebView.setWebContentsDebuggingEnabled(isDebuggableBuild(context) || isEnabledPreference(context));
    }

    /** Called from MainActivity.onCreate before the bridge creates the WebView. */
    public static void applyOnStartup(Context context) {
        apply(context);
    }

    private JSObject state() {
        Context context = getContext();
        boolean alwaysOn = isDebuggableBuild(context);
        JSObject result = new JSObject();
        result.put("alwaysOn", alwaysOn);
        result.put("enabled", alwaysOn || isEnabledPreference(context));
        return result;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled must be a boolean.");
            return;
        }
        Context context = getContext();
        if (!context.getSharedPreferences(PREFS, 0).edit().putBoolean(KEY_ENABLED, enabled).commit()) {
            call.reject("Unable to save the remote debugging setting.");
            return;
        }
        apply(context);
        call.resolve(state());
    }
}
