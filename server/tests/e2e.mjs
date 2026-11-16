// End-to-end test of the deployed API, the same calls the app makes:
// health, auth, demo download, multipart upload, polling, result download, delete.
//   node server/tests/e2e.mjs <api url> [drums|sounds|both] [out dir]
// Then the C++ host test plays the downloaded files:
//   AB_AI_STYLE=<out>/drums/<name>.abstyle AB_AI_SFZ="<a.sfz>;<b.sfz>" test_engine
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const url = (process.argv[2] || "").replace(/\/+$/, "")
const which = process.argv[3] || "both"
const outRoot = process.argv[4] || join(here, "..", "..", "tmp", "ai-e2e")
const token = /AB_TOKEN=(\S+)/.exec(readFileSync(join(here, "..", ".env.local"), "utf8"))[1]
const auth = { Authorization: `Bearer ${token}` }
let failed = 0
const check = (ok, name, detail = "") => {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ": " + detail : ""}`)
  if (!ok) failed++
}

async function run(kind, demo, name) {
  const t0 = Date.now()
  const song = await fetch(`${url}/v1/demo/${demo}`, { headers: auth })
  check(song.ok, `${kind}: demo song downloads`, `${song.status}`)
  const bytes = new Uint8Array(await song.arrayBuffer())
  const form = new FormData()
  form.append("kind", kind)
  form.append("name", name)
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), demo)
  const up = await fetch(`${url}/v1/jobs`, { method: "POST", headers: auth, body: form })
  const { id } = await up.json()
  check(up.ok && !!id, `${kind}: upload starts a job`, id)
  let job
  let lastStage = ""
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000))
    job = await (await fetch(`${url}/v1/jobs/${id}`, { headers: auth })).json()
    if (job.stage !== lastStage) {
      console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s ${job.status} ${job.stage} ${job.message ?? ""}`)
      lastStage = job.stage
    }
    if (job.status === "done" || job.status === "error") break
    if (Date.now() - t0 > 15 * 60 * 1000) break
  }
  check(job.status === "done", `${kind}: job finishes`, `${job.status} ${job.message} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (job.status !== "done") return null
  check(job.input === undefined, `${kind}: status hides the server path`)
  const dir = join(outRoot, kind)
  mkdirSync(dir, { recursive: true })
  let bytesTotal = 0
  for (const f of job.result.files) {
    const r = await fetch(`${url}/v1/jobs/${id}/files/${encodeURIComponent(f)}`, { headers: auth })
    if (!r.ok) check(false, `${kind}: download ${f}`, `${r.status}`)
    const b = new Uint8Array(await r.arrayBuffer())
    bytesTotal += b.length
    writeFileSync(join(dir, f), b)
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(job.result, null, 1))
  check(true, `${kind}: downloaded ${job.result.files.length} files`, `${(bytesTotal / 1e6).toFixed(1)} MB`)
  check(/[^\x00-\x7f]/.test(job.result.name) && job.result.files.every((f) => /^[A-Za-z0-9_.-]+$/.test(f)), `${kind}: non-ASCII title kept, file names ASCII`, job.result.name)
  const evil = await fetch(`${url}/v1/jobs/${id}/files/..%2F..%2Fjobs`, { headers: auth })
  check(evil.status === 400 || evil.status === 404, `${kind}: path traversal refused`, `${evil.status}`)
  const del = await fetch(`${url}/v1/jobs/${id}`, { method: "DELETE", headers: auth })
  const gone = await fetch(`${url}/v1/jobs/${id}`, { headers: auth })
  check(del.ok && gone.status === 404, `${kind}: delete removes the job`)
  return { dir, manifest: job.result }
}

const health = await fetch(`${url}/v1/health`)
check(health.ok, "health", `${health.status}`)
const noAuth = await fetch(`${url}/v1/jobs/x`)
check(noAuth.status === 401, "requests without the token are refused", `${noAuth.status}`)
const out = {}
const jobs = []
if (which !== "sounds") jobs.push(run("drums", "demo_groove.mp3", "Señor Groove – Привет").then((r) => (out.drums = r)))
if (which !== "drums") jobs.push(run("sounds", "demo_keys.mp3", "Clé Ünïcode – Тест").then((r) => (out.sounds = r)))
await Promise.all(jobs)
if (out.drums) console.log("AB_AI_STYLE=" + join(out.drums.dir, out.drums.manifest.styles[0].file))
if (out.sounds) console.log("AB_AI_SFZ=" + out.sounds.manifest.sounds.map((s) => join(out.sounds.dir, s.file)).join(";"))
console.log(failed ? `${failed} failed` : "all passed")
process.exit(failed ? 1 : 0)
