#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

function u32be(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}
function u16be(n) {
  return [(n >>> 8) & 255, n & 255]
}
function vlq(n) {
  const bytes = [n & 0x7f]
  n >>= 7
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80)
    n >>= 7
  }
  return bytes
}

function marker(name) {
  const bytes = Buffer.from(name, "ascii")
  return [...vlq(0), 0xff, 0x06, ...vlq(bytes.length), ...bytes]
}

function noteOn(ch, note, vel) {
  return [...vlq(0), 0x90 | (ch & 15), note & 127, vel & 127]
}
function noteOff(delta, ch, note) {
  return [...vlq(delta), 0x80 | (ch & 15), note & 127, 0]
}
function pc(ch, program) {
  return [...vlq(0), 0xc0 | (ch & 15), program & 127]
}
function tempo(bpm) {
  const us = Math.round(60000000 / bpm)
  return [...vlq(0), 0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255]
}
function eot() {
  return [...vlq(0), 0xff, 0x2f, 0x00]
}

function smf0(trackBytes, division = 96) {
  const mthd = Buffer.from([
    0x4d, 0x54, 0x68, 0x64,
    ...u32be(6),
    ...u16be(0),
    ...u16be(1),
    ...u16be(division),
  ])
  const mtrk = Buffer.from([0x4d, 0x54, 0x72, 0x6b, ...u32be(trackBytes.length), ...trackBytes])
  return Buffer.concat([mthd, mtrk])
}

function ctab(src, name, dst) {
  const nm = Buffer.alloc(8, 0x20)
  nm.write(name.slice(0, 8), 0, "ascii")
  const payload = Buffer.from([
    src & 15,
    ...nm,
    dst & 15,
    0x00,
    0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff,
    0x00, 0x00,
    0x00, 0x7f,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ])
  return Buffer.concat([Buffer.from("Ctab"), Buffer.from(u32be(payload.length)), payload])
}

function yamahaSff({ overrun = true, sourceLow = false } = {}) {
  const bar = 96 * 4
  const body = []
  body.push(...tempo(120))
  body.push(...marker("SFF1"))
  body.push(...marker("SInt"))
  if (sourceLow) {
    for (let ch = 0; ch < 8; ch++) body.push(...pc(ch, ch === 0 ? 0 : ch === 2 ? 32 : 0))
  } else {
    body.push(...pc(9, 0), ...pc(10, 33), ...pc(11, 0))
  }
  body.push(...vlq(bar), 0xff, 0x06, ...vlq(6), ...Buffer.from("Main A"))
  const drumCh = sourceLow ? 0 : 9
  const bassCh = sourceLow ? 2 : 10
  const accCh = sourceLow ? 3 : 11
  body.push(...noteOn(drumCh, 36, 110))
  body.push(...noteOn(drumCh, 42, 90))
  body.push(...noteOn(bassCh, 36, 100))
  body.push(...noteOn(accCh, 60, 80))
  body.push(...noteOn(accCh, 64, 80))
  body.push(...noteOn(accCh, 67, 80))
  body.push(...noteOff(bar / 2, drumCh, 42))
  body.push(...noteOn(drumCh, 38, 108))
  body.push(...noteOff(bar / 2, drumCh, 36))
  body.push(...noteOff(0, drumCh, 38))
  body.push(...noteOff(0, bassCh, 36))
  body.push(...noteOff(0, accCh, 60))
  body.push(...noteOff(0, accCh, 64))
  body.push(...noteOff(0, accCh, 67))
  body.push(...marker("Main B"))
  body.push(...noteOn(drumCh, 36, 120))
  body.push(...noteOn(bassCh, 43, 110))
  body.push(...noteOff(bar, drumCh, 36))
  body.push(...noteOff(0, bassCh, 43))
  body.push(...eot())

  const midi = smf0(body)
  const ctabs = []
  if (sourceLow) {
    const map = [8, 9, 10, 11, 12, 13, 14, 15]
    const names = ["RhySub", "Rhythm", "Bass", "Chord1", "Chord2", "Pad", "Phrs1", "Phrs2"]
    for (let i = 0; i < 8; i++) ctabs.push(ctab(i, names[i], map[i]))
  } else {
    const names = ["RhySub", "Rhythm", "Bass", "Chord1", "Chord2", "Pad", "Phrs1", "Phrs2"]
    for (let i = 0; i < 8; i++) ctabs.push(ctab(8 + i, names[i], 8 + i))
  }
  const sdecName = "Main A,Main B"
  const sdec = Buffer.concat([Buffer.from("Sdec"), Buffer.from(u32be(sdecName.length)), Buffer.from(sdecName)])
  const csegPayload = Buffer.concat([sdec, ...ctabs])
  const cseg = Buffer.concat([Buffer.from("CSEG"), Buffer.from(u32be(csegPayload.length)), csegPayload])
  const casm = Buffer.concat([Buffer.from("CASM"), Buffer.from(u32be(cseg.length)), cseg])

  if (!overrun) return Buffer.concat([midi, casm])

  const mtrk = 8 + 6
  const declared = ru32(midi, mtrk + 4)
  const fake = declared + 64
  const out = Buffer.from(midi)
  out[mtrk + 4] = (fake >>> 24) & 255
  out[mtrk + 5] = (fake >>> 16) & 255
  out[mtrk + 6] = (fake >>> 8) & 255
  out[mtrk + 7] = fake & 255
  return Buffer.concat([out, casm])
}

function ru32(b, i) {
  return (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]
}

function timesig(nn = 4, dd = 2) {
  return [...vlq(0), 0xff, 0x58, 0x04, nn, dd, 24, 8]
}

function korgSmf() {
  const bar = 96 * 4
  const body = []
  body.push(...tempo(100))
  body.push(...timesig(4, 2))
  body.push(...marker("v1cv1"))
  body.push(...pc(8, 33), ...pc(9, 0), ...pc(11, 0))
  body.push(...noteOn(9, 36, 110))
  body.push(...noteOn(9, 42, 80))
  body.push(...noteOn(8, 36, 100))
  body.push(...noteOn(11, 60, 90))
  body.push(...noteOff(bar / 2, 9, 42))
  body.push(...noteOn(9, 38, 100))
  body.push(...noteOff(bar / 2, 9, 36))
  body.push(...noteOff(0, 9, 38))
  body.push(...noteOff(0, 8, 36))
  body.push(...noteOff(0, 11, 60))
  body.push(...marker("v2cv1"))
  body.push(...noteOn(9, 36, 120))
  body.push(...noteOff(bar, 9, 36))
  body.push(...eot())
  return smf0(body)
}

const dir = process.argv[2] || path.join(process.cwd(), "tmp", "styles")
fs.mkdirSync(dir, { recursive: true })
const files = {
  "yamaha-sff-overrun.sty": yamahaSff({ overrun: true, sourceLow: false }),
  "yamaha-sff-casm-low.sty": yamahaSff({ overrun: true, sourceLow: true }),
  "korg-encvn.mid": korgSmf(),
}
function storeZip(entryName, data) {
  const u16 = (n) => Buffer.from([n & 255, (n >> 8) & 255])
  const u32 = (n) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255])
  const name = Buffer.from(entryName)
  const local = Buffer.concat([
    Buffer.from("PK\x03\x04"),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    name,
    data,
  ])
  const cd = Buffer.concat([
    Buffer.from("PK\x01\x02"),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    name,
  ])
  const eocd = Buffer.concat([
    Buffer.from("PK\x05\x06"),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(cd.length),
    u32(local.length),
    u16(0),
  ])
  return Buffer.concat([local, cd, eocd])
}

for (const [name, buf] of Object.entries(files)) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, buf)
  console.log("wrote", p, buf.length)
}
const zipPath = path.join(dir, "korg-set.zip")
fs.writeFileSync(zipPath, storeZip("STYLE/korg-encvn.mid", files["korg-encvn.mid"]))
console.log("wrote", zipPath)
