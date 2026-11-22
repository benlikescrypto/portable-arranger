import Foundation
import onnxruntime_objc

@_silgen_name("arrangerbox_f0_open")
func arrangerbox_f0_open(_ path: UnsafePointer<CChar>, _ report: UnsafeMutablePointer<CChar>, _ reportLen: Int32) -> Int32

@_silgen_name("arrangerbox_f0_windows")
func arrangerbox_f0_windows(_ id: Int32) -> Int32

@_silgen_name("arrangerbox_f0_window_size")
func arrangerbox_f0_window_size(_ id: Int32, _ w: Int32) -> Int32

@_silgen_name("arrangerbox_f0_window")
func arrangerbox_f0_window(_ id: Int32, _ w: Int32, _ out: UnsafeMutablePointer<Float>, _ cap: Int32) -> Int32

@_silgen_name("arrangerbox_f0_put")
func arrangerbox_f0_put(_ id: Int32, _ w: Int32, _ pitch: UnsafePointer<Float>, _ conf: UnsafePointer<Float>, _ frames: Int32) -> Int32

@_silgen_name("arrangerbox_f0_finish")
func arrangerbox_f0_finish(_ id: Int32, _ holdMs: Float) -> UnsafeMutablePointer<CChar>?

@_silgen_name("arrangerbox_f0_close")
func arrangerbox_f0_close(_ id: Int32)

@_silgen_name("arrangerbox_f0_free")
func arrangerbox_f0_free(_ s: UnsafeMutablePointer<CChar>?)

/// SwiftF0 (https://github.com/lars76/swift-f0, MIT) on the device: finds the notes in one AI
/// stem. PitchTrack.cpp decodes and resamples the stem and cuts it into SwiftF0's windows; this
/// only runs the ONNX model on each window. C++ then segments the notes and returns JSON.
final class SwiftF0Runner {
  static let shared = SwiftF0Runner()
  private let lock = NSLock()
  private var env: ORTEnv?
  private var session: ORTSession?

  private func modelPath() -> String? {
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
  }

  private func openSession() throws -> ORTSession {
    if let s = session { return s }
    guard let path = modelPath() else {
      throw NSError(domain: "SwiftF0", code: 1, userInfo: [NSLocalizedDescriptionKey: "the SwiftF0 model is missing from this build"])
    }
    let e = try ORTEnv(loggingLevel: ORTLoggingLevel.warning)
    let opts = try ORTSessionOptions()
    // A 14k-parameter model: two threads are plenty and leave cores for the audio thread.
    try opts.setIntraOpNumThreads(2)
    try opts.addConfigEntry(withKey: "session.intra_op.allow_spinning", value: "0")
    let s = try ORTSession(env: e, modelPath: path, sessionOptions: opts)
    env = e
    session = s
    return s
  }

  private static func scalar(_ v: Float) throws -> ORTValue {
    var x = v
    let data = NSMutableData(bytes: &x, length: MemoryLayout<Float>.size)
    return try ORTValue(tensorData: data, elementType: ORTTensorElementDataType.float, shape: [])
  }

  private static func floats(_ v: ORTValue) throws -> [Float] {
    let data = try v.tensorData() as Data
    return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  }

  private static func json(_ reason: String) -> String {
    let obj: [String: Any] = ["ok": 0, "reason": reason]
    let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
    return String(data: data, encoding: .utf8) ?? "{\"ok\":0}"
  }

  func findNotes(path: String, fmin: Float, fmax: Float, holdMs: Float) -> String {
    lock.lock()
    defer { lock.unlock() }
    let cap = 256
    let report = UnsafeMutablePointer<CChar>.allocate(capacity: cap)
    report.initialize(repeating: 0, count: cap)
    defer {
      report.deinitialize(count: cap)
      report.deallocate()
    }
    let id = path.withCString { arrangerbox_f0_open($0, report, Int32(cap)) }
    if id == 0 { return String(cString: report) }
    do {
      let s = try openSession()
      let lo = try SwiftF0Runner.scalar(fmin), hi = try SwiftF0Runner.scalar(fmax)
      let windows = arrangerbox_f0_windows(id)
      for w in 0..<windows {
        let n = Int(arrangerbox_f0_window_size(id, w))
        if n <= 0 { continue }
        let data = NSMutableData(length: n * MemoryLayout<Float>.size)!
        let got = arrangerbox_f0_window(id, w, data.mutableBytes.assumingMemoryBound(to: Float.self), Int32(n))
        if Int(got) != n { continue }
        let audio = try ORTValue(tensorData: data, elementType: ORTTensorElementDataType.float, shape: [1, NSNumber(value: n)])
        let out = try s.run(withInputs: ["audio": audio, "fmin": lo, "fmax": hi], outputNames: ["pitch", "confidence"], runOptions: nil)
        guard let p = out["pitch"], let c = out["confidence"] else { continue }
        let pitch = try SwiftF0Runner.floats(p), conf = try SwiftF0Runner.floats(c)
        let frames = Int32(min(pitch.count, conf.count))
        _ = pitch.withUnsafeBufferPointer { pp in
          conf.withUnsafeBufferPointer { cp in arrangerbox_f0_put(id, w, pp.baseAddress!, cp.baseAddress!, frames) }
        }
      }
      let cstr = arrangerbox_f0_finish(id, holdMs)
      defer { arrangerbox_f0_free(cstr) }
      return cstr.map { String(cString: $0) } ?? SwiftF0Runner.json("no result")
    } catch {
      arrangerbox_f0_close(id)
      return SwiftF0Runner.json("SwiftF0 failed: \(error.localizedDescription)")
    }
  }
}
