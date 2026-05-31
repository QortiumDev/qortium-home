package org.qortium.home;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        registerPlugin(UpdateInstallerPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().setWebViewClient(new QdnBridgeWebViewClient(getBridge()));
    }
}
