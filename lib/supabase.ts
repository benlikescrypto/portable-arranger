/**
 * Supabase client (auth + database). Project "arrangerbox" (axwjitckgchsauvntnxe).
 *
 * The URL and publishable key are public by design (row level security protects the data),
 * so they are committed as defaults; EXPO_PUBLIC_SUPABASE_URL / _KEY override them.
 * The session is kept in a file in the app's documents folder (no extra native module).
 */
import { createClient, type SupportedStorage } from "@supabase/supabase-js"
import { Directory, File, Paths } from "expo-file-system"
import { AppState, Platform } from "react-native"

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://axwjitckgchsauvntnxe.supabase.co"
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || "sb_publishable_MfTMzGA8JwOlsTQFrmPcXQ_66luxrAg"

function fileStorage(): SupportedStorage {
  const dir = () => {
    const d = new Directory(Paths.document, "auth")
    if (!d.exists) d.create({ intermediates: true, idempotent: true })
    return d
  }
  const file = (key: string) => new File(dir(), `${key.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`)
  return {
    async getItem(key) {
      try {
        const f = file(key)
        return f.exists ? await f.text() : null
      } catch {
        return null
      }
    },
    async setItem(key, value) {
      const f = file(key)
      if (!f.exists) f.create({ intermediates: true })
      f.write(value)
    },
    async removeItem(key) {
      try {
        const f = file(key)
        if (f.exists) f.delete()
      } catch {
        // already gone
      }
    },
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: Platform.OS === "web" ? undefined : fileStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Refresh tokens only while the app is in the foreground (Supabase's React Native guidance).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh()
    else supabase.auth.stopAutoRefresh()
  })
}

/** Current access token, refreshed if it is about to expire. Null when signed out. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
