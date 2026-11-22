import Foundation

@_silgen_name("arrangerbox_f0_find_notes_ort")
func arrangerbox_f0_find_notes_ort(
  _ modelPath: UnsafePointer<CChar>, _ path: UnsafePointer<CChar>, _ fmin: Float, _ fmax: Float, _ holdMs: Float
) -> UnsafeMutablePointer<CChar>?

/// SwiftF0 (https://github.com/lars76/swift-f0, MIT) on the device: finds the notes in one AI
/// stem. This finds the bundled model; SwiftF0Ort.mm runs it with ONNX Runtime, and
/// PitchTrack.cpp does the decoding, windowing and note segmentation.
final class SwiftF0Runner {
  static let shared = SwiftF0Runner()

  // Found once when `shared` is created (thread-safe); findNotes runs off the main thread.
  private let modelPath: String? = {
    let name = "swift_f0", ext = "onnx"
    let bundles: [Bundle] = [Bundle.main, Bundle(for: SwiftF0Runner.self)]
    for b in bundles {
      if let p = b.path(forResource: name, ofType: ext) { return p }
      if let url = b.url(forResource: "ArrangerBoxAudio", withExtension: "bundle"),
         let inner = Bundle(url: url),
         let p = inner.path(forResource: name, ofType: ext) {
        return p
      }
    }
    return nil
  }()

  private static func json(_ reason: String) -> String {
    let obj: [String: Any] = ["ok": 0, "reason": reason]
    let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
    return String(data: data, encoding: .utf8) ?? "{\"ok\":0}"
  }

  func findNotes(path: String, fmin: Float, fmax: Float, holdMs: Float) -> String {
    guard let model = modelPath else { return SwiftF0Runner.json("The SwiftF0 model is missing from this build.") }
    let out = model.withCString { m in path.withCString { p in arrangerbox_f0_find_notes_ort(m, p, fmin, fmax, holdMs) } }
    guard let out else { return SwiftF0Runner.json("Out of memory.") }
    defer { free(out) }
    return String(cString: out)
  }
}
