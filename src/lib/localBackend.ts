// Lokaler Demo-Modus: PGlite (Postgres im Browser) mit denselben Migrationen wie Supabase.
// Daten bleiben nur in DIESEM Browser (IndexedDB). Anmeldung ist hier nur eine Simulation —
// nicht für echte Schülerdaten gedacht.
import { PGlite } from '@electric-sql/pglite'
import shim from '../../supabase/local/shim.sql?raw'
import localPassword from '../../supabase/local/password.sql?raw'
import type { Backend, Credentials } from './backend'

const migrations = import.meta.glob('../../supabase/migrations/*.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

const USER_KEY = 'stocklab_local_user'

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function createLocalBackend(): Promise<Backend> {
  const persistent = !(import.meta.env.VITE_LOCAL_MEMORY === '1')
  // Der Datenbankname enthält einen Fingerabdruck des Schemas: ändern sich die Migrationen,
  // startet automatisch eine frische Demo-Datenbank (statt mit einem veralteten Stand weiterzulaufen).
  const schemaId = (await sha(shim + localPassword + Object.keys(migrations).sort().map(k => migrations[k]).join('\n'))).slice(0, 8)
  const db = new PGlite(persistent ? `idb://stocklab-local-${schemaId}` : undefined)
  await db.waitReady

  const has = await db.query<{ t: string | null }>(`select to_regclass('public.profiles')::text t`)
  if (!has.rows[0].t) {
    await db.exec(shim)
    for (const k of Object.keys(migrations).sort()) await db.exec(migrations[k])
    await db.exec(localPassword)
  }

  const uid = () => localStorage.getItem(USER_KEY)

  // Fertige Demo-Konten (nur mit VITE_LOCAL_SEED=1, also bei `npm run dev:local`).
  const DEMO = {
    teacher: { email: 'lehrkraft@demo.stocklab', password: 'demo-lehrkraft' } as Credentials,
    student: { email: 'fox.democlas@demo.stocklab', password: 'demo-fox-1234' } as Credentials,
  }
  async function callAs<T>(user: string, fn: string, args: Record<string, unknown>): Promise<T> {
    const keys = Object.keys(args)
    return db.transaction(async tx => {
      await tx.query('set local role authenticated')
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user])
      const r = await tx.query<{ r: T }>(
        `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k]) as any[])
      return r.rows[0].r
    })
  }
  if (import.meta.env.VITE_LOCAL_SEED === '1') {
    const done = await db.query<{ n: string }>(`select count(*)::text n from auth.users where email = $1`, [DEMO.teacher.email])
    if (done.rows[0].n === '0') {
      const mk = async (c: Credentials) => (await db.query<{ id: string }>(
        `insert into auth.users(email, pw_hash) values ($1, $2) returning id`, [c.email, await sha(c.password)])).rows[0].id
      const t = await mk(DEMO.teacher)
      const code = (await db.query<{ value: string }>(`select value from app_config where key='teacher_signup_code'`)).rows[0].value
      await callAs(t, 'register_teacher', { p_code: code })
      const cls = await callAs<{ id: string }>(t, 'create_class', { p_name: 'Demo-Klasse Economics S1' })
      await db.query(`update classes set join_code = 'DEMOCLAS' where id = $1`, [cls.id])
      const s = await mk(DEMO.student)
      await callAs(s, 'join_class', { p_code: 'DEMOCLAS', p_pseudonym: 'fox' })
      const round = await callAs<string>(t, 'create_round', { p_class: cls.id, p_name: 'Demo-Runde', p_capital: 10000, p_deadline: '15:00', p_is_demo: true })
      await callAs(t, 'start_round', { p_round: round })
    }
  }

  return {
    mode: 'local',
    async getUserId() { return uid() },
    async signUp(email, password) {
      try {
        const r = await db.query<{ id: string }>(
          `insert into auth.users(email, pw_hash) values ($1, $2) returning id`, [email, await sha(password)])
        localStorage.setItem(USER_KEY, r.rows[0].id)
      } catch {
        throw new Error('User already registered')
      }
    },
    async signIn(email, password) {
      const r = await db.query<{ id: string }>(
        `select id from auth.users where email = $1 and pw_hash = $2`, [email, await sha(password)])
      if (!r.rows.length) throw new Error('Invalid login credentials')
      localStorage.setItem(USER_KEY, r.rows[0].id)
    },
    async signOut() { localStorage.removeItem(USER_KEY) },
    async changePassword(current, next) {
      const ok = await db.query(`select 1 from auth.users where id = $1 and pw_hash = $2`, [uid(), await sha(current)])
      if (!ok.rows.length) throw new Error('wrong_current_password')
      await db.query(`update auth.users set pw_hash = $2 where id = $1`, [uid(), await sha(next)])
    },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args)
      const call = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
      const user = uid()
      return db.transaction(async tx => {
        await tx.query('set local role authenticated')
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ''])
        const r = await tx.query<{ r: T }>(`select public.${fn}(${call}) as r`, keys.map(k => args[k]) as any[])
        return r.rows[0].r
      })
    },
    async hint() {
      const r = await db.query<{ value: string }>(`select value from app_config where key = 'teacher_signup_code'`)
      return { teacherCode: r.rows[0].value, demo: import.meta.env.VITE_LOCAL_SEED === '1' ? DEMO : undefined }
    },
  }
}
