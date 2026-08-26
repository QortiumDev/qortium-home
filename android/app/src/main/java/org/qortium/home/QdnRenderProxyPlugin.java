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
        // Round 6 (owner-directed redesign): a Home v2 app tab's registered
        // authorized document, registered here from the SHELL's own trusted
        // render URL (AppTabStage.tsx's resolved.url, never anything the app
        // itself reports), is what QdnRenderProxy/QdnBridgeWebViewClient use
        // to gate both the live bridge token (exact-URL match — see
        // QdnRenderProxy.isExactAuthorizedRenderDocument) and data-read
        // containment (see QdnRenderProxy.isAuthorizedAppResource). Absent
        // (null) for non-app-tab callers (v1's own use of this plugin), which
        // enforces neither, unchanged.
        String authorizedDocumentUrl = call.getString("authorizedDocumentUrl");
        String proxyOrigin = QdnRenderProxy.authorize(
            call.getString("origin"),
            homeV2,
            authorizedDocumentUrl
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

    @PluginMethod
    public void authorizeStream(PluginCall call) {
        String streamUrl = QdnRenderProxy.authorizeStream(
            call.getString("origin"),
            call.getString("resourceUrl"),
            call.getString("mimeType"),
            call.getString("binding"),
            Boolean.TRUE.equals(call.getBoolean("shellStream", false))
        );
        if (streamUrl == null) {
            call.reject("An exact public QDN render URL and capability binding are required.");
            return;
        }
        JSObject result = new JSObject();
        result.put("streamUrl", streamUrl);
        call.resolve(result);
    }

    @PluginMethod
    public void authorizePrivateBytes(PluginCall call) {
        String streamUrl = QdnRenderProxy.authorizePrivateBytes(
            call.getString("dataBase64"),
            call.getString("mimeType"),
            call.getString("binding")
        );
        if (streamUrl == null) {
            call.reject("Bounded private attachment bytes and a capability binding are required.");
            return;
        }
        JSObject result = new JSObject();
        result.put("streamUrl", streamUrl);
        call.resolve(result);
    }

    @PluginMethod
    public void releaseStreams(PluginCall call) {
        QdnRenderProxy.releaseStreams(call.getString("binding"));
        call.resolve();
    }
}
