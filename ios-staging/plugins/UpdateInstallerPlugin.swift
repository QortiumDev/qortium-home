import Capacitor
import Foundation

// iOS port of android/.../UpdateInstallerPlugin.java
//
// iOS does not allow apps to install packages outside the App Store, so the
// Android "download APK then install" self-update flow has no iOS equivalent.
// Updates are delivered through the App Store / TestFlight instead. This stub
// exists so the registered `UpdateInstaller` bridge is present; the renderer
// should gate the in-app update/install UI off on iOS (see docs/IOS_SETUP.md)
// rather than relying on this rejection.
@objc(UpdateInstallerPlugin)
public class UpdateInstallerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "UpdateInstallerPlugin"
    public let jsName = "UpdateInstaller"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "installApk", returnType: CAPPluginReturnPromise)
    ]

    @objc func installApk(_ call: CAPPluginCall) {
        call.reject("In-app updates are delivered through the App Store on iOS.")
    }
}
