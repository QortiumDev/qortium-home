package org.qortium.home;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        HomeV2ProfileRecoveryPlugin.restoreIfRequested(this);
        HomeV2ProfileRecoveryPlugin.ensureBackupBeforeRenderer(this);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        registerPlugin(QdnRenderProxyPlugin.class);
        registerPlugin(HomeV2SecureStoragePlugin.class);
        registerPlugin(HomeV2BoundedHttpPlugin.class);
        registerPlugin(HomeV2ProfileRecoveryPlugin.class);
        registerPlugin(QdnFileSaverPlugin.class);
        registerPlugin(QdnPublishSourcePlugin.class);
        registerPlugin(UpdateInstallerPlugin.class);
        registerPlugin(WalletBackupPlugin.class);
        super.onCreate(savedInstanceState);
        // Opt into edge-to-edge so the safe-area plugin reports real insets.
        // Must run AFTER super.onCreate(): calling it earlier inflates the decor
        // before AppCompat applies the NoActionBar theme, which surfaces a stray
        // action bar (app-name title + handle) once we draw edge-to-edge.
        // EdgeToEdge.enable() calls WindowCompat.setDecorFitsSystemWindows(false)
        // internally; do not also set that manually.
        EdgeToEdge.enable(this);
        getBridge().setWebViewClient(new QdnBridgeWebViewClient(getBridge()));
    }
}
