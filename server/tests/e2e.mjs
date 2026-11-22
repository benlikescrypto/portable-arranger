// End-to-end test of the deployed API, the same calls the app makes:
// health, auth, demo download, multipart upload, polling, result download, delete.
//   node server/tests/e2e.mjs <api url> [stems|notes|drums|sounds|both|all] [out dir]   (both = drums + sounds)
// notes: a stems job, then notes in a stretch of its other stem (the demo keys; htdemucs_ft has no piano stem), from the server's lossless copy
// (source=<stems job>) and from the downloaded MP3 (the fallback; never "exact").
// Then the C++ host test plays the downloaded files:
//   AB_AI_STYLE=<out>/drums/<name>.abstyle AB_AI_SFZ="<a.sfz>;<b.sfz>" AB_AI_STEMS="<a.mp3>;…" test_engine
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const url = (process.argv[2] || "").replace(/\/+$/, "")
const which = process.argv[3] || "both"
const outRoot = process.argv[4] || join(here, "..", "..", "tmp", "ai-e2e")
// A Supabase test user from server/.env.local: AB_TEST_EMAIL, AB_TEST_PASSWORD (signed up on first run).
const env = Object.fromEntries(
  readFileSync(join(here, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
)
const SB_URL = env.SUPABASE_URL || "https://axwjitckgchsauvntnxe.supabase.co"
const SB_KEY = env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_MfTMzGA8JwOlsTQFrmPcXQ_66luxrAg"
async function signIn() {
  const creds = JSON.stringify({ email: env.AB_TEST_EMAIL, password: env.AB_TEST_PASSWORD })
  const post = (p) =>
    fetch(`${SB_URL}/auth/v1/${p}`, { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: creds })
  let r = await post("token?grant_type=password")
  if (r.status === 400) r = await post("signup")
  const body = await r.json()
  if (!body.access_token) throw new Error(`test user sign-in failed: ${JSON.stringify(body)}`)
  return body.access_token
}
const auth = { Authorization: `Bearer ${await signIn()}` }
let failed = 0
const check = (ok, name, detail = "") => {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ": " + detail : ""}`)
  if (!ok) failed++
}

async function run(kind, demo, name, opts = {}) {
  const t0 = Date.now()
  const label = opts.label || kind
  const form = new FormData()
  form.append("kind", kind)
  form.append("name", name)
  for (const [k, v] of Object.entries(opts.fields || {})) form.append(k, String(v))
  if (opts.file) {
    form.append("file", new Blob([opts.file], { type: "audio/mpeg" }), opts.fileName || "stem.mp3")
  } else if (demo) {
    const song = await fetch(`${url}/v1/demo/${demo}`, { headers: auth })
    check(song.ok, `${kind}: demo song downloads`, `${song.status}`)
    const bytes = new Uint8Array(await song.arrayBuffer())
    form.append("file", new Blob([bytes], { type: "audio/mpeg" }), demo)
  }
  const up = await fetch(`${url}/v1/jobs`, { method: "POST", headers: auth, body: form })
  const { id, detail } = await up.json()
  check(up.ok && !!id, `${label}: upload starts a job`, id || detail)
  if (!id) return null
  let job
  let lastStage = ""
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000))
    const res = await fetch(`${url}/v1/jobs/${id}`, { headers: auth }).catch(() => null)
    if (!res || res.status >= 500) continue // a transient server error: poll again, as the app does
    job = await res.json()
    if (job.stage !== lastStage) {
      console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s ${job.status} ${job.stage} ${job.message ?? ""}`)
      lastStage = job.stage
    }
    if (job.status === "done" || job.status === "error") break
    if (Date.now() - t0 > 15 * 60 * 1000) break
  }
  check(job.status === "done", `${label}: job finishes`, `${job.status} ${job.message} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (job.status !== "done") return null
  check(job.input === undefined, `${kind}: status hides the server path`)
  const dir = join(outRoot, label)
  mkdirSync(dir, { recursive: true })
  let bytesTotal = 0
  for (const f of job.result.files) {
    // Shared library samples ("lib/<instrument>/<file>") sit next to the job folder, as in the app.
    const lib = /^lib\/([a-z0-9_]+)\/([a-z0-9_]+\.wav)$/.exec(f)
    const src = lib ? `${url}/v1/library/${lib[1]}/${lib[2]}` : `${url}/v1/jobs/${id}/files/${encodeURIComponent(f)}`
    const dest = lib ? join(outRoot, "lib", lib[1], lib[2]) : join(dir, f)
    if (lib) mkdirSync(join(outRoot, "lib", lib[1]), { recursive: true })
    const r = await fetch(src, { headers: auth })
    if (!r.ok) check(false, `${kind}: download ${f}`, `${r.status}`)
    const b = new Uint8Array(await r.arrayBuffer())
    bytesTotal += b.length
    writeFileSync(dest, b)
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(job.result, null, 1))
  check(true, `${label}: downloaded ${job.result.files.length} files`, `${(bytesTotal / 1e6).toFixed(1)} MB`)
  check(/[^\x00-\x7f]/.test(job.result.name) && job.result.files.every((f) => /^(lib\/[a-z0-9_]+\/)?[A-Za-z0-9_.-]+$/.test(f)), `${kind}: non-ASCII title kept, file names ASCII`, job.result.name)
  const evil = await fetch(`${url}/v1/jobs/${id}/files/..%2F..%2Fjobs`, { headers: auth })
  const evilLib = await fetch(`${url}/v1/library/..%2Fjobs/x.wav`, { headers: auth })
  check(evilLib.status === 400 || evilLib.status === 404, `${kind}: library path traversal refused`, `${evilLib.status}`)
  check(evil.status === 400 || evil.status === 404, `${kind}: path traversal refused`, `${evil.status}`)
  const remove = async () => {
    const del = await fetch(`${url}/v1/jobs/${id}`, { method: "DELETE", headers: auth })
    const gone = await fetch(`${url}/v1/jobs/${id}`, { headers: auth })
    check(del.ok && gone.status === 404, `${label}: delete removes the job`)
  }
  if (!opts.keep) await remove()
  return { id, dir, manifest: job.result, remove }
}

async function notesFrom(stems) {
  const window = { start: 6, end: 36, stem: "other", mode: "" }
  const gone = new FormData()
  for (const [k, v] of Object.entries({ kind: "notes", name: "x", ...window, source: "0000000000000000" })) gone.append(k, String(v))
  const r410 = await fetch(`${url}/v1/jobs`, { method: "POST", headers: auth, body: gone })
  check(r410.status === 410, "notes: unknown lossless source without a file is refused", `${r410.status}`)
  const lossless = await run("notes", null, "Piano – Ноты", { label: "notes-lossless", fields: { ...window, source: stems.id } })
  const mp3 = readFileSync(join(stems.dir, "other.mp3"))
  const lossy = await run("notes", null, "Piano (MP3) – Ноты", { label: "notes-mp3", fields: window, file: mp3, fileName: "other.mp3" })
  for (const r of [lossless, lossy]) {
    if (!r) continue
    const m = r.manifest
    const doc = JSON.parse(readFileSync(join(r.dir, "notes.json"), "utf8"))
    const n = doc.notes
    const tag = m.audio === "lossless" ? "notes-lossless" : "notes-mp3"
    check(n.length >= 10 && n.length === m.count, `${tag}: notes found in 30 s of the other stem`, `${n.length} notes, ${m.keys.length} keys, ${m.exact} exact`)
    check(n.every((x) => x.cut <= x.t + 1e-9 && x.t >= -0.25 && x.t < 30 && x.wave.length === 120), `${tag}: every note has a start, a cut at or before it, and a zoomed waveform`)
    check(n.every((x, i) => i === 0 || n[i - 1].t <= x.t), `${tag}: notes are in time order`)
    check(["held", "oneshot"].includes(m.suggest.mode), `${tag}: suggests held or one-shot`, `${m.suggest.mode}: ${m.suggest.why}`)
  }
  if (lossless) check(lossless.manifest.audio === "lossless", "notes: read from the server's lossless stem", lossless.manifest.audio)
  if (lossy) check(lossy.manifest.audio === "mp3" && lossy.manifest.exact === 0, "notes: from an MP3 nothing is marked exact", `${lossy.manifest.audio}, ${lossy.manifest.exact} exact`)
  if (lossless && lossy) {
    // Same notes either way; only how sure the starts are differs.
    const a = JSON.parse(readFileSync(join(lossless.dir, "notes.json"), "utf8")).notes
    const b = JSON.parse(readFileSync(join(lossy.dir, "notes.json"), "utf8")).notes
    const near = a.filter((x) => b.some((y) => y.midi === x.midi && Math.abs(y.t - x.t) < 0.03)).length
    check(near >= 0.8 * a.length, "notes: lossless and MP3 find the same notes", `${near}/${a.length} within 30 ms`)
  }
}

const health = await fetch(`${url}/v1/health`)
check(health.ok, "health", `${health.status}`)
const noAuth = await fetch(`${url}/v1/jobs/x`)
check(noAuth.status === 401, "requests without a sign-in are refused", `${noAuth.status}`)
const out = {}
const jobs = []
const want = (k) => which === "all" || which === k || (which === "both" && k !== "stems" && k !== "notes")
const withNotes = want("notes")
if (want("stems") || withNotes)
  jobs.push(
    run("stems", "demo_keys.mp3", "Stems Ünïcode – Тест", { keep: withNotes }).then(async (r) => {
      out.stems = r
      if (r && withNotes) {
        await notesFrom(r)
        await r.remove()
      }
    })
  )
if (want("drums")) jobs.push(run("drums", "demo_groove.mp3", "Señor Groove – Привет").then((r) => (out.drums = r)))
if (want("sounds")) jobs.push(run("sounds", "demo_keys.mp3", "Clé Ünïcode – Тест").then((r) => (out.sounds = r)))
await Promise.all(jobs)
if (out.stems) {
  const m = out.stems.manifest
  check(m.stems.length === 5 && m.stems[0].key === "original" && m.model === "htdemucs_ft" && m.files.every((f) => f.endsWith(".mp3")), "stems: original + 4 Demucs (htdemucs_ft) stems as MP3", m.stems.map((t) => `${t.label} ${t.share_db} dB`).join(", "))
  // Demucs varies run to run on this demo: -19.2 to -20.6 dB seen.
  check(m.residual_db < -18, "stems: stems add back up to the song", `residual ${m.residual_db} dB`)
  check(m.lossless_days === 30 && m.source_lossless === false, "stems: lossless copies kept 30 days; an MP3 song is flagged", `${m.lossless_days} days, source_lossless ${m.source_lossless}`)
  console.log("AB_AI_STEMS=" + m.stems.map((t) => join(out.stems.dir, t.file)).join(";"))
}
if (out.drums) console.log("AB_AI_STYLE=" + join(out.drums.dir, out.drums.manifest.styles[0].file))
if (out.sounds) console.log("AB_AI_SFZ=" + out.sounds.manifest.sounds.map((s) => join(out.sounds.dir, s.file)).join(";"))
console.log(failed ? `${failed} failed` : "all passed")
process.exit(failed ? 1 : 0)
