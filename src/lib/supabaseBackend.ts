import { createClient } from '@supabase/supabase-js'
import type { Backend } from './backend'

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  const sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  return {
    mode: 'supabase',
    async getUserId() {
      const { data } = await sb.auth.getSession()
      return data.session?.user.id ?? null
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password })
      if (error) throw error
      // Ohne Session ist „E-Mail bestätigen“ in Supabase noch AN → muss aus sein.
      if (!data.session) throw new Error('email_confirmation_enabled')
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    async signOut() {
      await sb.auth.signOut()
    },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const { data, error } = await sb.rpc(fn, args)
      if (error) throw new Error(error.message)
      return data as T
    },
  }
}
