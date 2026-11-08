#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

function ru32be(b, i) {
  return (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]
}
function ru16be(b, i) {
  return (b[i] << 8) | b[i + 1]
}
function asciiAt(b, i, n) {
  return Array.from(b.subarray(i, i + n))
    .map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : "."))
    .join("")
}
function findTag(b, tag, from = 0) {
  const t = Buffer.from(tag)
  for (let i = from; i + t.length <= b.length; i++) {
    if (b.subarray(i, i + t.length).equals(t)) return i
  }
  return -1
}

function readVlq(b, i, end) {
  let v = 0
  for (let g = 0; g < 4 && i < end; g++) {
    const x = b[i++]
    v = (v << 7) | (x & 0x7f)
    if (!(x & 0x80)) break
  }
  return { v, i }
}

function parseTrack(b, start, n) {
  const end = start + n
  let i = start
  let tick = 0
  let running = 0
  const markers = []
  const notes = []
  const programs = Array(16).fill(-1)
  const on = Array.from({ length: 16 }, () => Array(128).fill(-1))
  const onVel = Array.from({ length: 16 }, () => Array(128).fill(0))
  const close = (ch, note, at) => {
    if (ch < 0 || ch > 15 || note < 0 || note > 127) return
    if (on[ch][note] >= 0) {
      notes.push({ tick: on[ch][note], ch, note, vel: onVel[ch][note], dur: Math.max(1, at - on[ch][note]) })
      on[ch][note] = -1
    }
  }
  let events = 0
  let broke = null
  while (i < end) {
    const dt = readVlq(b, i, end)
    i = dt.i
    tick += dt.v
    if (i >= end) break
    let status = b[i]
    if (status < 0x80) {
      if (!running) {
        broke = `no-running at ${i}`
        break
      }
      status = running
    } else {
      i++
      if (status < 0xf0) running = status
    }
    const type = status & 0xf0
    const ch = status & 0x0f
    events++
    if (status === 0xff) {
      if (i >= end) break
      const meta = b[i++]
      const len = readVlq(b, i, end)
      i = len.i
      if (i + len.v > end) {
        broke = `meta overrun ${meta.toString(16)}`
        break
      }
      if ((meta === 0x06 || meta === 0x03) && len.v > 0) {
        markers.push({ tick, name: b.subarray(i, i + len.v).toString("latin1") })
      }
      if (meta === 0x2f) break
      i += len.v
      continue
    }
    if (status === 0xf0 || status === 0xf7) {
      const len = readVlq(b, i, end)
      i = len.i + len.v
      continue
    }
    if (type === 0x90 || type === 0x80) {
      if (i + 1 >= end) break
      const note = b[i]
      const vel = b[i + 1]
      i += 2
      if (type === 0x80 || vel === 0) close(ch, note, tick)
      else {
        close(ch, note, tick)
        on[ch][note] = tick
        onVel[ch][note] = vel
      }
    } else if (type === 0xc0) {
      if (i >= end) break
      programs[ch] = b[i++] & 0x7f
    } else if (type === 0xd0) {
      i++
    } else if (type === 0xf0) {
      running = 0
    } else {
      i += 2
    }
  }
  for (let ch = 0; ch < 16; ch++) for (let nte = 0; nte < 128; nte++) if (on[ch][nte] >= 0) close(ch, nte, tick)
  const byCh = Array(16).fill(0)
  for (const nte of notes) byCh[nte.ch]++
  return { markers, notes, programs, events, broke, byCh, ticks: tick }
}

function inspect(file) {
  const b = fs.readFileSync(file)
  const tags = ["MThd", "MTrk", "CASM", "OTSc", "OTS ", "MDB ", "SFF1", "SFF2", "KORF", "OC31", "Ctab", "Ctb2", "AASM", "AFil", "Main A", "v1cv1"]
  const found = {}
  for (const t of tags) {
    const at = findTag(b, t)
    if (at >= 0) found[t] = at
  }
  const mthd = found.MThd ?? -1
  let hdr = null
  if (mthd >= 0 && mthd + 14 <= b.length) {
    hdr = {
      len: ru32be(b, mthd + 4),
      format: ru16be(b, mthd + 8),
      ntrks: ru16be(b, mthd + 10),
      division: ru16be(b, mthd + 12),
    }
  }
  const mtrk = found.MTrk ?? -1
  let declared = null
  let clamped = null
  let track = null
  if (mtrk >= 0 && mtrk + 8 <= b.length) {
    declared = ru32be(b, mtrk + 4)
    const casm = found.CASM >= 0 ? found.CASM : b.length
    clamped = Math.min(declared, Math.max(0, casm - (mtrk + 8)), b.length - (mtrk + 8))
    track = parseTrack(b, mtrk + 8, clamped)
  }
  return {
    file: path.basename(file),
    size: b.length,
    magic: asciiAt(b, 0, 16),
    tags: found,
    hdr,
    mtrkDeclared: declared,
    mtrkClamped: clamped,
    overrun: declared != null && found.CASM >= 0 ? declared - (found.CASM - (mtrk + 8)) : 0,
    track,
  }
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error("usage: node inspect-sty.mjs <file...>")
  process.exit(1)
}
for (const f of files) {
  const r = inspect(f)
  console.log(JSON.stringify(r, null, 2))
}
