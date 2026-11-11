import { audio } from "arrangerbox-audio"
import { Directory, File, Paths } from "expo-file-system"

import { asDirectory, categoryGuess, findSetFolder, isDirectory, isSetName } from "@/lib/library/pa4x"
import type { LibraryKind, PadItem, SoundItem, StyleItem } from "@/lib/types"

export type DiskItem = {
  kind: LibraryKind
  name: string
  category: string
  fileName: string
  cacheName?: string
  setPath: string
  setName: string
}

export type DiskCatalog = {
  setName: string
  sounds: DiskItem[]
  styles: DiskItem[]
  pads: DiskItem[]
}

export type LoadResult = {
  ok: boolean
  engineId: number
  reason: string
}

const DISK_SOUND = 100000
const DISK_STYLE = 200000
const DISK_PAD = 300000

function nativePath(file: File | Directory) {
  let uri = file.uri || ""
  uri = uri.replace(/^file:\/\/localhost/i, "file://")
  if (uri.startsWith("file://")) return decodeURIComponent(uri.replace(/^file:\/\//, ""))
  return uri
}

function norm(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "")
}

function isGenericStem(name: string) {
  return /^(ram|pcm|sound|style|pad|multismp|multisample|samples)$/i.test(name.trim())
}

function isSetLeftover(name: string, setName: string) {
  const n = norm(name)
  const s = norm(setName.replace(/\.set$/i, ""))
  if (!n || n.includes("tmp") || name.includes("/") || name.includes("\\")) return true
  if (!s || s.length < 3) return false
  if (n === s) return true
  if (n.startsWith(s) && n.length - s.length > 0 && n.length - s.length <= 3) return true
  return false
}

function instrumentName(raw: string) {
  let name = raw.trim().replace(/\s+/g, " ")
  for (let pass = 0; pass < 8; pass++) {
    let next = name.replace(/[\s_\-()]+(l|r|m|left|right|mono)$/i, "")
    next = next.replace(/[\s_\-()]+(v[1-8]|vel[1-8]|ff|mf|mp|pp)$/i, "")
    next = next.replace(/[\s_\-()]+[A-G](?:#|b)?[0-8]$/i, "")
    next = next.replace(/[\s_-]+\d{1,2}$/g, "")
    const gluedNote = next.replace(/[A-G](?:#|b)?[0-8]$/i, "")
    if (gluedNote.length >= 4) next = gluedNote
    const gluedVel = next.replace(/v[1-8]$/i, "")
    if (gluedVel.length >= 4) next = gluedVel
    next = next.trim()
    if (next.length < 3 || next === name) break
    name = next
  }
  return name
}

function collapseInstruments(items: DiskItem[]) {
  const sorted = [...items].sort((a, b) => a.name.length - b.name.length)
  const out: DiskItem[] = []
  for (const item of sorted) {
    const hit = out.find((row) => scoreName(row.name, item.name) >= 400)
    if (hit) {
      if (!hit.fileName && item.fileName) hit.fileName = item.fileName
      continue
    }
    out.push({ ...item })
  }
  return out
}

function programName(raw: string) {
  return raw.replace(/\0/g, " ").replace(/\s+/g, " ").trim()
}

function packTrim(name: string, setName?: string) {
  const pack = (setName || "").replace(/\.set$/i, "")
  let out = programName(name)
  if (pack && out.toLowerCase().startsWith(pack.toLowerCase())) {
    const rest = out.slice(pack.length).replace(/^[\s_\-]+/, "")
    if (rest.length >= 3) out = rest
  }
  return out
}

function pushItem(items: DiskItem[], item: DiskItem) {
  if (items.some((row) => row.kind === item.kind && norm(row.name) === norm(item.name))) return
  items.push(item)
}

function asciiName(bytes: Uint8Array, off: number, n: number) {
  let out = ""
  for (let i = 0; i < n && off + i < bytes.length; i++) {
    const c = bytes[off + i]
    if (c === 0) break
    if (c >= 32 && c < 127) out += String.fromCharCode(c)
  }
  return out.trim()
}

function u32be(bytes: Uint8Array, off: number) {
  return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0
}

function printableName(bytes: Uint8Array, off: number, n: number) {
  let start = -1
  let end = -1
  for (let i = 0; i < n && off + i < bytes.length; i++) {
    const c = bytes[off + i]
    if (c >= 32 && c < 127 && c !== 92) {
      if (start < 0) start = i
      end = i
    } else if (start >= 0) {
      break
    }
  }
  if (start < 0 || end - start + 1 < 3) return ""
  let out = ""
  for (let i = start; i <= end; i++) out += String.fromCharCode(bytes[off + i])
  out = out.replace(/ +$/g, "")
  let letters = 0
  for (const ch of out) if (/[A-Za-z]/.test(ch)) letters++
  if (letters < 2 || out.length < 3 || out.length > 24) return ""
  return out
}

function fixedText(bytes: Uint8Array, off: number, n: number) {
  let out = ""
  for (let k = 0; k < n && off + k < bytes.length; k++) {
    const c = bytes[off + k]
    if (c === 0) break
    out += c >= 32 && c < 127 ? String.fromCharCode(c) : "?"
  }
  return out.replace(/\s+$/, "")
}

function hexOf(bytes: Uint8Array, off: number, n: number) {
  let out = ""
  for (let k = 0; k < n; k++) out += (bytes[off + k] ?? 0).toString(16).padStart(2, "0")
  return out
}

function stereoSide(name: string) {
  return name.replace(/[\s_-]*(?:-|\s)(L|R|M)$/i, "").replace(/[\s_-]+$/, "")
}

type KorfMulti = { name: string; id: string; group: string }

// PA4X KORF KMP: zone records (name16 + sampleId8 + ... + rate) come first, in
// multisample order; each multisample header is 0xA6 bytes with its zone count
// at +0x9C and a 6-byte id in its last 6 bytes.
function parseKorfMultisamples(kmp: Uint8Array): KorfMulti[] {
  const zones: string[] = []
  for (let i = 0; i + 32 < kmp.length; i++) {
    const rate = (kmp[i + 28] << 8) | kmp[i + 29]
    if (rate !== 44100 && rate !== 48000 && rate !== 32000 && rate !== 22050) continue
    if (kmp[i] < 65 || kmp[i] > 122) continue
    if (i > 0 && kmp[i - 1] !== 0 && kmp[i - 1] !== 0xff) continue
    const name = fixedText(kmp, i, 16)
    if (name.length < 4) continue
    zones.push(name)
    i += 24
  }
  const multis: KorfMulti[] = []
  let used = 0
  for (let i = 0; i + 0xa6 <= kmp.length; i++) {
    if (kmp[i] !== 0x80 || kmp[i + 1] !== 0 || kmp[i + 2] < 65 || kmp[i + 2] > 122) continue
    const name = fixedText(kmp, i + 2, 24)
    if (name.length < 4) continue
    const count = kmp[i + 2 + 0x9a]
    const own = zones.slice(used, used + count)
    used += count
    multis.push({ name, id: hexOf(kmp, i + 0xa6 - 6, 6), group: own.length ? stereoSide(own[0]) : "" })
    i += 0xa5
  }
  return used === zones.length ? multis : []
}

function korfProgramChunks(pcg: Uint8Array) {
  const names: string[] = []
  const chunks: string[] = []
  for (let i = 0; i + 40 < pcg.length; i++) {
    if (pcg[i] === 0 && pcg[i + 2] === 0 && pcg[i + 3] === 5 && pcg[i + 6] === 0 && pcg[i + 7] === 0x1c) {
      names.push(fixedText(pcg, i + 8, 24))
    }
    if (pcg[i + 8] === 0x4f && pcg[i + 9] === 0x43 && pcg[i + 10] === 0x33 && pcg[i + 11] === 0x31) {
      const sz = u32be(pcg, i + 4)
      if (sz > 0 && i + 8 + sz <= pcg.length) chunks.push(hexOf(pcg, i + 8, sz))
    }
  }
  return names.length === chunks.length ? names.map((name, k) => ({ name, hex: chunks[k] })) : []
}

function mainMultisample(program: string, hex: string, multis: KorfMulti[], setName: string) {
  const hits = multis
    .map((m) => ({ m, at: hex.indexOf(m.id) }))
    .filter((x) => x.at >= 0 && x.at % 2 === 0 && x.m.group)
    .sort((a, b) => a.at - b.at)
  if (!hits.length) return ""
  const base = (m: KorfMulti) => norm(stereoSide(packTrim(m.name, setName).replace(/^kapro\s*/i, "")))
  const paired = hits.filter((x) => {
    const b = base(x.m)
    return hits.some((y) => y !== x && base(y.m) === b)
  })
  const want = norm(packTrim(program, setName).replace(/^kapro\s*/i, ""))
  let best = paired[0] ?? hits[0]
  let bestLen = 0
  for (const x of hits) {
    const b = base(x.m)
    let p = 0
    while (p < b.length && p < want.length && b[p] === want[p]) p++
    if (p >= 4 && p > bestLen) {
      best = x
      bestLen = p
    }
  }
  return best.m.group
}

const programGroups = new Map<string, Promise<Map<string, string>>>()

function programSampleGroups(folder: Directory, setName: string) {
  const key = folder.uri
  let pending = programGroups.get(key)
  if (!pending) {
    pending = (async () => {
      const out = new Map<string, string>()
      try {
        const kmps: File[] = []
        const pcgs: File[] = []
        collectFiles(folder, (name) => /\.KMP$/i.test(name), kmps)
        collectFiles(folder, (name) => /\.PCG$/i.test(name), pcgs)
        const multis: KorfMulti[] = []
        for (const kmp of kmps) {
          if ((kmp.size ?? 0) > 16 * 1024 * 1024) continue
          multis.push(...parseKorfMultisamples(await Promise.resolve(kmp.bytes())))
        }
        if (!multis.length) return out
        for (const pcg of pcgs) {
          if ((pcg.size ?? 0) > 32 * 1024 * 1024) continue
          for (const prog of korfProgramChunks(await Promise.resolve(pcg.bytes()))) {
            const group = mainMultisample(prog.name, prog.hex, multis, setName)
            if (group) out.set(norm(prog.name), group)
          }
        }
      } catch (error) {
        console.log("[load] program map failed", folder.uri, error)
      }
      console.log("[load] program map", Object.fromEntries(out))
      return out
    })()
    programGroups.set(key, pending)
  }
  return pending
}

function parsePcgNames(bytes: Uint8Array) {
  const names: string[] = []
  const seen = new Set<string>()
  const consider = (name: string) => {
    if (!name || isGenericStem(name)) return
    const up = name.toUpperCase()
    if (up.includes(".KMP") || up.includes(".KSF") || up.includes(".PCM")) return
    if (name.includes("Z110A") || name.includes("v3.")) return
    const key = norm(name)
    if (seen.has(key)) return
    seen.add(key)
    names.push(name)
  }
  const korf = bytes.length >= 24 && bytes[0] === 1 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0x14
  if (korf) {
    for (let i = 0; i + 32 < bytes.length; i++) {
      if (!(bytes[i] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 5 && bytes[i + 6] === 0 && bytes[i + 7] === 0x1c)) {
        continue
      }
      consider(printableName(bytes, i + 8, 24))
    }
    if (names.length) return names
  }
  const isChunkId = (off: number) => {
    for (let k = 0; k < 4; k++) {
      const c = bytes[off + k]
      if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false
    }
    return true
  }
  for (let i = 0; i + 8 < bytes.length; ) {
    if (isChunkId(i)) {
      const sz = u32be(bytes, i + 4)
      if (sz >= 8 && sz < bytes.length && i + 8 + sz <= bytes.length) {
        const id = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
        if (id === "PRG1" || id === "PBS1" || id === "DKT1" || id === "CMB1" || id === "PRG2" || id === "PCG1") {
          const payload = i + 8
          for (let p = 0; p + 16 < sz; p += 16) consider(printableName(bytes, payload + p, 16))
        }
        i += 8 + sz
        continue
      }
    }
    i++
  }
  return names
}

function parseKmpGroupedNames(bytes: Uint8Array) {
  const names: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i + 32 <= bytes.length; i++) {
    if (bytes[i] < 65 || bytes[i] >= 127) continue
    if (!/[A-Za-z]/.test(String.fromCharCode(bytes[i]))) continue
    if (i > 0) {
      const prev = bytes[i - 1]
      if (
        (prev >= 48 && prev <= 57) ||
        (prev >= 65 && prev <= 90) ||
        (prev >= 97 && prev <= 122) ||
        prev === 32 ||
        prev === 45
      ) {
        continue
      }
    }
    const name = asciiName(bytes, i, 16)
    if (name.length < 4 || isGenericStem(name) || name.includes("Z110A") || name.includes("v3.")) continue
    let letters = 0
    for (const ch of name) if (/[A-Za-z]/.test(ch)) letters++
    if (letters < 3) continue
    const rate = (bytes[i + 28] << 8) | bytes[i + 29]
    if (rate !== 44100 && rate !== 48000 && rate !== 32000 && rate !== 22050) continue
    const key = norm(name)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function parseKmpNames(bytes: Uint8Array) {
  const names: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i + 24 < bytes.length; ) {
    if (bytes[i] !== 0x4d || bytes[i + 1] !== 0x53 || bytes[i + 2] !== 0x50 || bytes[i + 3] !== 0x31) {
      i++
      continue
    }
    const sz = u32be(bytes, i + 4)
    if (sz < 18 || i + 8 + sz > bytes.length) {
      i++
      continue
    }
    let name = asciiName(bytes, i + 8, 16)
    let cursor = i + 8 + sz
    let confirmed = false
    if (
      cursor + 8 <= bytes.length &&
      bytes[cursor] === 0x4e &&
      bytes[cursor + 1] === 0x41 &&
      bytes[cursor + 2] === 0x4d &&
      bytes[cursor + 3] === 0x45
    ) {
      const nsz = u32be(bytes, cursor + 4)
      if (cursor + 8 + nsz <= bytes.length) {
        const longer = asciiName(bytes, cursor + 8, Math.min(24, nsz))
        if (longer) name = longer
        cursor += 8 + nsz
        confirmed = true
      }
    }
    if (
      cursor + 4 <= bytes.length &&
      bytes[cursor] === 0x52 &&
      bytes[cursor + 1] === 0x4c &&
      bytes[cursor + 2] === 0x50 &&
      bytes[cursor + 3] === 0x31
    ) {
      confirmed = true
    }
    if (!confirmed) {
      i = Math.max(cursor, i + 8)
      continue
    }
    const key = norm(name)
    if (name.length >= 2 && !isGenericStem(name) && !seen.has(key)) {
      seen.add(key)
      names.push(name)
    }
    i = Math.max(cursor, i + 8)
  }
  if (names.length) return names
  return parseKmpGroupedNames(bytes)
}

function childNamed(parent: Directory, want: string) {
  try {
    for (const child of parent.list()) {
      if (!child.name || child.name.startsWith(".")) continue
      if (child.name.toUpperCase() !== want) continue
      if (isDirectory(child) || isSetName(child.name)) return asDirectory(child)
    }
  } catch {
    return null
  }
  return null
}

async function namesFromKmp(file: File) {
  const size = typeof file.size === "number" ? file.size : 0
  if (size <= 0 || size > 8 * 1024 * 1024) return []
  try {
    const bytes = await Promise.resolve(file.bytes())
    return parseKmpNames(bytes)
  } catch {
    return []
  }
}

async function namesFromPcg(file: File) {
  const size = typeof file.size === "number" ? file.size : 0
  if (size > 32 * 1024 * 1024) return []
  try {
    const bytes = await Promise.resolve(file.bytes())
    return parsePcgNames(bytes)
  } catch {
    return []
  }
}

function collectFiles(dir: Directory, test: (name: string) => boolean, out: File[]) {
  try {
    for (const child of dir.list()) {
      if (!child.name || child.name.startsWith(".")) continue
      if (isDirectory(child) || isSetName(child.name)) {
        collectFiles(asDirectory(child), test, out)
        continue
      }
      if (test(child.name)) out.push(child as File)
    }
  } catch {
    // Native catalog still lists SOUND/KMP.
  }
}

async function readCatalogAtPath(path: string, setName: string, setPath: string) {
  if (!path) return null
  try {
    const uri = path.startsWith("file:") ? path : `file://${path.replace(/\\/g, "/")}`
    const file = new File(uri)
    if (!file.exists) return null
    return parseCatalogFile(await Promise.resolve(file.text()), setName, setPath)
  } catch {
    return null
  }
}

function mergeCatalog(from: DiskCatalog | null, into: DiskCatalog) {
  if (!from) return
  for (const item of from.sounds) pushItem(into.sounds, item)
  for (const item of from.styles) pushItem(into.styles, item)
  for (const item of from.pads) pushItem(into.pads, item)
}

async function ingestNativeCatalog(path: string, setName: string, setPath: string, into: DiskCatalog) {
  try {
    const raw = await audio.listPa4xCatalog(path)
    console.log("[catalog] native", path, String(raw).slice(0, 280))
    let report: { file?: string } = {}
    try {
      report = JSON.parse(String(raw)) as { file?: string }
    } catch {
      report = {}
    }
    const cached = await readCatalogAtPath(report.file || `${path.replace(/\\/g, "/")}/.arrangerbox-cache/catalog.json`, setName, setPath)
    mergeCatalog(cached, into)
  } catch (error) {
    console.log("[catalog] native failed", path, error)
  }
}

async function mergeCachedCatalog(
  folder: Directory,
  setName: string,
  setPath: string,
  into: DiskCatalog
) {
  const cached = await readCachedCatalog(folder, setName, setPath)
  if (!cached) return
  for (const item of cached.sounds) pushItem(into.sounds, item)
  for (const item of cached.styles) pushItem(into.styles, item)
  for (const item of cached.pads) pushItem(into.pads, item)
}

async function namesFromManifest(setFolder: Directory, setName: string, setPath: string, into: DiskCatalog) {
  try {
    const cache = new Directory(setFolder, ".arrangerbox-cache")
    const file = new File(cache, "manifest.txt")
    if (!file.exists) return
    const parsed = parseConvertedManifest(await Promise.resolve(file.text()))
    console.log("[catalog] manifest", nativePath(cache), {
      samples: parsed.samples.length,
      patches: parsed.patches.length,
      names: parsed.patches.slice(0, 16).map((patch) => patch.name),
    })
    const groups = new Map<string, { name: string; cacheName: string; wav: string; cat: string }>()
    for (const patch of parsed.patches) {
      const name = instrumentName(patch.name) || patch.name
      if (!name || isGenericStem(name)) continue
      const key = norm(name)
      let wav = ""
      let dist = 999
      for (const zone of patch.zones) {
        const sample = parsed.samples[zone.sampleIdx]
        if (!sample?.wavName) continue
        const gap = Math.abs((zone.root || sample.root || 60) - 60)
        if (gap <= dist) {
          dist = gap
          wav = sample.wavName
        }
      }
      if (!wav) continue
      if (!groups.has(key)) {
        groups.set(key, { name, cacheName: patch.name, wav, cat: categoryGuess(name, "Imported") })
      }
    }
    for (const item of groups.values()) {
      pushItem(into.sounds, {
        kind: "sound",
        name: item.name,
        category: item.cat,
        fileName: item.wav,
        cacheName: item.cacheName,
        setPath,
        setName,
      })
    }
  } catch (error) {
    console.log("[catalog] manifest failed", error)
  }
}

async function walkDiskSet(dir: Directory, setName: string, setPath: string, into: DiskCatalog, sounds: boolean) {
  let children: Array<Directory | File> = []
  try {
    children = dir.list()
  } catch {
    return
  }
  for (const child of children) {
    if (!child.name || child.name.startsWith(".")) continue
    if (isDirectory(child) || isSetName(child.name)) {
      await walkDiskSet(asDirectory(child), setName, setPath, into, sounds)
      continue
    }
    const file = child as File
    const upper = file.name.toUpperCase()
    if (/\.(WAV|KSF|PCG)$/i.test(upper)) continue
    if (/\.KMP$/i.test(upper) && !sounds) continue
    if (/\.KMP$/i.test(upper)) {
      const names = (await namesFromKmp(file)).map(instrumentName)
      const list = names.length ? names : isGenericStem(stem(file.name)) ? [] : [instrumentName(stem(file.name))]
      for (const name of list) {
        pushItem(into.sounds, {
          kind: "sound",
          name,
          category: categoryGuess(name, "Imported"),
          fileName: file.name,
          setPath,
          setName,
        })
      }
      continue
    }
    let kind: LibraryKind | null = null
    if (/\.(WAV|KSF)$/i.test(upper)) kind = "sound"
    else if (/\.(STY|STG|MID|SMF)$/i.test(upper)) kind = "style"
    else if (/\.PAD$/i.test(upper)) kind = "pad"
    if (!kind) continue
    const name = instrumentName(stem(file.name))
    if (isGenericStem(name)) continue
    pushItem(kind === "sound" ? into.sounds : kind === "pad" ? into.pads : into.styles, {
      kind,
      name,
      category: categoryGuess(name, kind === "sound" ? "Imported" : "Style"),
      fileName: file.name,
      setPath,
      setName,
    })
  }
}

function parseCatalogFile(raw: string, setName: string, setPath: string): DiskCatalog | null {
  try {
    const json = JSON.parse(raw) as {
      items?: { kind?: string; name?: string; category?: string; file?: string; cache?: string }[]
    }
    if (!Array.isArray(json.items)) return null
    const out: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
    for (const item of json.items) {
      const kind = item.kind === "pad" ? "pad" : item.kind === "sound" ? "sound" : "style"
      const name = kind === "sound" ? programName(item.name || "") : item.name?.trim()
      if (!name || isGenericStem(name)) continue
      pushItem(kind === "sound" ? out.sounds : kind === "pad" ? out.pads : out.styles, {
        kind,
        name,
        category: item.category || categoryGuess(name, kind === "sound" ? "Imported" : "Style"),
        fileName: item.file || "",
        cacheName: item.cache,
        setPath,
        setName,
      })
    }
    return out
  } catch {
    return null
  }
}

function listSavedSetDirs() {
  const root = new Directory(Paths.document, "sets")
  if (!root.exists) return []
  const out: Directory[] = []
  try {
    for (const child of root.list()) {
      if (!child.name || child.name.startsWith(".")) continue
      out.push(asDirectory(child))
    }
  } catch {
    return out
  }
  return out
}

async function readCachedCatalog(setFolder: Directory, setName: string, setPath: string) {
  try {
    const cacheFile = new File(new Directory(setFolder, ".arrangerbox-cache"), "catalog.json")
    if (!cacheFile.exists) return null
    return parseCatalogFile(await Promise.resolve(cacheFile.text()), setName, setPath)
  } catch {
    return null
  }
}

function writeCatalogJson(folder: Directory, into: DiskCatalog) {
  try {
    const cache = new Directory(folder, ".arrangerbox-cache")
    if (!cache.exists) cache.create({ intermediates: true })
    const file = new File(cache, "catalog.json")
    if (!file.exists) file.create()
    const items = [
      ...into.sounds.map((item) => ({
        kind: "sound",
        name: item.name,
        category: item.category,
        file: item.fileName,
        cache: item.cacheName,
      })),
      ...into.styles.map((item) => ({
        kind: "style",
        name: item.name,
        category: item.category,
        file: item.fileName,
      })),
      ...into.pads.map((item) => ({
        kind: "pad",
        name: item.name,
        category: item.category,
        file: item.fileName,
      })),
    ]
    file.write(JSON.stringify({ ok: 1, items }))
  } catch (error) {
    console.log("[catalog] write cache failed", error)
  }
}

async function catalogOneSet(dir: Directory): Promise<DiskCatalog> {
  const setFolder = findSetFolder(dir)
  const setName = setFolder.name.replace(/\.SET$/i, "") || "Imported"
  const setPath = nativePath(setFolder)
  const into: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
  const fromManifest: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
  const soundDir = childNamed(setFolder, "SOUND")
  const pcgs: File[] = []
  const kmps: File[] = []
  collectFiles(setFolder, (name) => /\.PCG$/i.test(name), pcgs)
  collectFiles(setFolder, (name) => /\.KMP$/i.test(name), kmps)
  console.log("[catalog] set", {
    setName,
    setPath,
    uri: setFolder.uri,
    listing: (() => {
      try {
        return setFolder.list().map((item) => item.name)
      } catch (error) {
        return [`list failed: ${error instanceof Error ? error.message : String(error)}`]
      }
    })(),
    soundDir: soundDir ? nativePath(soundDir) : "",
    pcg: pcgs.map((file) => file.name),
    kmp: kmps.map((file) => file.name),
  })
  await namesFromManifest(setFolder, setName, setPath, fromManifest)
  if (soundDir) await namesFromManifest(soundDir, setName, setPath, fromManifest)

  const fromPcg: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
  for (const pcg of pcgs.slice(0, 4)) {
    const names = await namesFromPcg(pcg)
    console.log("[catalog] pcg names", pcg.name, names)
    for (const raw of names) {
      const name = programName(raw)
      if (!name || isGenericStem(name) || isSetLeftover(name, setName)) continue
      pushItem(fromPcg.sounds, {
        kind: "sound",
        name,
        category: categoryGuess(name, "Imported"),
        fileName: "",
        setPath,
        setName,
      })
    }
  }

  const native: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
  await ingestNativeCatalog(setPath, setName, setPath, native)
  native.sounds = collapseInstruments(native.sounds)
  into.styles = native.styles
  into.pads = native.pads

  const attachWav = (items: DiskItem[]) => {
    const cache = fromManifest.sounds
    const used = new Set<number>()
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      let best = 0
      let bestJ = -1
      for (let j = 0; j < cache.length; j++) {
        if (used.has(j)) continue
        const s = distinctiveScore(cache[j].cacheName || cache[j].name, item.name, setName)
        if (s > best) {
          best = s
          bestJ = j
        }
      }
      const j = best >= 200 && bestJ >= 0 ? bestJ : !used.has(i) && cache[i] ? i : bestJ
      if (j < 0 || !cache[j]) continue
      used.add(j)
      item.fileName = cache[j].fileName
      item.cacheName = cache[j].cacheName || cache[j].name
    }
    const usedKmp = new Set<number>()
    for (const item of items) {
      if (item.cacheName) continue
      let best = 0
      let bestJ = -1
      for (let j = 0; j < native.sounds.length; j++) {
        if (usedKmp.has(j)) continue
        const s = distinctiveScore(native.sounds[j].name, item.name, setName)
        if (s > best) {
          best = s
          bestJ = j
        }
      }
      if (best < 200 || bestJ < 0) continue
      usedKmp.add(bestJ)
      item.cacheName = native.sounds[bestJ].name
    }
  }

  const usedPcg = fromPcg.sounds.length >= 8 && fromPcg.sounds.length <= 16
  if (usedPcg) {
    into.sounds = fromPcg.sounds
  } else if (fromManifest.sounds.length) {
    into.sounds = fromManifest.sounds
  } else {
    into.sounds = native.sounds
  }
  attachWav(into.sounds)
  await walkDiskSet(setFolder, setName, setPath, into, into.sounds.length === 0)
  if (!usedPcg) into.sounds = collapseInstruments(into.sounds)
  into.styles = collapseInstruments(into.styles)
  into.pads = collapseInstruments(into.pads)
  console.log("[catalog] sound sources", {
    pcg: fromPcg.sounds.map((item) => item.name),
    manifest: fromManifest.sounds.length,
    native: native.sounds.length,
    using: into.sounds.map((item) => item.name),
  })
  writeCatalogJson(setFolder, into)
  console.log("[catalog] done", setName, {
    sounds: into.sounds.length,
    styles: into.styles.length,
    pads: into.pads.length,
    sample: into.sounds.slice(0, 12).map((item) => `${item.name} [${item.fileName}]`),
  })
  return into
}

export async function cachedFileName(setPath: string | undefined, kind: LibraryKind, name: string) {
  if (!setPath || !name) return undefined
  try {
    const cacheFile = new File(new Directory(setPath, ".arrangerbox-cache"), "catalog.json")
    if (!cacheFile.exists) return undefined
    const parsed = parseCatalogFile(await Promise.resolve(cacheFile.text()), "", setPath)
    const list = kind === "sound" ? parsed?.sounds : kind === "pad" ? parsed?.pads : parsed?.styles
    return list?.find((item) => norm(item.name) === norm(name))?.fileName
  } catch {
    return undefined
  }
}

export function setPathForName(setName?: string) {
  const root = new Directory(Paths.document, "sets")
  if (!root.exists) return undefined
  try {
    if (setName) {
      for (const name of [setName, `${setName}.SET`, setName.replace(/\.SET$/i, "")]) {
        const dir = new Directory(root, name)
        if (dir.exists) return nativePath(findSetFolder(asDirectory(dir)))
      }
    }
    const dirs = listSavedSetDirs()
    if (!dirs.length) return undefined
    return nativePath(findSetFolder(dirs[0]))
  } catch {
    return undefined
  }
}

let lastDiskCatalog: DiskCatalog | null = null

export function lastLoadedDiskCatalog(): DiskCatalog {
  return lastDiskCatalog ?? { setName: "", sounds: [], styles: [], pads: [] }
}

export async function loadDiskCatalog(): Promise<DiskCatalog> {
  const dirs = listSavedSetDirs()
  console.log(
    "[catalog] saved sets",
    dirs.map((dir) => dir.uri)
  )
  const merged: DiskCatalog = { setName: "", sounds: [], styles: [], pads: [] }
  for (const dir of dirs) {
    const next = await catalogOneSet(dir)
    if (!merged.setName) merged.setName = next.setName
    for (const item of next.sounds) pushItem(merged.sounds, item)
    for (const item of next.styles) pushItem(merged.styles, item)
    for (const item of next.pads) pushItem(merged.pads, item)
  }
  lastDiskCatalog = merged
  return merged
}

function isFactory(source?: string) {
  return (source ?? "FACTORY").toUpperCase() === "FACTORY"
}

export function mergeSounds(engine: SoundItem[], disk: DiskItem[]): SoundItem[] {
  const factory = engine
    .filter((item) => isFactory(item.source))
    .map((item) => ({
      ...item,
      loaded: true,
      engineId: item.id,
      source: item.source ?? "FACTORY",
      bank: "FACTORY",
    }))
  const imported = engine.filter((item) => !isFactory(item.source))
  const out: SoundItem[] = [...factory]
  disk.forEach((item, index) => {
    const hit = imported.find(
      (row) =>
        norm(row.name) === norm(item.name) ||
        (!!item.cacheName && norm(row.name) === norm(item.cacheName || ""))
    )
    out.push({
      id: DISK_SOUND + index,
      name: item.name,
      category: item.category,
      source: "IMPORTED",
      bank: "IMPORTED",
      loaded: !!hit,
      engineId: hit?.id,
      setPath: item.setPath,
      fileName: item.fileName,
      cacheName: item.cacheName,
    })
  })
  return out
}

export function mergeStyles(engine: StyleItem[], disk: DiskItem[]): StyleItem[] {
  const out: StyleItem[] = engine.map((item) => ({
    ...item,
    loaded: true,
    engineId: item.id,
    source: item.source ?? "FACTORY",
    bank: isFactory(item.source) ? "FACTORY" : "IMPORTED",
  }))
  let nextId = Math.max(DISK_STYLE, ...out.map((item) => item.id + 1), DISK_STYLE)
  for (const item of disk) {
    const hit = out.find((row) => !isFactory(row.source) && norm(row.name) === norm(item.name))
    if (hit) {
      hit.setPath = item.setPath
      hit.fileName = item.fileName
      continue
    }
    out.push({
      id: nextId++,
      name: item.name,
      category: item.category === "Style" ? "World" : item.category,
      tempo: 0,
      source: "IMPORTED",
      bank: "IMPORTED",
      loaded: false,
      setPath: item.setPath,
      fileName: item.fileName,
    })
  }
  return out
}

export function mergePads(engine: StyleItem[], disk: DiskItem[]): PadItem[] {
  const loadedNames = new Set(
    engine.filter((item) => !isFactory(item.source)).map((item) => norm(item.name))
  )
  const out: PadItem[] = []
  let nextId = DISK_PAD
  for (const item of disk) {
    const loaded = loadedNames.has(norm(item.name))
    const engineHit = engine.find((row) => !isFactory(row.source) && norm(row.name) === norm(item.name))
    out.push({
      id: engineHit?.id ?? nextId++,
      name: item.name,
      category: item.category,
      source: "IMPORTED",
      bank: "IMPORTED",
      loaded,
      engineId: engineHit?.id,
      setPath: item.setPath,
      fileName: item.fileName,
    })
  }
  return out
}

function parseReport(raw: string): LoadResult {
  try {
    const json = JSON.parse(raw) as { ok?: number; engineId?: number; reason?: string; patches?: number; styles?: number }
    const engineId = json.engineId ?? -1
    const ok = (json.ok ?? 0) === 1 && engineId >= 0
    return { ok, engineId, reason: json.reason?.trim() || (ok ? "" : "Could not load this item.") }
  } catch {
    return { ok: false, engineId: -1, reason: "Could not load this item." }
  }
}

function childPath(setPath: string, fileName: string) {
  if (!fileName) return setPath
  const slash = setPath.includes("\\") ? "\\" : "/"
  return `${setPath.replace(/[\\/]$/, "")}${slash}${fileName}`
}

function scoreName(have: string, want: string) {
  const a = norm(have)
  const b = norm(want)
  if (!a || !b) return 0
  if (a === b) return 1000
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length >= 6 && longer.includes(shorter)) {
    return (a.includes(b) ? 400 : 300) + shorter.length
  }
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  if (p >= 6 && (p === a.length || p === b.length)) return 100 + p
  if (p >= 8 && p * 10 >= shorter.length * 6) return 100 + p
  return 0
}

function distinctiveScore(have: string, want: string, setName?: string) {
  return scoreName(instrumentName(packTrim(have, setName)), instrumentName(packTrim(want, setName)))
}

function asDir(path: string) {
  const uri = path.startsWith("file:") ? path : `file://${path.replace(/\\/g, "/")}`
  return new Directory(uri)
}

function resolveSetFolder(setPath?: string): Directory | null {
  const dirs = listSavedSetDirs()
  const want = (setPath || "").replace(/\\/g, "/").replace(/\/$/, "")
  const wantName = want.split("/").filter(Boolean).pop()?.replace(/\.SET$/i, "") || ""
  for (const dir of dirs) {
    const folder = findSetFolder(asDirectory(dir))
    const path = nativePath(folder).replace(/\\/g, "/")
    const uri = (folder.uri || "").replace(/\\/g, "/")
    if (!want) return folder
    if (path === want || uri === want) return folder
    if (path.endsWith(want) || want.endsWith(path) || uri.endsWith(want)) return folder
    const folderName = folder.name.replace(/\.SET$/i, "")
    const dirName = dir.name.replace(/\.SET$/i, "")
    if (wantName && (folderName === wantName || dirName === wantName)) return folder
  }
  if (setPath) {
    try {
      const folder = findSetFolder(asDir(setPath))
      if (folder.exists) return folder
    } catch {
      // Fall through to the first saved SET.
    }
  }
  return dirs.length ? findSetFolder(asDirectory(dirs[0])) : null
}

function cacheDirOf(folder: Directory) {
  const dirs: Directory[] = []
  const seen = new Set<string>()
  const add = (dir: Directory) => {
    try {
      const key = dir.uri || nativePath(dir)
      if (!key || seen.has(key) || !dir.exists) return
      seen.add(key)
      dirs.push(dir)
    } catch {
      // Skip unreadable folders.
    }
  }
  add(new Directory(folder, ".arrangerbox-cache"))
  const sound = childNamed(folder, "SOUND")
  if (sound) add(new Directory(sound, ".arrangerbox-cache"))
  try {
    for (const child of folder.list()) {
      if (child.name === ".arrangerbox-cache") add(asDirectory(child))
      if (!child.name || child.name.startsWith(".")) continue
      if (isDirectory(child) || isSetName(child.name)) {
        add(new Directory(asDirectory(child), ".arrangerbox-cache"))
      }
    }
  } catch {
    // SET listing is enough when the cache sits next to SOUND.
  }
  return dirs
}

function parseConvertedManifest(text: string) {
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length && !/^S\s+\d+/.test(lines[i])) i++
  const nS = parseInt(lines[i++]?.match(/^S\s+(\d+)/)?.[1] || "0", 10)
  const samples: { wavName: string; sampleName: string; root: number }[] = []
  for (let s = 0; s < nS && i + 2 < lines.length; s++) {
    const wavName = (lines[i++] || "").trim()
    const sampleName = (lines[i++] || "").trim()
    const nums = (lines[i++] || "").trim().split(/\s+/)
    samples.push({ wavName, sampleName, root: parseInt(nums[2] || "60", 10) || 60 })
  }
  while (i < lines.length && !/^P\s+\d+/.test(lines[i])) i++
  const nP = parseInt(lines[i++]?.match(/^P\s+(\d+)/)?.[1] || "0", 10)
  const patches: { name: string; score: number; group: string; zones: { sampleIdx: number; root: number }[] }[] = []
  for (let p = 0; p < nP && i < lines.length; p++) {
    const name = (lines[i++] || "").trim()
    i++
    i++
    const nZ = parseInt(lines[i++] || "0", 10)
    const zones: { sampleIdx: number; root: number }[] = []
    for (let z = 0; z < nZ && i < lines.length; z++) {
      const parts = (lines[i++] || "").trim().split(/\s+/)
      zones.push({ sampleIdx: parseInt(parts[0] || "-1", 10), root: parseInt(parts[5] || "60", 10) || 60 })
    }
    if (!name || !zones.length) continue
    patches.push({ name, score: 0, group: instrumentName(name), zones })
  }
  return { samples, patches }
}

function wavOpenPaths(file: File) {
  const p = nativePath(file)
  const uri = file.uri || ""
  const stripped = uri.replace(/^file:\/\/localhost/i, "file://").replace(/^file:\/\//, "")
  return [
    p,
    p.startsWith("/var/") ? `/private${p}` : "",
    p.startsWith("/private/") ? p.slice("/private".length) : "",
    uri,
    stripped,
    decodeURIComponent(stripped),
  ].filter(Boolean)
}

async function loadWavFile(file: File, name: string) {
  const staged = new Directory(Paths.cache, "ab-user")
  try {
    if (!staged.exists) staged.create({ intermediates: true, idempotent: true })
  } catch {
    // Original file path still tried below.
  }
  const dest = new File(staged, file.name || `${norm(name) || "tap"}.wav`)
  try {
    const small = typeof dest.size === "number" && dest.size < 44
    if (!dest.exists || small) await Promise.resolve(file.copy(dest, { overwrite: true }))
  } catch (error) {
    console.log("[load] wav copy failed", name, error)
  }
  const files = dest.exists ? [dest, file] : [file]
  const paths: string[] = []
  for (const row of files) paths.push(...wavOpenPaths(row))
  for (const path of [...new Set(paths)]) {
    const id = await audio.loadWav(path, name, categoryGuess(name, "Imported"))
    console.log("[load] wav", name, path, id)
    if (id >= 0) return id
  }
  return -1
}

function wavInCache(dir: Directory, wavName: string) {
  try {
    const want = wavName.toLowerCase()
    for (const child of dir.list()) {
      if (child.name?.toLowerCase() === want) return child as File
    }
    const direct = new File(dir, wavName)
    if (direct.exists) return direct
  } catch {
    return null
  }
  return null
}

async function resolveCachePatch(folder: Directory, want: string, setName?: string) {
  for (const dir of cacheDirOf(folder)) {
    try {
      const file = new File(dir, "manifest.txt")
      if (!file.exists) continue
      const parsed = parseConvertedManifest(await Promise.resolve(file.text()))
      let best = 0
      let cacheName = ""
      let wavName = ""
      for (const patch of parsed.patches) {
        const s = distinctiveScore(patch.name, want, setName)
        if (s <= best) continue
        best = s
        cacheName = patch.name
        let dist = 999
        wavName = ""
        for (const zone of patch.zones) {
          const gap = Math.abs(zone.root - 60)
          if (zone.sampleIdx >= 0 && gap <= dist) {
            dist = gap
            wavName = parsed.samples[zone.sampleIdx]?.wavName || wavName
          }
        }
      }
      if (best >= 200 && cacheName) return { cacheName, wavName, score: best }
    } catch (error) {
      console.log("[load] resolve cache patch failed", dir.uri, error)
    }
  }
  return null
}

function cacheWavPaths(folder: Directory, wavName: string) {
  const root = nativePath(folder).replace(/\\/g, "/").replace(/\/$/, "")
  return [
    `${root}/.arrangerbox-cache/${wavName}`,
    `${root}/SOUND/.arrangerbox-cache/${wavName}`,
    `/private${root}/.arrangerbox-cache/${wavName}`,
    `/private${root}/SOUND/.arrangerbox-cache/${wavName}`,
  ]
}

async function loadWavByPath(path: string, name: string) {
  const id = await audio.loadWav(path, name, categoryGuess(name, "Imported"))
  console.log("[load] wav path", name, path, id)
  return id
}

async function loadConvertedCacheSound(want: string, folder: Directory, fileName?: string): Promise<LoadResult | null> {
  const names: string[] = []
  if (fileName && /\.wav$/i.test(fileName)) names.push(fileName)
  for (const wavName of names) {
    for (const path of cacheWavPaths(folder, wavName)) {
      const id = await loadWavByPath(path, want)
      if (id >= 0) return { ok: true, engineId: id, reason: "" }
    }
    for (const dir of cacheDirOf(folder)) {
      const wav = wavInCache(dir, wavName)
      if (!wav) continue
      const id = await loadWavFile(wav, want)
      if (id >= 0) return { ok: true, engineId: id, reason: "" }
    }
  }
  return null
}

async function loadUserSound(item: {
  name: string
  setPath?: string
  fileName?: string
  cacheName?: string
}): Promise<LoadResult> {
  const folder = resolveSetFolder(item.setPath)
  if (!folder) return { ok: false, engineId: -1, reason: "SET folder missing." }
  const setName = folder.name.replace(/\.SET$/i, "")
  let fileName = item.fileName?.trim() || ""
  if (!fileName) {
    const resolved = await resolveCachePatch(folder, item.name, setName)
    if (resolved?.wavName) fileName = resolved.wavName
  }
  const wav = fileName ? await loadConvertedCacheSound(item.name, folder, fileName) : null
  if (wav) return wav
  const trimmed = packTrim(item.name, setName)
  const mapped = (await programSampleGroups(folder, setName)).get(norm(item.name))
  const nativeName = mapped || item.cacheName?.trim() || (norm(trimmed).length >= 6 ? trimmed : item.name)
  try {
    const started = Date.now()
    const raw = await audio.loadPa4xNamed(nativePath(folder), "sound", nativeName)
    console.log("[load] native", item.name, "as", nativeName, `${Date.now() - started}ms`, String(raw).slice(0, 280))
    const result = parseReport(raw)
    if (result.ok) return result
    return { ok: false, engineId: -1, reason: result.reason || "Could not load that User sound from the SET." }
  } catch (error) {
    console.log("[load] native threw", item.name, error)
    return { ok: false, engineId: -1, reason: "Could not load that User sound from the SET." }
  }
}

export async function loadDiskItem(item: {
  kind: LibraryKind
  name: string
  setPath?: string
  fileName?: string
  cacheName?: string
}): Promise<LoadResult> {
  const folder = resolveSetFolder(item.setPath)
  const setPath = folder ? nativePath(folder) : item.setPath || ""
  if (item.kind === "sound") {
    return loadUserSound(item)
  }
  if (setPath) {
    const raw = await audio.loadPa4xNamed(setPath, item.kind, item.name)
    console.log("[load]", item.kind, item.name, String(raw).slice(0, 240))
    const result = parseReport(raw)
    if (result.ok || !/cannot load one item/i.test(result.reason)) return result
  }
  const fileName = item.fileName ?? ""
  const path = setPath ? childPath(setPath, fileName) : ""
  if (/\.(WAV)$/i.test(fileName) && path) {
    const id = await audio.loadWav(path, item.name, categoryGuess(item.name, "Imported"))
    return id >= 0
      ? { ok: true, engineId: id, reason: "" }
      : { ok: false, engineId: -1, reason: "WAV did not load." }
  }
  if (/\.(MID|SMF)$/i.test(fileName) && path) {
    return parseReport(await audio.loadPa4xSet(path))
  }
  if (item.kind === "style" || item.kind === "pad") {
    return {
      ok: false,
      engineId: -1,
      reason:
        item.kind === "pad"
          ? "Pad Record > Export SMF, then Import that MID."
          : "Style Record > Export SMF, then Import that MID.",
    }
  }
  return {
    ok: false,
    engineId: -1,
    reason: "Could not load this item.",
  }
}
