import { describe, it, expect } from 'vitest'
import { world, activeRound, rpc, asService, setNow, putPrices, decision, newUser, teacherCode } from './helpers'

const MON = '2026-11-30'

async function settledRealRound() {
  const w = await world(1)
  await setNow(w.db, '2026-11-30T09:00:00Z')
  const round = await activeRound(w, { external: true })
  await putPrices(w.db, MON, {})
  const d = decision()
  await rpc(w.db, w.students.s1, 'submit_decision', round, 'hold', null, null, d.expectation, d.reasoning, d.evidence, d.risks)
  await setNow(w.db, '2026-11-30T22:00:00Z')
  await asService(w.db, `select settle_round_day($1, $2)`, [round, MON])
  return { w, round }
}
const count = async (w: any, table: string) =>
  ((await w.db.query(`select count(*)::int n from ${table}`)).rows[0] as any).n

describe('Umbenennen', () => {
  it('nur die eigene Lehrkraft; leere oder zu lange Namen werden abgelehnt', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await rpc(w.db, w.teacher, 'rename_round', round, '  Herbstrunde  ')
    await rpc(w.db, w.teacher, 'rename_class', w.classId, 'Economics S1')
    const r = (await w.db.query(`select (select name from rounds) r, (select name from classes) c`)).rows[0]
    expect(r).toEqual({ r: 'Herbstrunde', c: 'Economics S1' })
    await expect(rpc(w.db, w.teacher, 'rename_round', round, '   ')).rejects.toThrow(/invalid_name/)
    await expect(rpc(w.db, w.teacher, 'rename_class', w.classId, 'x'.repeat(81))).rejects.toThrow(/invalid_name/)
    await expect(rpc(w.db, w.students.s1, 'rename_round', round, 'Hack')).rejects.toThrow(/forbidden/)
    const other = await newUser(w.db, 'other')
    await rpc(w.db, other, 'register_teacher', await teacherCode(w.db))
    await expect(rpc(w.db, other, 'rename_class', w.classId, 'Hack')).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, other, 'delete_round', round, null)).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, w.students.s1, 'delete_round', round, null)).rejects.toThrow(/forbidden/)
  })
})

describe('Löschen', () => {
  it('Entwurf und Demo-Runde (auch laufend) sind direkt löschbar', async () => {
    const w = await world(1)
    const draft = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Entwurf', 10000, '15:00', false, 'simulated')
    await rpc(w.db, w.teacher, 'delete_round', draft, null)
    const demo = await activeRound(w, { demo: true })
    await rpc(w.db, w.teacher, 'demo_settle_next_day', demo)
    await rpc(w.db, w.teacher, 'delete_round', demo, null)
    for (const t of ['rounds', 'portfolios', 'cash_movements', 'portfolio_snapshots', 'settlement_runs']) {
      expect(await count(w, t), t).toBe(0)
    }
    expect(await count(w, 'class_members')).toBe(1)        // Schülerkonto bleibt
  })

  it('echte Runde: laufend nie; beendet nur mit richtigem Namen', async () => {
    const { w, round } = await settledRealRound()
    await expect(rpc(w.db, w.teacher, 'delete_round', round, 'Round 1')).rejects.toThrow(/round_still_running/)
    await rpc(w.db, w.teacher, 'end_round', round)
    await expect(rpc(w.db, w.teacher, 'delete_round', round, null)).rejects.toThrow(/invalid_confirmation/)
    await expect(rpc(w.db, w.teacher, 'delete_round', round, 'round 2')).rejects.toThrow(/invalid_confirmation/)
    expect(await count(w, 'decisions')).toBe(1)            // nichts ist verloren gegangen
    const prices = await count(w, 'daily_prices')
    await rpc(w.db, w.teacher, 'delete_round', round, 'Round 1')
    expect(await count(w, 'rounds')).toBe(0)
    expect(await count(w, 'decisions')).toBe(0)
    expect(await count(w, 'daily_prices')).toBe(prices)    // Kurse bleiben
  })

  it('löscht nur diese Runde; der Schutz abgerechneter Daten ist danach wieder aktiv', async () => {
    const { w, round } = await settledRealRound()
    await rpc(w.db, w.teacher, 'end_round', round)
    const demo = await activeRound(w, { demo: true })
    await rpc(w.db, w.teacher, 'delete_round', demo, null)
    expect(await count(w, 'decisions')).toBe(1)
    await expect(w.db.query(`delete from cash_movements`)).rejects.toThrow(/immutable_record/)
    await expect(w.db.query(`delete from decisions`)).rejects.toThrow(/immutable_record/)
  })
})
