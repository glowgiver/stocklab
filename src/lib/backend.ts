// Dünne Schicht zwischen App und Datenbank. Zwei Implementierungen:
//  - supabase: echter Betrieb (Konten, EU-Datenbank)
//  - local:    PGlite im Browser, gleiche SQL-Migrationen, kein Konto nötig (Demo/Test)
// Die App ruft nur rpc(...) — jede Funktion prüft serverseitig selbst die Rechte.

export interface Credentials { email: string; password: string }

export interface Backend {
  mode: 'supabase' | 'local'
  getUserId(): Promise<string | null>
  signUp(email: string, password: string): Promise<void>
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>
  /** Nur lokaler Demo-Modus: Hinweise für die Login-Seite (Lehrkraft-Code). */
  hint?(): Promise<{ teacherCode: string; demo?: { teacher: Credentials; student: Credentials } } | null>
}

let cached: Promise<Backend | null> | null = null

export function getBackend(): Promise<Backend | null> {
  if (!cached) cached = create()
  return cached
}

async function create(): Promise<Backend | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (import.meta.env.VITE_BACKEND === 'local') {
    const { createLocalBackend } = await import('./localBackend')
    return createLocalBackend()
  }
  if (url && key) {
    const { createSupabaseBackend } = await import('./supabaseBackend')
    return createSupabaseBackend(url, key)
  }
  return null
}

/** Datenbankfehler → kurzer Code (z. B. "insufficient_cash") für die Übersetzung. */
export function errorCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
  const m = msg.match(/\b(not_authenticated|forbidden|invalid_[a-z_]+|insufficient_[a-z]+|pseudonym_taken|already_member|round_[a-z_]+|no_[a-z_]+|decision_[a-z_]+|demo_only|immutable_record|prices_[a-z_]+)\b/)
  if (m) return m[1]
  if (/email_confirmation_enabled/.test(msg)) return 'email_confirmation'
  if (/already registered|already been registered|user_already_exists/i.test(msg)) return 'user_exists'
  if (/invalid login|invalid_credentials/i.test(msg)) return 'invalid_credentials'
  if (/password/i.test(msg) && /(least|short|weak)/i.test(msg)) return 'weak_password'
  return 'unknown'
}
