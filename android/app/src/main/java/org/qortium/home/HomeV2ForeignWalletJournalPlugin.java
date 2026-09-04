package org.qortium.home;

import android.system.Os;
import android.system.OsConstants;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Dedicated durable storage for the foreign-wallet broadcast write-ahead log.
 * The stored JSON is already secret-free and strictly sanitized by Home's
 * shared contract. This layer adds atomic replacement, file and directory
 * flushes, bounded reads, and read-back verification before JavaScript may
 * proceed toward a broadcast.
 *
 * The desktop store guards the same file with a cross-process lockfile because
 * two Electron instances can share one userData directory. Android does not
 * need one: the journal is in this app's private files directory and the app
 * runs in a single process, so FILE_LOCK below is enough to keep read and
 * write indivisible. A second app process (a separate service process, or a
 * cloned profile sharing this data directory) would invalidate that and would
 * require a lockfile here first.
 */
@CapacitorPlugin(name = "HomeV2ForeignWalletJournal")
public class HomeV2ForeignWalletJournalPlugin extends Plugin {
    static final int MAX_JOURNAL_BYTES = 512 * 1024;
    private static final String JOURNAL_FILE =
            "home-v2-wallet/pending-foreign-transactions-v1.json";
    private static final Object FILE_LOCK = new Object();

    static byte[] validateJournalSize(String value) throws Exception {
        if (value == null) throw new Exception("Pending foreign transaction journal is missing.");
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 1 || bytes.length > MAX_JOURNAL_BYTES) {
            throw new Exception("Pending foreign transaction journal exceeds its size limit.");
        }
        return bytes;
    }

    static byte[] validateJournal(String value) throws Exception {
        byte[] bytes = validateJournalSize(value);
        JSONObject journal = new JSONObject(value);
        if (journal.getInt("version") != 1 || !(journal.get("entries") instanceof JSONArray)) {
            throw new Exception("Pending foreign transaction journal has an invalid envelope.");
        }
        return bytes;
    }

    static byte[] readBounded(InputStream stream) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > MAX_JOURNAL_BYTES) {
                    throw new Exception("Pending foreign transaction journal exceeds its size limit.");
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private File journalFile() {
        return new File(getContext().getFilesDir(), JOURNAL_FILE);
    }

    private static void syncDirectory(File directory) throws Exception {
        FileDescriptor descriptor = Os.open(
                directory.getAbsolutePath(),
                OsConstants.O_RDONLY,
                0);
        try {
            Os.fsync(descriptor);
        } finally {
            Os.close(descriptor);
        }
    }

    private static String readExisting(AtomicFile file) throws Exception {
        if (!file.getBaseFile().exists()) return null;
        byte[] bytes;
        try (FileInputStream input = file.openRead()) {
            bytes = readBounded(input);
        }
        String value = new String(bytes, StandardCharsets.UTF_8);
        validateJournal(value);
        return value;
    }

    private static void writeDurably(AtomicFile file, byte[] bytes) throws Exception {
        File parent = file.getBaseFile().getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs()) || !parent.isDirectory()) {
            throw new Exception("Pending foreign transaction journal directory is unavailable.");
        }
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(bytes);
            output.getFD().sync();
            file.finishWrite(output);
            output = null;
            // AtomicFile flushes the file before replacement. Flush the parent
            // metadata too; devices/filesystems that cannot do so fail closed.
            syncDirectory(parent);
            String verified = readExisting(file);
            if (verified == null || !MessageDigest.isEqual(
                    bytes, verified.getBytes(StandardCharsets.UTF_8))) {
                throw new Exception("Pending foreign transaction journal verification failed.");
            }
        } catch (Exception error) {
            if (output != null) {
                try {
                    file.failWrite(output);
                } catch (Exception ignored) {
                    // Preserve the original failure. The caller still fails
                    // closed and must not proceed to broadcast.
                }
            }
            throw error;
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        try {
            String value;
            synchronized (FILE_LOCK) {
                value = readExisting(new AtomicFile(journalFile()));
            }
            JSObject result = new JSObject();
            result.put("value", value == null ? JSONObject.NULL : value);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read the pending foreign transaction journal.", error);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        try {
            byte[] bytes = validateJournal(call.getString("value"));
            synchronized (FILE_LOCK) {
                writeDurably(new AtomicFile(journalFile()), bytes);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to durably write the pending foreign transaction journal.", error);
        }
    }
}
