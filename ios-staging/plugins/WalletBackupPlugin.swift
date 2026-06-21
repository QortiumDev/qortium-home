import Capacitor
import Foundation
import UIKit

// iOS port of android/.../WalletBackupPlugin.java
// Writes the wallet JSON to a temp file and lets the user export it via the
// Files app (UIDocumentPicker export). Returns canceled / fileName / uri.
@objc(WalletBackupPlugin)
public class WalletBackupPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "WalletBackupPlugin"
    public let jsName = "WalletBackup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveWallet", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var tempUrl: URL?

    @objc func saveWallet(_ call: CAPPluginCall) {
        guard let content = call.getString("content"), !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("Wallet backup content is required.")
            return
        }

        let fileName = Self.sanitizeFileName(call.getString("fileName"))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

        do {
            try content.data(using: .utf8)?.write(to: url, options: .atomic)
        } catch {
            call.reject("Unable to write wallet backup.", nil, error)
            return
        }

        pendingCall = call
        tempUrl = url

        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(["canceled": true])
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let saved = urls.first else {
            finishReject("Wallet backup was not saved.")
            return
        }
        finish([
            "canceled": false,
            "fileName": saved.lastPathComponent,
            "uri": saved.absoluteString
        ])
    }

    private func finish(_ result: [String: Any]) {
        cleanupTemp()
        let call = pendingCall
        pendingCall = nil
        call?.resolve(result)
    }

    private func finishReject(_ message: String) {
        cleanupTemp()
        let call = pendingCall
        pendingCall = nil
        call?.reject(message)
    }

    private func cleanupTemp() {
        if let url = tempUrl { try? FileManager.default.removeItem(at: url) }
        tempUrl = nil
    }

    private static func sanitizeFileName(_ value: String?) -> String {
        let invalid = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        var name = (value ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: invalid)
            .joined(separator: "_")
        if name.isEmpty { name = "qortium-wallet.json" }
        if !name.lowercased().hasSuffix(".json") { name += ".json" }
        return name
    }
}
