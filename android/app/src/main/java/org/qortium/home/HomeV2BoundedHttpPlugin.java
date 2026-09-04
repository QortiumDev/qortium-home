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
import java.util.Locale;
import org.json.JSONObject;

/**
 * Narrow authenticated transport for Android administrative operations. The
 * API key is decrypted and applied here, never returned to WebView JavaScript.
 * The native side independently binds the request to the saved origin and
 * binding id, enforces an endpoint/method allowlist, refuses redirects, and
 * bounds request and response bodies.
 */
@CapacitorPlugin(name = "HomeV2BoundedHttp")
public class HomeV2BoundedHttpPlugin extends Plugin {
    static final int DEFAULT_RESPONSE_BYTES = 2 * 1024 * 1024;
    static final int MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
    static final int MAX_REQUEST_BYTES = 70 * 1024 * 1024;
    /**
     * Socket-level ceilings. A single connect or a single quiet read has no
     * business taking minutes even when the whole call legitimately does.
     */
    static final int MAX_CONNECT_TIMEOUT_MS = 20_000;
    static final int MAX_READ_TIMEOUT_MS = 60_000;
    /**
     * The ceiling for the WHOLE call, write included.
     *
     * HttpURLConnection has no such timeout: connect and read timeouts do not
     * cover OutputStream.write(), so a node that accepts a connection and then
     * stops draining leaves the upload blocked with nothing to end it. A
     * publish preview can legitimately push ~100 MiB of base64 over a home
     * connection, so the JS side asks for minutes and this is what makes that
     * number real (security review, 2026-09-02).
     */
    static final int MAX_OVERALL_TIMEOUT_MS = 180_000;
    static final int DEFAULT_OVERALL_TIMEOUT_MS = 60_000;
    static final int WRITE_CHUNK_BYTES = 64 * 1024;

    @PluginMethod
    public void request(PluginCall call) {
        new Thread(() -> executeRequest(call), "home-v2-bounded-http").start();
    }

    private void executeRequest(PluginCall call) {
        HttpURLConnection connection = null;
        try {
            String urlText = call.getString("url", "");
            String expectedBindingId = call.getString("expectedBindingId", "");
            String method = call.getString("method", "POST").toUpperCase(Locale.ROOT);
            String contentType = call.getString("contentType", "application/json");
            String body = call.getString("body", "");
            int timeoutMs = call.getInt("timeoutMs", 20_000);
            int connectTimeoutMs = clampTimeout(
                    call.getInt("connectTimeoutMs", timeoutMs), MAX_CONNECT_TIMEOUT_MS);
            int readTimeoutMs = clampTimeout(
                    call.getInt("readTimeoutMs", timeoutMs), MAX_READ_TIMEOUT_MS);
            int overallTimeoutMs = clampTimeout(
                    call.getInt("overallTimeoutMs", Math.max(timeoutMs, DEFAULT_OVERALL_TIMEOUT_MS)),
                    MAX_OVERALL_TIMEOUT_MS);
            int maxBytes = requireValidMaxBytes(call.getInt("maxBytes", DEFAULT_RESPONSE_BYTES));
            long deadline = System.currentTimeMillis() + overallTimeoutMs;
            URL target = new URL(urlText);
            String protectedValue = HomeV2SecureStoragePlugin.readProtectedValue(
                    getContext(), HomeV2SecureStoragePlugin.ADMIN_CREDENTIAL_ID);
            if (protectedValue == null) throw new Exception("The node API key is unavailable.");
            JSONObject credential = new JSONObject(protectedValue);
            String apiKey = credential.optString("apiKey", "").trim();
            String bindingId = credential.optString("bindingId", "");
            String credentialOrigin = credential.optString("nodeApiUrl", "");
            byte[] requestBytes = body.getBytes(StandardCharsets.UTF_8);
            assertAllowedAuthenticatedRequest(
                    target, credentialOrigin, method, contentType, requestBytes.length,
                    bindingId, expectedBindingId, apiKey);
            connection = (HttpURLConnection) target.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setRequestMethod(method);
            if (!body.isEmpty()) connection.setRequestProperty("Content-Type", contentType);
            connection.setRequestProperty("X-API-KEY", apiKey);
            if (!body.isEmpty()) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(requestBytes.length);
            }
            // The watchdog is what actually ends a write that has blocked:
            // checking the clock between chunks cannot interrupt a single
            // write() that never returns, and disconnect() closes the socket
            // under it so the write fails instead of hanging forever.
            HttpURLConnection watched = connection;
            Thread watchdog = new Thread(() -> {
                try {
                    long remaining = deadline - System.currentTimeMillis();
                    if (remaining > 0) Thread.sleep(remaining);
                    watched.disconnect();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }, "home-v2-bounded-http-deadline");
            watchdog.setDaemon(true);
            watchdog.start();
            try {
                if (!body.isEmpty()) {
                    try (OutputStream output = connection.getOutputStream()) {
                        writeWithDeadline(output, requestBytes, deadline);
                    }
                }

                int status = connection.getResponseCode();
                long declaredLength = connection.getContentLengthLong();
                if (declaredLength > maxBytes) {
                    throw new Exception("Node API response exceeded the requested size limit.");
                }
                InputStream stream = status >= 400
                        ? connection.getErrorStream()
                        : connection.getInputStream();
                byte[] responseBytes = readBounded(stream, maxBytes);
                JSObject response = new JSObject();
                response.put("body", new String(responseBytes, StandardCharsets.UTF_8));
                response.put("contentType", connection.getContentType());
                response.put("status", status);
                call.resolve(response);
            } finally {
                watchdog.interrupt();
            }
        } catch (Exception exception) {
            String message = exception.getMessage();
            call.reject(message == null ? "Authenticated node request failed." : message, exception);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static void assertAllowedAuthenticatedRequest(
            URL target,
            String credentialOrigin,
            String method,
            String contentType,
            int bodyBytes,
            String bindingId,
            String expectedBindingId,
            String apiKey) throws Exception {
        String protocol = target.getProtocol().toLowerCase(Locale.ROOT);
        if (!"http".equals(protocol) && !"https".equals(protocol)) {
            throw new Exception("Authenticated node requests require an HTTP(S) URL.");
        }
        if (target.getUserInfo() != null || target.getRef() != null) {
            throw new Exception("Authenticated node request URL is invalid.");
        }
        if ("http".equals(protocol) && !isLoopbackHost(target.getHost())) {
            throw new Exception("Remote authenticated node requests require HTTPS.");
        }
        URL stored = new URL(credentialOrigin);
        if (!origin(target).equals(origin(stored))) {
            throw new Exception("The node API key is bound to a different origin.");
        }
        if (!bindingId.matches("^[0-9a-f]{32}$") || !bindingId.equals(expectedBindingId)) {
            throw new Exception("The node API key binding changed before the request.");
        }
        if (apiKey.isEmpty() || apiKey.length() > 512 || hasControlCharacter(apiKey)) {
            throw new Exception("The protected node API key is invalid.");
        }
        if (!("GET".equals(method) || "POST".equals(method) ||
                "PATCH".equals(method) || "DELETE".equals(method))) {
            throw new Exception("Authenticated node request method is not allowed.");
        }
        if (bodyBytes < 0 || bodyBytes > MAX_REQUEST_BYTES) {
            throw new Exception("Authenticated node request body exceeded its size limit.");
        }
        String path = target.getPath();
        boolean allowed = isAllowedPathAndMethod(path, method);
        if (!allowed) throw new Exception("Authenticated node request path is not allowed.");
        if (bodyBytes > 0 && !("application/json".equals(contentType) || "text/plain".equals(contentType))) {
            throw new Exception("Authenticated node request content type is not allowed.");
        }
        if (!path.startsWith("/arbitrary/preview/") && bodyBytes > 2 * 1024 * 1024) {
            throw new Exception("Authenticated node request body exceeded its size limit.");
        }
    }

    static boolean isAllowedPathAndMethod(String path, String method) {
        if (path.matches("^/lists(?:/[^/]+)?$")) {
            return "GET".equals(method) || "POST".equals(method) || "DELETE".equals(method);
        }
        if ("/admin/settings/metadata".equals(path)) return "GET".equals(method);
        if ("/admin/settings".equals(path)) return "GET".equals(method) || "PATCH".equals(method);
        if ("/admin/restart".equals(path)) return "GET".equals(method);
        if ("/admin/update".equals(path)) return "GET".equals(method) || "POST".equals(method);
        if (path.matches("^/arbitrary/preview/[A-Za-z0-9_]+/upload$")) return "POST".equals(method);
        if (path.matches("^/crosschain/(btc|ltc|doge|dgb|rvn|dash|nmc|firo)/"
                + "(walletbalance|addressinfos|wallettransactions|setcurrentserver)$")) {
            return "POST".equals(method);
        }
        if (path.matches("^/crosschain/(btc|ltc|doge|dgb|rvn|dash|nmc|firo)/"
                + "(wallet/public/spend-context|send/broadcast)$")) {
            return "POST".equals(method);
        }
        return false;
    }

    private static boolean hasControlCharacter(String value) {
        for (int index = 0; index < value.length(); index += 1) {
            char item = value.charAt(index);
            if (item <= 0x1f || item == 0x7f) return true;
        }
        return false;
    }

    private static boolean isLoopbackHost(String host) {
        String value = host.toLowerCase(Locale.ROOT);
        return "localhost".equals(value) || "127.0.0.1".equals(value) ||
                "::1".equals(value) || "0:0:0:0:0:0:0:1".equals(value);
    }

    private static String origin(URL value) {
        int port = value.getPort();
        int defaultPort = value.getDefaultPort();
        String host = value.getHost().toLowerCase(Locale.ROOT);
        if (host.contains(":") && !host.startsWith("[")) host = "[" + host + "]";
        return value.getProtocol().toLowerCase(Locale.ROOT) + "://" + host +
                (port == -1 || port == defaultPort ? "" : ":" + port);
    }

    /** A caller-supplied timeout, held to 1ms..ceiling. */
    static int clampTimeout(int value, int ceiling) {
        if (value < 1) return ceiling;
        return Math.min(value, ceiling);
    }

    /**
     * Writes the request body in chunks, refusing to start another once the
     * overall deadline has passed. Paired with the watchdog above: this ends a
     * SLOW upload deterministically, the watchdog ends a STUCK one.
     */
    static void writeWithDeadline(OutputStream output, byte[] body, long deadline) throws Exception {
        int offset = 0;
        while (offset < body.length) {
            if (System.currentTimeMillis() >= deadline) {
                throw new Exception("Authenticated node request timed out.");
            }
            int count = Math.min(WRITE_CHUNK_BYTES, body.length - offset);
            output.write(body, offset, count);
            offset += count;
        }
        output.flush();
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
