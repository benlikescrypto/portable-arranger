import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

private func safeFolderName(_ raw: String) -> String {
  let trimmed = raw.replacingOccurrences(of: "\\", with: "_")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: ":", with: "_")
  let withoutSet = trimmed.replacingOccurrences(
    of: "\\.SET$",
    with: "",
    options: [.regularExpression, .caseInsensitive]
  )
  return withoutSet.isEmpty ? "Imported" : withoutSet
}

private func countFiles(at url: URL) -> Int {
  let fm = FileManager.default
  guard let enumerator = fm.enumerator(
    at: url,
    includingPropertiesForKeys: [.isRegularFileKey],
    options: [.skipsHiddenFiles]
  ) else { return 0 }
  var n = 0
  for case let fileURL as URL in enumerator {
    let isFile = (try? fileURL.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
    if isFile { n += 1 }
  }
  return n
}

private func copyFolderToSandbox(_ src: URL) throws -> URL {
  let fm = FileManager.default
  let docs = try fm.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
  let dest = docs.appendingPathComponent("sets", isDirectory: true)
    .appendingPathComponent(safeFolderName(src.lastPathComponent), isDirectory: true)
  if fm.fileExists(atPath: dest.path) {
    try fm.removeItem(at: dest)
  }
  try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
  try fm.copyItem(at: src, to: dest)
  return dest
}

private final class FolderPickerSession: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  let promise: Promise
  var settled = false

  init(promise: Promise) {
    self.promise = promise
  }

  func finish(_ value: [String: Any]) {
    guard !settled else { return }
    settled = true
    promise.resolve(value)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let url = urls.first else {
      finish(["canceled": true])
      return
    }
    let accessing = url.startAccessingSecurityScopedResource()
    defer {
      if accessing {
        url.stopAccessingSecurityScopedResource()
      }
    }
    var coordError: NSError?
    var copied: URL?
    var copyError: Error?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [.withoutChanges], error: &coordError) { readURL in
      do {
        copied = try copyFolderToSandbox(readURL)
      } catch {
        copyError = error
      }
    }
    if copied == nil && copyError == nil {
      do {
        copied = try copyFolderToSandbox(url)
      } catch {
        copyError = error
      }
    }
    if let coordError {
      finish(["canceled": false, "error": coordError.localizedDescription])
      return
    }
    if let copyError {
      finish(["canceled": false, "error": copyError.localizedDescription])
      return
    }
    guard let copied else {
      finish(["canceled": false, "error": "Could not copy that folder into ArrangerBox."])
      return
    }
    let files = countFiles(at: copied)
    NSLog("[ArrangerBox] copied SET folder \(url.path) -> \(copied.path) (\(files) files, scoped=\(accessing))")
    finish([
      "canceled": false,
      "path": copied.path,
      "uri": copied.absoluteString,
      "name": copied.lastPathComponent,
      "files": files,
      "source": url.path
    ])
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(["canceled": true])
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish(["canceled": true])
  }
}

public class ArrangerBoxDeviceModule: Module {
  private var folderSession: FolderPickerSession?

  public func definition() -> ModuleDefinition {
    Name("ArrangerBoxDevice")

    Function("isAvailable") { true }

    Function("capabilities") {
      [
        "platform": "ios",
        "model": UIDevice.current.model,
        "manufacturer": "Apple",
        "usbHost": true,
        "midiService": true,
        "usbDevices": [] as [Any]
      ]
    }

    AsyncFunction("pickAndCopyImportFolder") { (promise: Promise) in
      guard let vc = self.appContext?.utilities?.currentViewController() else {
        promise.resolve(["canceled": false, "error": "No view controller to present the folder picker."])
        return
      }
      var types: [UTType] = [.folder]
      if let setType = UTType(filenameExtension: "set") {
        types.append(setType)
      }
      types.append(.package)
      types.append(.bundle)
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
      picker.allowsMultipleSelection = false
      picker.shouldShowFileExtensions = true
      let session = FolderPickerSession(promise: promise)
      self.folderSession = session
      picker.delegate = session
      picker.presentationController?.delegate = session
      picker.modalPresentationStyle = .pageSheet
      vc.present(picker, animated: true)
    }.runOnQueue(.main)
  }
}
