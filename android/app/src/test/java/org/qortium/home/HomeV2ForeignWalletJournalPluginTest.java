package org.qortium.home;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class HomeV2ForeignWalletJournalPluginTest {
    @Test
    public void journalSizeIsValidatedBeforePlatformJsonParsing() throws Exception {
        String valid = "{\"entries\":[],\"version\":1}";
        assertArrayEquals(
                valid.getBytes(StandardCharsets.UTF_8),
                HomeV2ForeignWalletJournalPlugin.validateJournalSize(valid));
        assertEquals(512 * 1024, HomeV2ForeignWalletJournalPlugin.MAX_JOURNAL_BYTES);

        assertThrows(
                Exception.class,
                () -> HomeV2ForeignWalletJournalPlugin.validateJournalSize(
                        "{\"entries\":[],\"padding\":\""
                                + "x".repeat(HomeV2ForeignWalletJournalPlugin.MAX_JOURNAL_BYTES)
                                + "\",\"version\":1}"));
    }

    @Test
    public void streamedJournalReadAcceptsExactLimitAndRejectsOverflow() throws Exception {
        byte[] exact = new byte[HomeV2ForeignWalletJournalPlugin.MAX_JOURNAL_BYTES];
        assertEquals(
                exact.length,
                HomeV2ForeignWalletJournalPlugin.readBounded(
                        new ByteArrayInputStream(exact)).length);

        byte[] oversized = new byte[HomeV2ForeignWalletJournalPlugin.MAX_JOURNAL_BYTES + 1];
        assertThrows(
                Exception.class,
                () -> HomeV2ForeignWalletJournalPlugin.readBounded(
                        new ByteArrayInputStream(oversized)));
    }
}
