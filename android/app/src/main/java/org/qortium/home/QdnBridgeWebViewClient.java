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

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request == null || request.isForMainFrame()) {
            return super.shouldOverrideUrlLoading(view, request);
        }

        Uri url = request.getUrl();

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
        String bridgeToken = request.getUrl().getQueryParameter(QDN_BRIDGE_QUERY_PARAM);
        HttpURLConnection connection = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();

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

        return "APP".equals(service) || "WEBSITE".equals(service);
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
            "if(data.error){var message=data.error.message||data.error.error||'QDN app request failed.';entry.reject(new Error(message));return;}" +
            "entry.resolve(data.result);" +
            "});" +
            "Object.defineProperty(window,'qdnRequest',{configurable:false,enumerable:true,writable:false,value:function(request){" +
            "return new Promise(function(resolve,reject){" +
            "if(!window.parent||window.parent===window){reject(new Error('QDN app bridge is unavailable.'));return;}" +
            "var requestId=String(Date.now())+'-'+String(++nextRequestId);" +
            "var action=request&&typeof request==='object'?String(request.action||'').toUpperCase():'';" +
            "var timeoutMs=(action==='PUBLISH_QDN_RESOURCE'||action==='DELETE_QDN_RESOURCE')?180000:30000;" +
            "var timeoutId=setTimeout(function(){delete pending[requestId];reject(new Error('QDN app request timed out.'));},timeoutMs);" +
            "pending[requestId]={resolve:resolve,reject:reject,timeoutId:timeoutId};" +
            "window.parent.postMessage({type:'qortium:qdn-request',bridgeToken:bridgeToken,requestId:requestId,request:request},'*');" +
            "});}});" +
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
