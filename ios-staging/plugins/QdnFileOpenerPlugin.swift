import Capacitor
import Foundation
import UIKit

// iOS port of android/.../QdnFileOpenerPlugin.java
// Opens a previously-downloaded QDN file from the app's qdn-downloads dir using
// the system share / "open in" sheet. Path is validated to stay inside app data.
@objc(QdnFileOpenerPlugin)
public class QdnFileOpenerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentInteractionControllerDelegate {
    public let identifier = "QdnFileOpenerPlugin"
    public let jsName = "QdnFileOpener"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openFile", returnType: CAPPluginReturnPromise)
    ]

    private static let downloadsDir = "qdn-downloads"
    private var interactionController: UIDocumentInteractionController?

    @objc func openFile(_ call: CAPPluginCall) {
        guard let rawPath = call.getString("filePath")?.trimmingCharacters(in: .whitespacesAndNewlines), !rawPath.isEmpty else {
            call.reject("Downloaded QDN file path is required.")
            return
        }

        let fileURL: URL
        do {
            fileURL = try safeDownloadedFile(rawPath)
        } catch {
            call.reject((error as NSError).localizedDescription)
            return
        }

        DispatchQueue.main.async {
            let controller = UIDocumentInteractionController(url: fileURL)
            controller.delegate = self
            if let mime = call.getString("mimeType"), !mime.isEmpty {
                controller.uti = nil // let the system infer from the file when a UTI isn't supplied
            }
            self.interactionController = controller

            let presented = controller.presentOpenInMenu(
                from: self.bridge?.viewController?.view.bounds ?? .zero,
                in: self.bridge?.viewController?.view ?? UIView(),
                animated: true
            )
            if presented {
                call.resolve(["opened": true])
            } else {
                self.interactionController = nil
                call.reject("No iOS app is available to open this QDN file.")
            }
        }
    }

    public func documentInteractionControllerDidDismissOpenInMenu(_ controller: UIDocumentInteractionController) {
        interactionController = nil
    }

    // Mirrors the Android getCanonicalFile() containment check: the resolved
    // path must live inside <appData>/qdn-downloads.
    private func safeDownloadedFile(_ rawPath: String) throws -> URL {
        let path = rawPath.hasPrefix("file://") ? (URL(string: rawPath)?.path ?? rawPath) : rawPath
        let fileURL = URL(fileURLWithPath: path).standardizedFileURL

        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            throw NSError(domain: "QdnFileOpener", code: 1, userInfo: [NSLocalizedDescriptionKey: "App data directory is unavailable."])
        }
        let root = docs.appendingPathComponent(Self.downloadsDir).standardizedFileURL

        guard fileURL.path == root.path || fileURL.path.hasPrefix(root.path + "/") else {
            throw NSError(domain: "QdnFileOpener", code: 2, userInfo: [NSLocalizedDescriptionKey: "Downloaded QDN file must be inside Qortium Home app data."])
        }
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw NSError(domain: "QdnFileOpener", code: 3, userInfo: [NSLocalizedDescriptionKey: "Downloaded QDN file was not found."])
        }
        return fileURL
    }
}
