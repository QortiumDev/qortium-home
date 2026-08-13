package org.qortium.home;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets Home authorize the node origin whose QDN render content may be served
 * through the in-app https proxy. See {@link QdnRenderProxy} for why the proxy
 * exists and why only authorized origins are served.
 */
@CapacitorPlugin(name = "QdnRenderProxy")
public class QdnRenderProxyPlugin extends Plugin {

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean homeV2 = Boolean.TRUE.equals(call.getBoolean("homeV2"));
        // Fix 2 (Sol re-review #2): a Home v2 app tab's launch identity,
        // registered here, is what QdnRenderProxy/QdnBridgeWebViewClient use
        // to refuse serving a different app's render content into this
        // origin's WebView — see QdnRenderProxy.isSameActiveAppTabResource.
        // Both are absent (null) for non-app-tab callers (v1's own use of
        // this plugin), which enforces no per-tab identity, unchanged.
        String appName = call.getString("appName");
        String appIdentifier = call.getString("appIdentifier");
        String initialPathname = call.getString("initialPathname");
        String proxyOrigin = QdnRenderProxy.authorize(
            call.getString("origin"),
            homeV2,
            appName,
            appIdentifier,
            initialPathname
        );

        if (proxyOrigin == null) {
            call.reject("An http(s) node origin is required to authorize the QDN render proxy.");
            return;
        }

        JSObject result = new JSObject();

        result.put("proxyOrigin", proxyOrigin);
        call.resolve(result);
    }

    @PluginMethod
    public void release(PluginCall call) {
        QdnRenderProxy.release(call.getString("origin"));
        call.resolve();
    }
}
