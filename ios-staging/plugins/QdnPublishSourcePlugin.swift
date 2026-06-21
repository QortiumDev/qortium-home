import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers

// iOS port of android/.../QdnPublishSourcePlugin.java
// Lets the renderer pick a file to publish to QDN and returns it as base64.
@objc(QdnPublishSourcePlugin)
public class QdnPublishSourcePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "QdnPublishSourcePlugin"
    public let jsName = "QdnPublishSource"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "selectFile", returnType: CAPPluginReturnPromise)
    ]

    private static let defaultMaxBytes = 5 * 1024 * 1024
    private var pendingCall: CAPPluginCall?

    @objc func selectFile(_ call: CAPPluginCall) {
        pendingCall = call

        DispatchQueue.main.async {
            let picker: UIDocumentPickerViewController
            if #available(iOS 14.0, *) {
                picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
            } else {
                picker = UIDocumentPickerViewController(documentTypes: ["public.item"], in: .import)
            }
            picker.allowsMultipleSelection = false
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        call.resolve(["canceled": true])
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingCall else { return }
        pendingCall = nil

        guard let url = urls.first else {
            call.reject("QDN publish file was not selected.")
            return
        }

        let maxBytes = call.getInt("maxBytes") ?? QdnPublishSourcePlugin.defaultMaxBytes
        let shouldStopAccess = url.startAccessingSecurityScopedResource()
        defer { if shouldStopAccess { url.stopAccessingSecurityScopedResource() } }

        do {
            let data = try Data(contentsOf: url)
            if maxBytes > 0 && data.count > maxBytes {
                call.reject("Selected QDN publish file is too large.")
                return
            }

            call.resolve([
                "canceled": false,
                "dataBase64": data.base64EncodedString(),
                "fileName": url.lastPathComponent,
                "mimeType": Self.mimeType(for: url),
                "size": data.count,
                "uri": url.absoluteString
            ])
        } catch {
            call.reject("Unable to read QDN publish file.", nil, error)
        }
    }

    private static func mimeType(for url: URL) -> String {
        if #available(iOS 14.0, *),
           let type = UTType(filenameExtension: url.pathExtension),
           let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }
}
