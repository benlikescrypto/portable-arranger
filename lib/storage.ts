import { File, Paths } from "expo-file-system"

/** Small JSON documents in the app's document folder (SongBook, Keyboard Sets, settings). */
export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const file = new File(Paths.document, name)
    if (!file.exists) return fallback
    const text = await Promise.resolve(file.text())
    if (!text) return fallback
    return { ...fallback, ...(JSON.parse(text) as T) }
  } catch {
    return fallback
  }
}

const pending: Record<string, ReturnType<typeof setTimeout>> = {}

/** Debounced write so dragging a fader does not hit the disk on every frame. */
export function writeJson(name: string, value: unknown, delayMs = 400) {
  if (pending[name]) clearTimeout(pending[name])
  pending[name] = setTimeout(() => {
    delete pending[name]
    try {
      const file = new File(Paths.document, name)
      if (!file.exists) file.create({ intermediates: true })
      file.write(JSON.stringify(value))
    } catch {
      // Storage is best effort (web preview, read-only sandboxes).
    }
  }, delayMs)
}
