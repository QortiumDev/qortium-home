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
    private static final String QDN_BRIDGE_SCRIPT =
        "(function(){if(typeof window.qdnRequest==='function')return;" +
        "var nextRequestId=0;var pending={};" +
        "window.addEventListener('message',function(event){" +
        "var data=event.data;if(!data||data.type!=='qortium:qdn-response'||typeof data.requestId!=='string')return;" +
        "var entry=pending[data.requestId];if(!entry)return;delete pending[data.requestId];clearTimeout(entry.timeoutId);" +
        "if(data.error){var message=data.error.message||data.error.error||'QDN app request failed.';entry.reject(new Error(message));return;}" +
        "entry.resolve(data.result);" +
        "});" +
        "Object.defineProperty(window,'qdnRequest',{configurable:false,enumerable:true,writable:false,value:function(request){" +
        "return new Promise(function(resolve,reject){" +
        "if(!window.parent||window.parent===window){reject(new Error('QDN app bridge is unavailable.'));return;}" +
        "var requestId=String(Date.now())+'-'+String(++nextRequestId);" +
        "var timeoutId=setTimeout(function(){delete pending[requestId];reject(new Error('QDN app request timed out.'));},30000);" +
        "pending[requestId]={resolve:resolve,reject:reject,timeoutId:timeoutId};" +
        "window.parent.postMessage({type:'qortium:qdn-request',requestId:requestId,request:request},'*');" +
        "});}});" +
        "})();";
    private static final String QDN_BRIDGE_TAG = "<script>" + QDN_BRIDGE_SCRIPT + "</script>";

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

    private boolean shouldInjectQdnBridge(WebResourceRequest request) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return false;
        }

        Uri url = request.getUrl();
        String scheme = url.getScheme();

        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            return false;
        }

        List<String> pathSegments = url.getPathSegments();

        if (pathSegments.size() < 3 || !"render".equals(pathSegments.get(0))) {
            return false;
        }

        String service = pathSegments.get(1).toUpperCase(Locale.ROOT);

        if (!"APP".equals(service) && !"WEBSITE".equals(service)) {
            return false;
        }

        String accept = getRequestHeader(request, "Accept");

        return accept.isEmpty() || accept.toLowerCase(Locale.ROOT).contains("text/html");
    }

    private WebResourceResponse fetchAndInjectQdnBridge(WebResourceRequest request) throws IOException {
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

            responseBytes = injectQdnBridge(html).getBytes(charset);
            removeHeader(responseHeaders, "Content-Length");
            removeHeader(responseHeaders, "Content-Encoding");
            removeHeader(responseHeaders, "Transfer-Encoding");
            removeHeader(responseHeaders, "Content-Security-Policy");
            removeHeader(responseHeaders, "X-Content-Security-Policy");
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

    private String injectQdnBridge(String html) {
        String lowerHtml = html.toLowerCase(Locale.ROOT);
        int headStart = lowerHtml.indexOf("<head");

        if (headStart >= 0) {
            int headEnd = lowerHtml.indexOf(">", headStart);

            if (headEnd >= 0) {
                return html.substring(0, headEnd + 1) + QDN_BRIDGE_TAG + html.substring(headEnd + 1);
            }
        }

        int bodyStart = lowerHtml.indexOf("<body");

        if (bodyStart >= 0) {
            return html.substring(0, bodyStart) + QDN_BRIDGE_TAG + html.substring(bodyStart);
        }

        return QDN_BRIDGE_TAG + html;
    }
}
