// Writes the deployed API URL to lib/ai/server.generated.ts (committed).
// There is no app token: the app sends the signed-in user's Supabase access token.
//   node server/scripts/write-app-config.mjs https://<workspace>--arrangerbox-ai-api.modal.run
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")
const url = (process.argv[2] || "").replace(/\/+$/, "")
if (!/^https:\/\//.test(url)) {
  console.error("usage: node server/scripts/write-app-config.mjs https://...modal.run")
  process.exit(1)
}
const generated = join(root, "lib", "ai", "server.generated.ts")
writeFileSync(generated, `// Written by server/scripts/write-app-config.mjs.\nexport const generated = { url: ${JSON.stringify(url)} }\n`)
console.log("wrote", generated)
