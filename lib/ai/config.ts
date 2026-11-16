/**
 * ArrangerBox AI server (server/modal_app.py on Modal).
 *
 * The URL comes from EXPO_PUBLIC_AI_URL when set, else from server.generated.ts (committed,
 * written by `node server/scripts/write-app-config.mjs` after `modal deploy`).
 * There is no app key: every call carries the signed-in user's Supabase access token.
 */
import { generated } from "./server.generated"

export const aiConfig = {
  url: (process.env.EXPO_PUBLIC_AI_URL || generated.url || "").replace(/\/+$/, ""),
}

export const aiConfigured = () => aiConfig.url.length > 0
