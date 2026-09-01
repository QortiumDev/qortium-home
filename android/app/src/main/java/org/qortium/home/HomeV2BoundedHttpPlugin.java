package org.qortium.home;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Narrow authenticated POST transport for foreign-wallet reads and spend
 * context. CapacitorHttp materializes the full body before JavaScript can
 * inspect it; this plugin enforces the caller-selected response ceiling while
 * streaming instead.
 */
@CapacitorPlugin(name = "HomeV2BoundedHttp")
public class HomeV2BoundedHttpPlugin extends Plugin {
    static final int DEFAULT_RESPONSE_BYTES = 2 * 1024 * 1024;
    static final int MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

    @PluginMethod
    public void post(PluginCall call) {
        new Thread(() -> executePost(call), "home-v2-bounded-http").start();
    }

    private void executePost(PluginCall call) {
        HttpURLConnection connection = null;
        try {
            String urlText = call.getString("url", "");
            String apiKey = call.getString("apiKey", "");
            String contentType = call.getString("contentType", "application/json");
            String body = call.getString("body", "");
            int timeoutMs = call.getInt("timeoutMs", 20_000);
            int maxBytes = requireValidMaxBytes(call.getInt("maxBytes", DEFAULT_RESPONSE_BYTES));
            URL target = new URL(urlText);
            if (!"http".equals(target.getProtocol()) && !"https".equals(target.getProtocol())) {
                throw new Exception("Authenticated node requests require an HTTP(S) URL.");
            }
            connection = (HttpURLConnection) target.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(Math.min(Math.max(timeoutMs, 1), 20_000));
            connection.setReadTimeout(Math.min(Math.max(timeoutMs, 1), 20_000));
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", contentType);
            connection.setRequestProperty("X-API-KEY", apiKey);
            connection.setDoOutput(true);
            byte[] requestBytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(requestBytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(requestBytes);
            }

            int status = connection.getResponseCode();
            long declaredLength = connection.getContentLengthLong();
            if (declaredLength > maxBytes) {
                throw new Exception("Node API response exceeded the requested size limit.");
            }
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] responseBytes = readBounded(stream, maxBytes);
            JSObject response = new JSObject();
            response.put("body", new String(responseBytes, StandardCharsets.UTF_8));
            response.put("contentType", connection.getContentType());
            response.put("status", status);
            call.resolve(response);
        } catch (Exception exception) {
            String message = exception.getMessage();
            call.reject(message == null ? "Authenticated node request failed." : message, exception);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static int requireValidMaxBytes(int maxBytes) throws Exception {
        if (maxBytes < 1 || maxBytes > MAX_RESPONSE_BYTES) {
            throw new Exception("Invalid bounded response limit.");
        }
        return maxBytes;
    }

    static byte[] readBounded(InputStream stream, int maxBytes) throws Exception {
        if (stream == null) return new byte[0];
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > maxBytes) {
                    throw new Exception("Node API response exceeded the requested size limit.");
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }
}
