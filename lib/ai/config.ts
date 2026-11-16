/**
 * ArrangerBox AI server (server/modal_app.py on Modal).
 *
 * The URL and token come from EXPO_PUBLIC_AI_URL / EXPO_PUBLIC_AI_TOKEN when set, else
 * from server.generated.ts (URL, committed) and .env (token, gitignored), both written by
 * `node server/scripts/write-app-config.mjs` after `modal deploy`. The token only gates the API: every build of the
 * app carries it, so treat it as a shared app key, not a user secret.
 */
import { generated } from "./server.generated"

export const aiConfig = {
  url: (process.env.EXPO_PUBLIC_AI_URL || generated.url || "").replace(/\/+$/, ""),
  token: process.env.EXPO_PUBLIC_AI_TOKEN || generated.token || "",
}

export const aiConfigured = () => aiConfig.url.length > 0 && aiConfig.token.length > 0
