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
        String proxyOrigin = QdnRenderProxy.authorize(call.getString("origin"));

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
