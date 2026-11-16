import type { Session } from "@supabase/supabase-js"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

export type Auth = ReturnType<typeof useAuth>

/** Supabase session plus email/password sign-in actions. `ready` is false until the stored session is read. */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  const run = useCallback(async (fn: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setNotice(await fn())
    } catch (e) {
      setError((e as Error)?.message || "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }, [])

  const signIn = useCallback(
    (email: string, password: string) =>
      run(async () => {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (e) throw e
        return null
      }),
    [run]
  )

  const signUp = useCallback(
    (email: string, password: string) =>
      run(async () => {
        const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password })
        if (e) throw e
        return data.session ? null : "Check your email to confirm the account, then sign in."
      }),
    [run]
  )

  const signOut = useCallback(() => run(async () => (await supabase.auth.signOut(), null)), [run])

  return { session, user: session?.user ?? null, ready, busy, error, notice, signIn, signUp, signOut }
}
