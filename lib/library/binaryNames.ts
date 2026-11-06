export function extractKorgNames(bytes: Uint8Array): string[] {
  if (bytes.length === 0) return []
  const hits: { index: number; value: string }[] = []
  let i = 0
  while (i + 8 < bytes.length) {
    if (isNameChar(bytes[i])) {
      let len = 0
      while (i + len < bytes.length && len < 24 && isNameChar(bytes[i + len])) len++
      if (len >= 8 && len <= 24) {
        const raw = decoder.decode(bytes.subarray(i, i + len)).trim()
        if (looksLikeName(raw)) hits.push({ index: i, value: raw })
        i += len
        continue
      }
    }
    i++
  }
  if (hits.length === 0) return []
  const selected = detectStride(hits) ?? hits.map((h) => h.value)
  const unique: string[] = []
  for (const name of selected) {
    if (name.length >= 3 && !unique.includes(name)) unique.push(name)
  }
  return unique
}

const decoder = new TextDecoder("latin1")

function detectStride(hits: { index: number; value: string }[]): string[] | null {
  if (hits.length < 8) return hits.map((h) => h.value)
  const deltas = new Map<number, number>()
  for (let i = 1; i < hits.length; i++) {
    const d = hits[i].index - hits[i - 1].index
    if (d >= 16 && d <= 1024) deltas.set(d, (deltas.get(d) ?? 0) + 1)
  }
  let bestKey = 0
  let bestCount = 0
  for (const [key, count] of deltas) {
    if (count > bestCount) {
      bestKey = key
      bestCount = count
    }
  }
  if (bestCount < 6) return hits.map((h) => h.value)
  const first = hits[0].index
  return hits
    .filter((h) => {
      const rem = (h.index - first) % bestKey
      return rem === 0 || rem <= 2 || bestKey - rem <= 2
    })
    .map((h) => h.value)
}

function isNameChar(b: number): boolean {
  return b >= 32 && b <= 126 && b !== 127
}

function looksLikeName(s: string): boolean {
  if (!s.trim()) return false
  const letters = [...s].filter((c) => /[A-Za-z]/.test(c)).length
  if (letters < 3) return false
  if ([...s].every((c) => c === s[0])) return false
  const weird = [...s].filter((c) => "@#$%^&*{}[]<>|\\~`".includes(c)).length
  if (weird > 1) return false
  if (s.startsWith("http") || s.includes("://")) return false
  return true
}
