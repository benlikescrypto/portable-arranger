#!/usr/bin/env node
/** Faithful port of Pa4xLoader style SMF ingest, for host testing. */
import fs from "node:fs"

function ru32be(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
}
function ru16be(b, i) {
  return (b[i] << 8) | b[i + 1]
}
function readVlq(b, st) {
  let v = 0
  for (let g = 0; g < 4 && st.i < st.end; g++) {
    const x = b[st.i++]
    v = (v << 7) | (x & 0x7f)
    if (!(x & 0x80)) break
  }
  return v
}
function lowerCopy(s) {
  return s.toLowerCase()
}
function squashSpaces(s) {
  return s.replace(/[\s_\-]+/g, " ").trim()
}

function markerSection(raw) {
  let s = squashSpaces(lowerCopy(raw.replace(/\0+$/g, "")))
  if (s.startsWith("sff") || s === "sint" || s === "sdec") return -1
  if (s.includes("main a")) return 3
  if (s.includes("main b")) return 4
  if (s.includes("main c")) return 5
  if (s.includes("main d")) return 6
  if (s.includes("intro a") || s === "intro 1" || s.includes("intro1")) return 0
  if (s.includes("intro b") || s === "intro 2" || s.includes("intro2")) return 1
  if (s.includes("intro c") || s === "intro 3" || s.includes("intro3")) return 2
  if (s.includes("fill in aa") || s.includes("fill aa") || s.includes("fill in a")) return 7
  if (s.includes("fill in bb") || s.includes("fill bb") || s.includes("fill in b")) return 8
  if (s.includes("fill in cc") || s.includes("fill cc") || s.includes("fill in c")) return 9
  if (s.includes("fill in dd") || s.includes("fill dd") || s.includes("fill in d")) return 10
  if (s.includes("ending a") || s.includes("ending 1")) return 12
  if (s.includes("ending b") || s.includes("ending 2")) return 13
  if (s.includes("ending c") || s.includes("ending 3")) return 14
  if (s.includes("break")) return 11
  const m = s.match(/[vifeb][1-4]cv[1-6]/)
  if (!m) return -1
  const elem = m[0][0]
  const n = m[0][1] - "0"
  const cv = m[0][4] - "0"
  if (cv !== 1) return -2
  if (elem === "i") return Math.min(2, n - 1)
  if (elem === "v") return 2 + n
  if (elem === "f") return 6 + n
  if (elem === "b") return 11
  if (elem === "e") return 11 + n
  return -1
}

function parseSmfTrack(b, start, n) {
  const end = start + n
  const st = { i: start, end }
  let tick = 0
  let running = 0
  const notes = []
  const markers = []
  const programs = Array(16).fill(-1)
  const onTick = Array.from({ length: 16 }, () => Array(128).fill(-1))
  const onVel = Array.from({ length: 16 }, () => Array(128).fill(0))
  const close = (ch, note, at) => {
    if (ch < 0 || ch > 15 || note < 0 || note > 127) return
    if (onTick[ch][note] >= 0) {
      notes.push({ tick: onTick[ch][note], ch, note, vel: onVel[ch][note], dur: Math.max(1, at - onTick[ch][note]) })
      onTick[ch][note] = -1
    }
  }
  while (st.i < end) {
    tick += readVlq(b, st)
    if (st.i >= end) break
    let status = b[st.i]
    if (status < 0x80) {
      if (!running) break
      status = running
    } else {
      st.i++
      if (status < 0xf0) running = status
    }
    const type = status & 0xf0
    const ch = status & 0x0f
    if (status === 0xff) {
      if (st.i >= end) break
      const meta = b[st.i++]
      const len = readVlq(b, st)
      if (st.i + len > end) break
      if ((meta === 0x06 || meta === 0x03) && len > 0) {
        markers.push({ tick, name: b.subarray(st.i, st.i + len).toString("latin1") })
      }
      st.i += len
      continue
    }
    if (status === 0xf0 || status === 0xf7) {
      const len = readVlq(b, st)
      st.i += len
      continue
    }
    if (type === 0x90 || type === 0x80) {
      if (st.i + 1 >= end) break
      const note = b[st.i]
      const vel = b[st.i + 1]
      st.i += 2
      if (type === 0x80 || vel === 0) close(ch, note, tick)
      else {
        close(ch, note, tick)
        onTick[ch][note] = tick
        onVel[ch][note] = vel
      }
    } else if (type === 0xc0) {
      if (st.i >= end) break
      programs[ch] = b[st.i++] & 0x7f
    } else if (type === 0xd0) {
      st.i++
    } else if (type === 0xf0) {
      running = 0
    } else {
      st.i += 2
    }
  }
  for (let ch = 0; ch < 16; ch++) for (let nte = 0; nte < 128; nte++) if (onTick[ch][nte] >= 0) close(ch, nte, tick)
  return { notes, markers, programs }
}

function applyCasm(b, notes, programs) {
  const map = [...Array(16).keys()]
  let any = false
  const walk = (tag) => {
    const t = Buffer.from(tag)
    for (let i = 0; i + 18 <= b.length; i++) {
      if (!b.subarray(i, i + 4).equals(t)) continue
      const sz = ru32be(b, i + 4)
      if (sz < 10 || sz > 512 || i + 8 + sz > b.length) continue
      const src = b[i + 8]
      const dst = b[i + 8 + 9]
      if (src > 15 || dst < 8 || dst > 15) continue
      map[src] = dst
      any = true
    }
  }
  walk("Ctab")
  walk("Ctb2")
  if (!any) return { notes, programs, mapped: false, map }
  const nextProg = Array(16).fill(-1)
  for (let c = 0; c < 16; c++) if (programs[c] >= 0 && map[c] >= 0) nextProg[map[c]] = programs[c]
  return {
    notes: notes.map((n) => ({ ...n, ch: n.ch >= 0 && n.ch < 16 ? map[n.ch] : n.ch })),
    programs: nextProg,
    mapped: true,
    map,
  }
}

function keepStyleChannels(notes, yamaha) {
  if (!notes.length) return notes
  if (yamaha) {
    const high = notes.some((n) => n.ch >= 8 && n.ch <= 15)
    if (!high) notes = notes.map((n) => (n.ch >= 0 && n.ch < 8 ? { ...n, ch: n.ch + 8 } : n))
  }
  const keep = notes.filter((n) => n.ch >= 8 && n.ch <= 15)
  return keep.length ? keep : notes
}

function splitByMarkers(notes, markers) {
  const spans = []
  for (const mk of markers) {
    const sec = markerSection(mk.name)
    if (sec >= 0 || sec === -2) spans.push({ tick: mk.tick, sec })
  }
  if (!spans.length) return notes.length ? [notes] : []
  spans.sort((a, b) => a.tick - b.tick)
  const sections = Array.from({ length: 15 }, () => [])
  for (const n of notes) {
    if (n.tick < spans[0].tick) continue
    let sec = spans[0].sec
    let start = spans[0].tick
    for (const sp of spans) {
      if (n.tick >= sp.tick) {
        sec = sp.sec
        start = sp.tick
      }
    }
    if (sec < 0) continue
    sections[sec].push({ ...n, tick: Math.max(0, n.tick - start) })
  }
  return sections
}

function parseFile(path) {
  const b = fs.readFileSync(path)
  const korf = b.subarray(0, 48).includes(Buffer.from("KORF"))
  const oc31 = b.includes(Buffer.from("OC31"))
  let found = []
  for (let i = 0; i + 8 < b.length; i++) {
    if (b[i] !== 0x4d || b[i + 1] !== 0x54 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue
    const hdrLen = ru32be(b, i + 4)
    if (hdrLen < 6 || i + 8 + hdrLen > b.length) continue
    const ntrks = ru16be(b, i + 10)
    let division = ru16be(b, i + 12)
    if (division & 0x8000) division = 96
    if (division <= 0) division = 96
    let casm = b.length
    for (let j = i + 8 + hdrLen; j + 4 <= b.length; j++) {
      if (b[j] === 0x43 && b[j + 1] === 0x41 && b[j + 2] === 0x53 && b[j + 3] === 0x4d) {
        casm = j
        break
      }
    }
    let p = i + 8 + hdrLen
    let notes = []
    let markers = []
    let programs = Array(16).fill(-1)
    let parsed = 0
    while (parsed < ntrks && p + 8 <= b.length && p < casm) {
      let sz = ru32be(b, p + 4)
      const maxPay = Math.min(casm, b.length) - (p + 8)
      if (sz > maxPay) sz = maxPay
      if (b.subarray(p, p + 4).toString() === "MTrk") {
        const tr = parseSmfTrack(b, p + 8, sz)
        notes = notes.concat(tr.notes)
        markers = markers.concat(tr.markers)
        for (let c = 0; c < 16; c++) if (tr.programs[c] >= 0) programs[c] = tr.programs[c]
        parsed++
      }
      p += 8 + sz
      if (sz === 0) break
    }
    if (!notes.length) continue
    const casmApplied = applyCasm(b, notes, programs)
    notes = casmApplied.notes
    programs = casmApplied.programs
    let yamaha = markers.some((m) => {
      const s = lowerCopy(m.name)
      return s.includes("sff") || s.includes("main a") || s.includes("fill in") || s.includes("sint")
    })
    notes = keepStyleChannels(notes, yamaha)
    const blobs = splitByMarkers(notes, markers)
    const counts = blobs.map((x) => x.length)
    found.push({
      yamaha,
      casmMapped: casmApplied.mapped,
      map: casmApplied.map,
      notes: notes.length,
      markers: markers.map((m) => m.name.replace(/\0/g, "").trim()),
      counts,
      var1: counts[3] || counts[0] || 0,
      korf,
      oc31,
    })
    i = p
  }
  return { file: path, size: b.length, korf, oc31, magic: b.subarray(0, 8).toString("latin1"), smfs: found }
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error("usage: node parse-style.mjs <sty...>")
  process.exit(1)
}
let failed = 0
for (const f of files) {
  const r = parseFile(f)
  const ok = r.smfs.some((s) => s.var1 > 0 || s.counts.some((n) => n > 0))
  if (!ok) failed++
  console.log(JSON.stringify({ ok, ...r, smfs: r.smfs.map(({ map, ...rest }) => rest) }, null, 2))
}
process.exit(failed ? 1 : 0)
