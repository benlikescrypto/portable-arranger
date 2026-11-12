import ExpoModulesCore
import UIKit

/// On-screen keyboard drawn and played natively. Touches go straight from UIKit to
/// the C++ engine (no JS round trip), so key-down latency is the audio buffer only.
/// Every finger is tracked on its own (chords) and sliding onto another key plays it
/// (glissando). Velocity comes from where the key is struck: softer near the top.
final class ArrangerKeyboardView: ExpoView {
  var startNote = 60 { didSet { rebuildKeys() } }
  var octaves = 2 { didSet { rebuildKeys() } }
  var channel = 0

  private static let blackPitchClasses: Set<Int> = [1, 3, 6, 8, 10]
  private var whites: [Int] = []
  private var blacks: [(note: Int, afterWhite: Int)] = []
  /// Which note each finger is holding.
  private var fingers: [ObjectIdentifier: Int] = [:]
  /// How many fingers hold each note (two fingers on one key = one note).
  private var heldCount: [Int: Int] = [:]
  private var pausedScrollViews: [UIScrollView] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isMultipleTouchEnabled = true
    isExclusiveTouch = false
    isOpaque = false
    backgroundColor = .clear
    contentMode = .redraw
    rebuildKeys()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    // A scroll view that delays content touches holds key-downs back ~150 ms.
    var view = superview
    while let v = view {
      if let scroll = v as? UIScrollView { scroll.delaysContentTouches = false }
      view = v.superview
    }
  }

  private func rebuildKeys() {
    whites = []
    blacks = []
    let end = startNote + max(1, octaves) * 12
    for note in startNote...end where !Self.blackPitchClasses.contains(note % 12) {
      whites.append(note)
      let sharp = note + 1
      if sharp <= end && Self.blackPitchClasses.contains(sharp % 12) {
        blacks.append((sharp, whites.count - 1))
      }
    }
    setNeedsDisplay()
  }

  // MARK: Geometry

  private var whiteWidth: CGFloat { bounds.width / CGFloat(max(1, whites.count)) }
  private var blackHeight: CGFloat { bounds.height * 0.6 }

  private func blackRect(_ afterWhite: Int) -> CGRect {
    let w = whiteWidth * 0.62
    return CGRect(x: CGFloat(afterWhite + 1) * whiteWidth - w / 2, y: 0, width: w, height: blackHeight)
  }

  private func noteAt(_ p: CGPoint) -> Int? {
    guard bounds.contains(p), !whites.isEmpty else { return nil }
    if p.y < blackHeight {
      for b in blacks where blackRect(b.afterWhite).contains(p) { return b.note }
    }
    let i = min(whites.count - 1, max(0, Int(p.x / whiteWidth)))
    return whites[i]
  }

  private func velocityAt(_ p: CGPoint, note: Int) -> Int {
    let keyHeight = Self.blackPitchClasses.contains(note % 12) ? blackHeight : bounds.height
    let t = max(0, min(1, p.y / max(1, keyHeight)))
    return Int(70 + t * 57)  // 70 at the top edge ... 127 at the front
  }

  // MARK: Notes

  private func press(_ note: Int, velocity: Int) {
    let count = heldCount[note, default: 0]
    heldCount[note] = count + 1
    if count == 0 {
      arrangerbox_note_on(Int32(channel), Int32(note), Int32(velocity))
      setNeedsDisplay()
    }
  }

  private func release(_ note: Int) {
    guard let count = heldCount[note] else { return }
    if count <= 1 {
      heldCount[note] = nil
      arrangerbox_note_off(Int32(channel), Int32(note))
      setNeedsDisplay()
    } else {
      heldCount[note] = count - 1
    }
  }

  // MARK: Touches

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    pauseParentScrolling(true)
    for touch in touches {
      let p = touch.location(in: self)
      guard let note = noteAt(p) else { continue }
      fingers[ObjectIdentifier(touch)] = note
      press(note, velocity: velocityAt(p, note: note))
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches {
      let id = ObjectIdentifier(touch)
      let p = touch.location(in: self)
      let now = noteAt(p)
      let was = fingers[id]
      if now == was { continue }
      if let was = was { release(was) }
      if let now = now {
        fingers[id] = now
        press(now, velocity: velocityAt(p, note: now))
      } else {
        fingers[id] = nil
      }
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    endTouches(touches)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    endTouches(touches)
  }

  private func endTouches(_ touches: Set<UITouch>) {
    for touch in touches {
      if let note = fingers.removeValue(forKey: ObjectIdentifier(touch)) { release(note) }
    }
    if fingers.isEmpty { pauseParentScrolling(false) }
  }

  /// While a key is held the page pager must not scroll, or a sideways slide would
  /// cancel the touch and cut the notes.
  private func pauseParentScrolling(_ pause: Bool) {
    if pause {
      guard pausedScrollViews.isEmpty else { return }
      var view = superview
      while let v = view {
        if let scroll = v as? UIScrollView, scroll.isScrollEnabled {
          scroll.isScrollEnabled = false
          pausedScrollViews.append(scroll)
        }
        view = v.superview
      }
    } else {
      for scroll in pausedScrollViews { scroll.isScrollEnabled = true }
      pausedScrollViews = []
    }
  }

  override func removeFromSuperview() {
    allNotesOff()
    super.removeFromSuperview()
  }

  deinit {
    for note in heldCount.keys { arrangerbox_note_off(Int32(channel), Int32(note)) }
  }

  private func allNotesOff() {
    for note in heldCount.keys { arrangerbox_note_off(Int32(channel), Int32(note)) }
    heldCount = [:]
    fingers = [:]
    pauseParentScrolling(false)
    setNeedsDisplay()
  }

  // MARK: Drawing (matches the JS keyboard's look)

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext(), !whites.isEmpty else { return }
    let frame = UIBezierPath(roundedRect: bounds, cornerRadius: 10)
    frame.addClip()
    UIColor(red: 0.055, green: 0.063, blue: 0.075, alpha: 1).setFill()
    ctx.fill(bounds)

    let w = whiteWidth
    let label: [NSAttributedString.Key: Any] = [
      .font: UIFont.systemFont(ofSize: 10, weight: .bold),
      .foregroundColor: UIColor(red: 0.54, green: 0.57, blue: 0.61, alpha: 1),
    ]
    for (i, note) in whites.enumerated() {
      let r = CGRect(x: CGFloat(i) * w, y: 0, width: w - 2, height: bounds.height)
      let key = UIBezierPath(roundedRect: r, byRoundingCorners: [.bottomLeft, .bottomRight],
                             cornerRadii: CGSize(width: 6, height: 6))
      (heldCount[note] != nil
        ? UIColor(red: 1.0, green: 0.83, blue: 0.54, alpha: 1)
        : UIColor(red: 0.95, green: 0.957, blue: 0.97, alpha: 1)).setFill()
      key.fill()
      if note % 12 == 0 {
        let text = "C\(note / 12 - 1)" as NSString
        let size = text.size(withAttributes: label)
        text.draw(at: CGPoint(x: r.midX - size.width / 2, y: r.maxY - size.height - 8), withAttributes: label)
      }
    }
    for b in blacks {
      let r = blackRect(b.afterWhite)
      let key = UIBezierPath(roundedRect: r, byRoundingCorners: [.bottomLeft, .bottomRight],
                             cornerRadii: CGSize(width: 5, height: 5))
      (heldCount[b.note] != nil
        ? UIColor(red: 1.0, green: 0.54, blue: 0.24, alpha: 1)
        : UIColor(red: 0.086, green: 0.098, blue: 0.114, alpha: 1)).setFill()
      key.fill()
      UIColor.black.setStroke()
      key.lineWidth = 1
      key.stroke()
    }
  }
}
