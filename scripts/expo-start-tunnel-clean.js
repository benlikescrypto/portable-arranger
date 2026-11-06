/**
 * Cleanly starts Expo dev-client tunnel on Windows.
 *
 * Expo's shared ngrok often fails (body undefined / ERR_NGROK_*).
 * This helper frees port 8081, starts a Cloudflare quick tunnel, then runs
 * Metro with EXPO_PACKAGER_PROXY_URL so the QR/deep link uses the public URL.
 *
 * Usage:
 *   npm run dev:tunnel
 */
const { execSync, spawn } = require("child_process")
const fs = require("fs")
const http = require("http")
const https = require("https")
const path = require("path")
const { pipeline } = require("stream/promises")

const root = path.join(__dirname, "..")
const cloudflaredBin = path.join(root, "scripts", "bin", "cloudflared.exe")
const CLOUDFLARED_URL =
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

function runQuiet(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString()
  } catch {
    return ""
  }
}

function killPortListeners(port) {
  const netstat = runQuiet("netstat -ano -p tcp")
  const pids = new Set()
  for (const line of netstat.split(/\r?\n/)) {
    if (!line.includes(`:${port}`)) continue
    if (!line.includes("LISTENING")) continue
    const parts = line.trim().split(/\s+/)
    const pid = parts[parts.length - 1]
    if (/^\d+$/.test(pid)) pids.add(pid)
  }
  for (const pid of pids) {
    runQuiet(`taskkill /F /PID ${pid} /T`)
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = (target, redirects = 0) => {
      https
        .get(target, (res) => {
          if (
            res.statusCode
            && res.statusCode >= 300
            && res.statusCode < 400
            && res.headers.location
            && redirects < 5
          ) {
            res.resume()
            get(res.headers.location, redirects + 1)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`))
            res.resume()
            return
          }
          pipeline(res, file).then(resolve).catch(reject)
        })
        .on("error", reject)
    }
    get(url)
  })
}

async function ensureCloudflared() {
  if (fs.existsSync(cloudflaredBin)) return cloudflaredBin
  fs.mkdirSync(path.dirname(cloudflaredBin), { recursive: true })
  console.log("Downloading cloudflared...")
  await download(CLOUDFLARED_URL, cloudflaredBin)
  return cloudflaredBin
}

function waitForTunnelUrl(child, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let buf = ""
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for Cloudflare tunnel URL"))
    }, timeoutMs)

    const onData = (chunk) => {
      const text = chunk.toString()
      buf += text
      process.stderr.write(text)
      const match = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
      if (match) {
        cleanup()
        resolve(match[0].replace(/\/$/, ""))
      }
    }

    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off("data", onData)
      child.stderr?.off("data", onData)
    }

    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    child.on("exit", (code) => {
      cleanup()
      reject(new Error(`cloudflared exited early (code ${code ?? "?"})`))
    })
  })
}

function getText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => {
        body += chunk
      })
      res.on("end", () => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        resolve(body)
      })
    })
    req.on("timeout", () => {
      req.destroy(new Error(`Timed out fetching ${url}`))
    })
    req.on("error", reject)
  })
}

async function waitFor(label, fn, timeoutMs = 45000) {
  const started = Date.now()
  let lastError = "not started"
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
  throw new Error(`${label} was not ready: ${lastError}`)
}

function printOpenLinks(url) {
  const encoded = encodeURIComponent(url)
  const sdk58 = `exp+arrangerbox://?__expo_url=${encoded}`
  const legacy = `exp+arrangerbox://expo-development-client/?url=${encoded}`
  console.log("\n==============================================")
  console.log("Metro is up. Open ArrangerBox with this link:")
  console.log(sdk58)
  console.log("\nIf that sits on Looking for server, use:")
  console.log(legacy)
  console.log("\nDo not paste the https URL into Expo Home.")
  console.log("==============================================\n")
}

async function main() {
  if (process.platform !== "win32") {
    console.error("This helper is intended for Windows PowerShell environments.")
    process.exit(1)
  }

  runQuiet("taskkill /F /IM ngrok.exe /T")
  runQuiet("taskkill /F /IM cloudflared.exe /T")
  killPortListeners(8081)

  const bin = await ensureCloudflared()
  console.log("Starting Cloudflare quick tunnel...")

  const tunnel = spawn(
    bin,
    [
      "tunnel",
      "--url",
      "http://127.0.0.1:8081",
      "--no-autoupdate",
      "--protocol",
      "http2",
      "--ha-connections",
      "4",
      "--edge-ip-version",
      "4",
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  )

  const url = await waitForTunnelUrl(tunnel)
  console.log(`\nTunnel ready: ${url}`)
  console.log(`Using EXPO_PACKAGER_PROXY_URL=${url}\n`)

  const expo = spawn(
    "npx",
    ["expo", "start", "--dev-client", "--port", "8081"],
    {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        EXPO_TUNNEL_SUBDOMAIN: "",
        EXPO_PACKAGER_PROXY_URL: url,
      },
    },
  )

  const shutdown = () => {
    try {
      expo.kill("SIGTERM")
    } catch {
      // ignore
    }
    try {
      tunnel.kill("SIGTERM")
    } catch {
      // ignore
    }
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  expo.on("exit", (code) => {
    try {
      tunnel.kill("SIGTERM")
    } catch {
      // ignore
    }
    process.exit(code ?? 0)
  })
  tunnel.on("exit", () => {
    try {
      expo.kill("SIGTERM")
    } catch {
      // ignore
    }
  })

  try {
    await waitFor("Metro", async () => {
      const body = await getText("http://127.0.0.1:8081/status", 4000)
      if (!body.includes("running")) throw new Error(body.trim() || "metro not running")
      return body
    })
    await waitFor("tunnel", async () => {
      const body = await getText(`${url}/status`, 8000)
      if (!body.includes("running")) throw new Error(body.trim() || "tunnel not running")
      return body
    })
    printOpenLinks(url)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    printOpenLinks(url)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
