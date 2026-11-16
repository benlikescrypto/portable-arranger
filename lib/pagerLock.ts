/**
 * While a finger holds a knob, fader or slider, the slide pager must not scroll,
 * or iOS / Android hand the drag to the horizontal ScrollView.
 */
let held = 0
const listeners = new Set<(locked: boolean) => void>()

function emit() {
  for (const l of listeners) l(held > 0)
}

export const pagerLock = {
  hold() {
    held += 1
    if (held === 1) emit()
  },
  release() {
    if (held === 0) return
    held -= 1
    if (held === 0) emit()
  },
  subscribe(listener: (locked: boolean) => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
