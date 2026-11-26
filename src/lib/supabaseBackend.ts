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
    async changePassword(current, next) {
      const { data } = await sb.auth.getUser()
      if (!data.user?.email) throw new Error('not_authenticated')
      const check = await sb.auth.signInWithPassword({ email: data.user.email, password: current })
      if (check.error) throw new Error('wrong_current_password')
      const { error } = await sb.auth.updateUser({ password: next })
      if (error) throw error
    },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const { data, error } = await sb.rpc(fn, args)
      if (error) throw new Error(error.message)
      return data as T
    },
  }
}
