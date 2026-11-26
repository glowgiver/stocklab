import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'supabase')

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(join(root, 'local', 'shim.sql'), 'utf8'))
  for (const f of readdirSync(join(root, 'migrations')).sort()) {
    await db.exec(readFileSync(join(root, 'migrations', f), 'utf8'))
  }
  await db.exec(readFileSync(join(root, 'local', 'clock.sql'), 'utf8'))
  await db.exec(readFileSync(join(root, 'local', 'password.sql'), 'utf8'))
  return db
}

export async function setNow(db: PGlite, iso: string) {
  await db.query(`select set_config('stocklab.now', $1, false)`, [iso])
}

/** Ruft eine Funktion als eingeloggter Nutzer auf (Rolle authenticated, RLS aktiv). */
export async function rpc<T = any>(db: PGlite, uid: string, fn: string, ...args: unknown[]): Promise<T> {
  return db.transaction(async tx => {
    await tx.query('set local role authenticated')
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
    const ph = args.map((_, i) => `$${i + 1}`).join(', ')
    const r = await tx.query<{ r: T }>(`select public.${fn}(${ph}) as r`, args as any[])
    return r.rows[0].r
  })
}

/** Beliebige Abfrage als eingeloggter Nutzer (für RLS-Tests). */
export async function asUser<T = any>(db: PGlite, uid: string, sql: string, params: unknown[] = []) {
  return db.transaction(async tx => {
    await tx.query('set local role authenticated')
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
    return (await tx.query<T>(sql, params as any[])).rows
  })
}

export async function asService<T = any>(db: PGlite, sql: string, params: unknown[] = []) {
  return db.transaction(async tx => {
    await tx.query('set local role service_role')
    return (await tx.query<T>(sql, params as any[])).rows
  })
}

export async function newUser(db: PGlite, name: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users(email, pw_hash) values ($1, 'x') returning id`, [`${name}@test.invalid`])
  return r.rows[0].id
}

export async function teacherCode(db: PGlite): Promise<string> {
  const r = await db.query<{ value: string }>(`select value from app_config where key='teacher_signup_code'`)
  return r.rows[0].value
}

export interface World {
  db: PGlite
  teacher: string
  classId: string
  joinCode: string
  students: Record<string, string>
}

/** Lehrkraft + Klasse + n Schüler/innen (Pseudonyme s1, s2, …). */
export async function world(n = 2): Promise<World> {
  const db = await freshDb()
  await setNow(db, '2026-11-23T09:00:00Z') // feste Test-Uhr: Rundenstart ist reproduzierbar
  const teacher = await newUser(db, 'teacher')
  await rpc(db, teacher, 'register_teacher', await teacherCode(db))
  const c = await rpc<{ id: string; join_code: string }>(db, teacher, 'create_class', 'Class A')
  const students: Record<string, string> = {}
  for (let i = 1; i <= n; i++) {
    const uid = await newUser(db, `s${i}`)
    await rpc(db, uid, 'join_class', c.join_code, `s${i}`)
    students[`s${i}`] = uid
  }
  return { db, teacher, classId: c.id, joinCode: c.join_code, students }
}

export async function activeRound(w: World, opts: { demo?: boolean; external?: boolean; capital?: number } = {}) {
  const mode = opts.external ? 'external' : 'simulated'
  const id = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Round 1', opts.capital ?? 10000, '15:00', opts.demo ?? false, mode)
  // Echte Kurse: Startkurse (letzter Handelstag vor Rundenbeginn) vorab eintragen, wie die Lehrkraft es täte.
  if (opts.external) await putPrices(w.db, '2026-11-20', {})
  await rpc(w.db, w.teacher, 'start_round', id)
  return id
}

export async function assetId(db: PGlite, symbol: string): Promise<string> {
  return (await db.query<{ id: string }>(`select id from assets where symbol=$1`, [symbol])).rows[0].id
}

/** Setzt Kurse für alle aktiven Werte an einem Tag (wie ein Provider-Lauf mit service_role). */
export async function putPrices(db: PGlite, date: string, prices: Record<string, number> = {}) {
  const assets = (await db.query<{ id: string; symbol: string; base_price: string }>(
    `select id, symbol, base_price from assets where active`)).rows
  for (const a of assets) {
    await db.query(
      `insert into daily_prices(asset_id, price_date, close, source) values ($1,$2,$3,'eod_api')`,
      [a.id, date, prices[a.symbol] ?? Number(a.base_price)])
  }
}

export const decision = (over: Record<string, unknown> = {}) => ({
  expectation: 'I expect the price to rise next week.',
  reasoning: 'Demand for the product is growing.',
  evidence: 'Sales figures from the last quarter.',
  risks: 'A recession could reduce demand.',
  ...over,
})
