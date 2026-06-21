import Capacitor
import Foundation
import WebKit

// iOS equivalent of android/.../QdnBridgeWebViewClient.java.
//
// Android injects the QDN bridge by intercepting the /render/APP|WEBSITE iframe
// HTTP response and inserting a <script>. iOS WKWebView cannot intercept http(s)
// responses, so instead we register an all-frames WKUserScript at document start.
// App-injected user scripts run regardless of the page CSP, so (unlike Android)
// we do not need to strip Content-Security-Policy headers.
//
// The bridge talks to the parent renderer purely via DOM postMessage
// (qortium:qdn-request / qortium:qdn-response) — there is NO native round-trip
// for the messages themselves; the existing handler in src/QdnViewer.tsx works
// unchanged. This plugin's only job is getting the script into the QDN frame.
//
// As a CAPBridgedPlugin it auto-registers (no AppDelegate wiring). It exposes no
// JS methods; `load()` fires once the bridge/webview exists.
//
// STATUS: staged, NOT yet verified on device. Confirm (1) the QDN app loads as an
// http iframe inside capacitor://localhost, (2) the user script is injected into
// that subframe, (3) cross-origin postMessage('*') reaches the parent.
@objc(QdnBridgePlugin)
public class QdnBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QdnBridgePlugin"
    public let jsName = "QdnBridge"
    public let pluginMethods: [CAPPluginMethod] = []

    override public func load() {
        guard let controller = bridge?.webView?.configuration.userContentController else { return }

        let userScript = WKUserScript(
            source: Self.bridgeSource,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        controller.addUserScript(userScript)
    }

    // Faithful port of QdnBridgeWebViewClient.getQdnBridgeTag(), with two changes
    // for the user-script model: it self-gates to /render/(APP|WEBSITE)/ frames,
    // and it reads the bridge token from the frame's own ?qdnHomeBridge= query
    // param instead of having the token baked in at injection time.
    private static let bridgeSource = #"""
    (function(){
      if (typeof window.qdnRequest === 'function') return;
      if (!/^\/render\/(APP|WEBSITE)\//i.test(location.pathname)) return;
      var bridgeToken = new URLSearchParams(location.search).get('qdnHomeBridge') || '';
      if (!/^[A-Za-z0-9._-]{16,128}$/.test(bridgeToken)) return;
      var nextRequestId = 0; var pending = {};
      window.addEventListener('message', function(event){
        var data = event.data;
        if (!data || data.type !== 'qortium:qdn-response' || data.bridgeToken !== bridgeToken || typeof data.requestId !== 'string') return;
        var entry = pending[data.requestId]; if (!entry) return;
        delete pending[data.requestId]; clearTimeout(entry.timeoutId);
        if (data.error) { var message = data.error.message || data.error.error || 'QDN app request failed.'; entry.reject(new Error(message)); return; }
        entry.resolve(data.result);
      });
      Object.defineProperty(window, 'qdnRequest', { configurable:false, enumerable:true, writable:false, value:function(request){
        return new Promise(function(resolve, reject){
          if (!window.parent || window.parent === window) { reject(new Error('QDN app bridge is unavailable.')); return; }
          var requestId = String(Date.now()) + '-' + String(++nextRequestId);
          var action = request && typeof request === 'object' ? String(request.action || '').toUpperCase() : '';
          var longActions = {PUBLISH_MULTIPLE_QDN_RESOURCES:1,PUBLISH_QDN_RESOURCE:1,DELETE_QDN_RESOURCE:1,APPROVE_GROUP_JOIN_REQUEST:1,INVITE_TO_GROUP:1,JOIN_GROUP:1,LEAVE_GROUP:1,UPDATE_GROUP:1,BUY_NAME:1,CANCEL_SELL_NAME:1,REGISTER_NAME:1,SELL_NAME:1,UPDATE_NAME:1,SEND_CHAT_MESSAGE:1,UNLOCK_SELECTED_ACCOUNT:1,GET_PRIVATE_DIRECT_ACTIVE_CHATS:1,GET_PRIVATE_GROUP_ACTIVE_CHATS:1,SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES:1,SEARCH_PRIVATE_GROUP_CHAT_MESSAGES:1};
          var timeoutMs = longActions[action] ? 180000 : 30000;
          var timeoutId = setTimeout(function(){ delete pending[requestId]; reject(new Error('QDN app request timed out.')); }, timeoutMs);
          pending[requestId] = { resolve:resolve, reject:reject, timeoutId:timeoutId };
          window.parent.postMessage({ type:'qortium:qdn-request', bridgeToken:bridgeToken, requestId:requestId, request:request }, '*');
        });
      }});
    })();
    """#
}
