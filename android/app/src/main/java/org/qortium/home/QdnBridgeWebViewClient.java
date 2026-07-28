package org.qortium.home;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class QdnBridgeWebViewClient extends BridgeWebViewClient {

    private static final int REQUEST_TIMEOUT_MS = 30000;
    private static final String QDN_BRIDGE_QUERY_PARAM = "qdnHomeBridge";

    public QdnBridgeWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        // Proxied QDN requests are checked first: they use a host Capacitor does not
        // know, and its fallback would answer them with the app shell.
        if (request != null && QdnRenderProxy.isProxyUrl(request.getUrl())) {
            return serveProxiedQdnRequest(request);
        }

        WebResourceResponse capacitorResponse = super.shouldInterceptRequest(view, request);

        if (capacitorResponse != null) {
            return capacitorResponse;
        }

        if (!shouldInjectQdnBridge(request)) {
            return null;
        }

        try {
            return fetchAndInjectQdnBridge(request);
        } catch (IOException ignored) {
            return null;
        }
    }

    /**
     * Serves a request made against the QDN proxy origin from the node the view's
     * token was authorized for. An unauthorized token is refused rather than
     * passed through, so the proxy can never reach an origin Home did not choose.
     */
    private WebResourceResponse serveProxiedQdnRequest(WebResourceRequest request) {
        String upstreamUrl = QdnRenderProxy.resolveUpstreamUrl(request.getUrl());

        if (upstreamUrl == null) {
            return forbiddenResponse();
        }

        try {
            // The bridge token still travels in the query, exactly as it does for a
            // direct render request; only the origin the page loads from changed.
            String bridgeToken = request.getUrl().getQueryParameter(QDN_BRIDGE_QUERY_PARAM);

            return fetchUpstream(request, upstreamUrl, bridgeToken);
        } catch (IOException ignored) {
            return null;
        }
    }

    private WebResourceResponse forbiddenResponse() {
        byte[] body = "QDN render proxy request was not authorized.".getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = new HashMap<>();

        headers.put("Cache-Control", "no-store");

        return new WebResourceResponse(
            "text/plain",
            StandardCharsets.UTF_8.name(),
            403,
            "Forbidden",
            headers,
            new ByteArrayInputStream(body)
        );
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request == null || request.isForMainFrame()) {
            return super.shouldOverrideUrlLoading(view, request);
        }

        Uri url = request.getUrl();

        if (QdnRenderProxy.isProxyUrl(url)) {
            return false;
        }

        if (!isHttpScheme(url.getScheme())) {
            return true;
        }

        return !isQdnRenderUrl(url);
    }

    private boolean shouldInjectQdnBridge(WebResourceRequest request) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return false;
        }

        Uri url = request.getUrl();

        if (!isQdnRenderUrl(url) || !hasValidBridgeToken(url)) {
            return false;
        }

        String accept = getRequestHeader(request, "Accept");

        return accept.isEmpty() || accept.toLowerCase(Locale.ROOT).contains("text/html");
    }

    private WebResourceResponse fetchAndInjectQdnBridge(WebResourceRequest request) throws IOException {
        return fetchUpstream(request, request.getUrl().toString(), request.getUrl().getQueryParameter(QDN_BRIDGE_QUERY_PARAM));
    }

    private WebResourceResponse fetchUpstream(WebResourceRequest request, String upstreamUrl, String bridgeToken)
        throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(upstreamUrl).openConnection();

        connection.setConnectTimeout(REQUEST_TIMEOUT_MS);
        connection.setReadTimeout(REQUEST_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestMethod("GET");

        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
            String name = header.getKey();

            if (
                name == null ||
                header.getValue() == null ||
                "Accept-Encoding".equalsIgnoreCase(name) ||
                "Host".equalsIgnoreCase(name)
            ) {
                continue;
            }

            connection.setRequestProperty(name, header.getValue());
        }

        connection.setRequestProperty("Accept-Encoding", "identity");

        int statusCode = connection.getResponseCode();
        String reasonPhrase = connection.getResponseMessage();
        String contentType = connection.getContentType();
        byte[] responseBytes = readAllBytes(getResponseStream(connection, statusCode));
        Map<String, String> responseHeaders = getResponseHeaders(connection);

        if (isHtmlContentType(contentType)) {
            Charset charset = getCharset(contentType);
            String html = new String(responseBytes, charset);

            responseBytes = injectQdnBridge(html, bridgeToken == null ? "" : bridgeToken).getBytes(charset);
            removeHeader(responseHeaders, "Content-Length");
            removeHeader(responseHeaders, "Content-Encoding");
            removeHeader(responseHeaders, "Transfer-Encoding");
            removeHeader(responseHeaders, "Content-Security-Policy");
            removeHeader(responseHeaders, "X-Content-Security-Policy");
            responseHeaders.put("Referrer-Policy", "no-referrer");
        }

        return new WebResourceResponse(
            getMimeType(contentType),
            getCharset(contentType).name(),
            statusCode,
            reasonPhrase == null ? getReasonPhrase(statusCode) : reasonPhrase,
            responseHeaders,
            new ByteArrayInputStream(responseBytes)
        );
    }

    private String getRequestHeader(WebResourceRequest request, String expectedName) {
        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
            if (expectedName.equalsIgnoreCase(header.getKey())) {
                return header.getValue() == null ? "" : header.getValue();
            }
        }

        return "";
    }

    private InputStream getResponseStream(HttpURLConnection connection, int statusCode) throws IOException {
        InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();

        return stream == null ? new ByteArrayInputStream(new byte[0]) : stream;
    }

    private byte[] readAllBytes(InputStream stream) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;

            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }

            return output.toByteArray();
        }
    }

    private boolean isHttpScheme(String scheme) {
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    private boolean isQdnRenderUrl(Uri url) {
        if (!isHttpScheme(url.getScheme())) {
            return false;
        }

        List<String> pathSegments = url.getPathSegments();

        if (pathSegments.size() < 3 || !"render".equals(pathSegments.get(0))) {
            return false;
        }

        String service = pathSegments.get(1).toUpperCase(Locale.ROOT);

        return "APP".equals(service) || "WEBSITE".equals(service) || "GAME".equals(service) || "HASH".equals(service);
    }

    private boolean hasValidBridgeToken(Uri url) {
        String bridgeToken = url.getQueryParameter(QDN_BRIDGE_QUERY_PARAM);

        return bridgeToken != null && bridgeToken.matches("[A-Za-z0-9._-]{16,128}");
    }

    private Map<String, String> getResponseHeaders(HttpURLConnection connection) {
        Map<String, String> headers = new HashMap<>();

        for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
            if (header.getKey() == null || header.getValue() == null || header.getValue().isEmpty()) {
                continue;
            }

            headers.put(header.getKey(), header.getValue().get(0));
        }

        return headers;
    }

    private void removeHeader(Map<String, String> headers, String expectedName) {
        String headerName = null;

        for (String name : headers.keySet()) {
            if (expectedName.equalsIgnoreCase(name)) {
                headerName = name;
                break;
            }
        }

        if (headerName != null) {
            headers.remove(headerName);
        }
    }

    private String getReasonPhrase(int statusCode) {
        if (statusCode >= 200 && statusCode < 300) {
            return "OK";
        }

        if (statusCode >= 300 && statusCode < 400) {
            return "Redirect";
        }

        if (statusCode >= 400 && statusCode < 500) {
            return "Client Error";
        }

        if (statusCode >= 500) {
            return "Server Error";
        }

        return "Status";
    }

    private boolean isHtmlContentType(String contentType) {
        return contentType != null && contentType.toLowerCase(Locale.ROOT).contains("text/html");
    }

    private String getMimeType(String contentType) {
        if (contentType == null || contentType.trim().isEmpty()) {
            return "text/html";
        }

        return contentType.split(";", 2)[0].trim();
    }

    private Charset getCharset(String contentType) {
        if (contentType == null) {
            return StandardCharsets.UTF_8;
        }

        for (String part : contentType.split(";")) {
            String trimmedPart = part.trim();

            if (!trimmedPart.toLowerCase(Locale.ROOT).startsWith("charset=")) {
                continue;
            }

            try {
                return Charset.forName(trimmedPart.substring("charset=".length()).trim());
            } catch (IllegalArgumentException ignored) {
                return StandardCharsets.UTF_8;
            }
        }

        return StandardCharsets.UTF_8;
    }

    private String getQdnBridgeTag(String bridgeToken) {
        return "<script>" +
            "(function(){if(typeof window.qdnRequest==='function')return;" +
            "var bridgeToken='" + bridgeToken + "';" +
            "var nextRequestId=0;var pending={};" +
            "window.addEventListener('message',function(event){" +
            "var data=event.data;if(!data||data.type!=='qortium:qdn-response'||data.bridgeToken!==bridgeToken||typeof data.requestId!=='string')return;" +
            "var entry=pending[data.requestId];if(!entry)return;delete pending[data.requestId];clearTimeout(entry.timeoutId);" +
            "if(data.error){var message=data.error.message||data.error.error||'QDN app request failed.';var err=new Error(message);if(typeof data.error.code==='string'){err.code=data.error.code;}entry.reject(err);return;}" +
            "entry.resolve(data.result);" +
            "});" +
            // Home sends this additive runtime signal whenever its display settings
            // change. Re-dispatch it as a document event so QDN apps use the same
            // API on Android and desktop isolated views.
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:home-settings-changed'||!data.detail)return;window.dispatchEvent(new CustomEvent('qortiumHomeSettingsChanged',{detail:data.detail}));});" +
            // Manager change signals contain only a monotonic revision. Apps
            // refresh through their permissioned qdnRequest read instead of
            // receiving bookmark or notification data through postMessage.
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:bookmark-manager-changed'||!data.detail||!Number.isSafeInteger(data.detail.revision)||data.detail.revision<0)return;window.dispatchEvent(new CustomEvent('qortiumBookmarkManagerChanged',{detail:{revision:data.detail.revision}}));});" +
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:notification-manager-changed'||!data.detail||!Number.isSafeInteger(data.detail.revision)||data.detail.revision<0)return;window.dispatchEvent(new CustomEvent('qortiumNotificationManagerChanged',{detail:{revision:data.detail.revision}}));});" +
            "Object.defineProperty(window,'qdnRequest',{configurable:false,enumerable:true,writable:false,value:function(request){" +
            "return new Promise(function(resolve,reject){" +
            "if(!window.parent||window.parent===window){reject(new Error('QDN app bridge is unavailable.'));return;}" +
            "var requestId=String(Date.now())+'-'+String(++nextRequestId);" +
            "var action=request&&typeof request==='object'?String(request.action||'').toUpperCase():'';" +
            "var longActions={PUBLISH_MULTIPLE_QDN_RESOURCES:1,PUBLISH_QDN_RESOURCE:1,PREVIEW_QDN_PUBLISH_SOURCE:1,DELETE_QDN_RESOURCE:1,APPROVE_GROUP_JOIN_REQUEST:1,INVITE_TO_GROUP:1,JOIN_GROUP:1,LEAVE_GROUP:1,UPDATE_GROUP:1,BUY_NAME:1,CANCEL_SELL_NAME:1,REGISTER_NAME:1,SELL_NAME:1,UPDATE_NAME:1,SEND_CHAT_MESSAGE:1,CREATE_POLL:1,VOTE_ON_POLL:1,UPDATE_POLL:1,SHOW_NOTIFICATION:1,NOTIFICATION_ADD:1,GET_APP_ASSIGNMENTS:1,REQUEST_APP_ASSIGNMENT:1,BOOKMARKS_GET:1,BOOKMARKS_APPLY:1,BOOKMARKS_OPEN:1,NOTIFICATION_MANAGER_GET:1,NOTIFICATION_MANAGER_SET_MUTED:1,NOTIFICATION_MANAGER_REMOVE_RULES:1,NOTIFICATION_MANAGER_REVOKE:1,UNLOCK_SELECTED_ACCOUNT:1,GET_USER_WALLET:1,GET_WALLET_BALANCE:1,GET_USER_WALLET_INFO:1,GET_USER_WALLET_TRANSACTIONS:1,SEND_COIN:1,SET_CURRENT_FOREIGN_SERVER:1,GET_PRIVATE_DIRECT_ACTIVE_CHATS:1,GET_PRIVATE_GROUP_ACTIVE_CHATS:1,SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES:1,SEARCH_PRIVATE_GROUP_CHAT_MESSAGES:1};" +
            "var timeoutMs=longActions[action]?330000:30000;" +
            "var timeoutId=setTimeout(function(){delete pending[requestId];reject(new Error('QDN app request timed out.'));},timeoutMs);" +
            "pending[requestId]={resolve:resolve,reject:reject,timeoutId:timeoutId};" +
            "window.parent.postMessage({type:'qortium:qdn-request',bridgeToken:bridgeToken,requestId:requestId,request:request},'*');" +
            "});}});" +
            // Forward document.title changes to the host so the app controls its
            // tab label (the desktop shell gets this from page-title-updated).
            "var lastTitle=null;" +
            "function postTitle(){" +
            "var title=typeof document.title==='string'?document.title:'';" +
            "if(title===lastTitle)return;lastTitle=title;" +
            "if(window.parent&&window.parent!==window){window.parent.postMessage({type:'qortium:qdn-title',bridgeToken:bridgeToken,title:title},'*');}" +
            "}" +
            "function watchTitle(){" +
            "postTitle();" +
            "if(typeof MutationObserver!=='function'||!document.head)return;" +
            "new MutationObserver(postTitle).observe(document.head,{subtree:true,childList:true,characterData:true});" +
            "}" +
            "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',watchTitle);}else{watchTitle();}" +
            // Mirror the iframe's real browser history into Home. Chromium's
            // Navigation API supplies stable indexes (including duplicate URLs);
            // the small shadow stack keeps older Android WebViews functional.
            "var lastNavigation=null;var fallbackEntries=[window.location.href];var fallbackIndex=0;" +
            "function getNavigationSnapshot(){" +
            "if(window.navigation&&typeof window.navigation.entries==='function'&&window.navigation.currentEntry){" +
            "var nativeEntries=window.navigation.entries();return {activeIndex:window.navigation.currentEntry.index,entries:nativeEntries.map(function(entry){return {index:entry.index,url:entry.url};})};}" +
            "return {activeIndex:fallbackIndex,entries:fallbackEntries.map(function(url,index){return {index:index,url:url};})};" +
            "}" +
            "function postNavigation(){var snapshot=getNavigationSnapshot();var serialized=JSON.stringify(snapshot);if(serialized===lastNavigation)return;lastNavigation=serialized;" +
            "if(window.parent&&window.parent!==window){window.parent.postMessage({type:'qortium:qdn-navigation',bridgeToken:bridgeToken,activeIndex:snapshot.activeIndex,entries:snapshot.entries},'*');}}" +
            "var originalPushState=window.history.pushState;" +
            "window.history.pushState=function(){var result=originalPushState.apply(this,arguments);if(!window.navigation){fallbackEntries=fallbackEntries.slice(0,fallbackIndex+1);fallbackEntries.push(window.location.href);fallbackIndex+=1;}postNavigation();return result;};" +
            "var originalReplaceState=window.history.replaceState;" +
            "window.history.replaceState=function(){var result=originalReplaceState.apply(this,arguments);if(!window.navigation){fallbackEntries[fallbackIndex]=window.location.href;}postNavigation();return result;};" +
            "function pushFallbackLocation(){if(window.navigation)return;var current=window.location.href;if(fallbackEntries[fallbackIndex]===current)return;fallbackEntries=fallbackEntries.slice(0,fallbackIndex+1);fallbackEntries.push(current);fallbackIndex+=1;}" +
            "function traverseFallbackLocation(){if(window.navigation)return;var current=window.location.href;if(fallbackEntries[fallbackIndex]===current)return;var match=fallbackEntries.lastIndexOf(current,fallbackIndex-1);if(match<0){match=fallbackEntries.indexOf(current,fallbackIndex+1);}if(match>=0){fallbackIndex=match;return;}pushFallbackLocation();}" +
            "var fallbackPopstatePending=false;" +
            "window.addEventListener('popstate',function(){fallbackPopstatePending=true;traverseFallbackLocation();postNavigation();setTimeout(function(){fallbackPopstatePending=false;},0);});" +
            // Assigning location.hash creates a real history entry without
            // calling pushState. Older WebViews need this explicit signal.
            "window.addEventListener('hashchange',function(){if(!fallbackPopstatePending){pushFallbackLocation();}fallbackPopstatePending=false;postNavigation();});" +
            "if(window.navigation){window.navigation.addEventListener('currententrychange',postNavigation);}" +
            "window.addEventListener('message',function(event){var data=event.data;if(!data||data.type!=='qortium:qdn-navigation-command'||data.bridgeToken!==bridgeToken||!Number.isInteger(data.index)||data.index<0)return;" +
            "var snapshot=getNavigationSnapshot();var target=snapshot.entries.find(function(entry){return entry.index===data.index;});if(!target)return;window.history.go(data.index-snapshot.activeIndex);});" +
            "postNavigation();" +
            "})();" +
            "</script>";
    }

    private String injectQdnBridge(String html, String bridgeToken) {
        String bridgeTag = getQdnBridgeTag(bridgeToken);
        String lowerHtml = html.toLowerCase(Locale.ROOT);
        int headStart = lowerHtml.indexOf("<head");

        if (headStart >= 0) {
            int headEnd = lowerHtml.indexOf(">", headStart);

            if (headEnd >= 0) {
                return html.substring(0, headEnd + 1) + bridgeTag + html.substring(headEnd + 1);
            }
        }

        int bodyStart = lowerHtml.indexOf("<body");

        if (bodyStart >= 0) {
            return html.substring(0, bodyStart) + bridgeTag + html.substring(bodyStart);
        }

        return bridgeTag + html;
    }
}
