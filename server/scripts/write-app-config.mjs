// Writes the deployed API URL to lib/ai/server.generated.ts (committed) and the AB_TOKEN
// from server/.env.local (the Modal secret "arrangerbox-ai") to the gitignored root .env as
// EXPO_PUBLIC_AI_TOKEN. .easignore lets EAS builds upload .env, so builds carry the token
// while the public repo does not.
//   node server/scripts/write-app-config.mjs https://<workspace>--arrangerbox-ai-api.modal.run
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")
const url = (process.argv[2] || "").replace(/\/+$/, "")
if (!/^https:\/\//.test(url)) {
  console.error("usage: node server/scripts/write-app-config.mjs https://...modal.run")
  process.exit(1)
}
const token = /AB_TOKEN=(\S+)/.exec(readFileSync(join(here, "..", ".env.local"), "utf8"))?.[1]
if (!token) {
  console.error("AB_TOKEN missing in server/.env.local")
  process.exit(1)
}
const generated = join(root, "lib", "ai", "server.generated.ts")
writeFileSync(
  generated,
  `// Written by server/scripts/write-app-config.mjs. The token is not committed: it lives in\n// the gitignored .env as EXPO_PUBLIC_AI_TOKEN (EAS uploads it via .easignore).\nexport const generated = { url: ${JSON.stringify(url)}, token: "" }\n`
)
const envPath = join(root, ".env")
const lines = (existsSync(envPath) ? readFileSync(envPath, "utf8") : "").split(/\r?\n/).filter((l) => l && !l.startsWith("EXPO_PUBLIC_AI_TOKEN="))
lines.push(`EXPO_PUBLIC_AI_TOKEN=${token}`)
writeFileSync(envPath, lines.join("\n") + "\n")
console.log("wrote", generated, "and", envPath)
