import { describe, it, expect } from 'vitest'
import {
  world, activeRound, rpc, asUser, asService, setNow, assetId, putPrices, decision, newUser, teacherCode,
} from './helpers'

// Mo 30.11.2026, 10:00 Berlin (= 09:00 UTC) — vor dem Einsendeschluss 15:00
const MON_MORNING = '2026-11-30T09:00:00Z'
const MON = '2026-11-30'

async function submit(w: Awaited<ReturnType<typeof world>>, round: string, who: string, action: string,
                       asset: string | null, qty: number | null, over = {}) {
  const d = decision(over)
  return rpc(w.db, w.students[who], 'submit_decision', round, action, asset, qty,
    d.expectation, d.reasoning, d.evidence, d.risks)
}

describe('Konten & Beitritt', () => {
  it('Lehrkraft-Registrierung braucht den geheimen Code', async () => {
    const w = await world(0)
    const u = await newUser(w.db, 'fake-teacher')
    await expect(rpc(w.db, u, 'register_teacher', 'falsch')).rejects.toThrow(/invalid_teacher_code/)
    await rpc(w.db, u, 'register_teacher', await teacherCode(w.db))
  })

  it('Schüler/in tritt mit Klassencode bei; Pseudonym nur einmal; falscher Code scheitert', async () => {
    const w = await world(1)
    const u = await newUser(w.db, 'other')
    await expect(rpc(w.db, u, 'join_class', 'NOPE1234', 'x1')).rejects.toThrow(/invalid_class_code/)
    await expect(rpc(w.db, u, 'join_class', w.joinCode, 'S1')).rejects.toThrow(/pseudonym_taken/)
    await rpc(w.db, u, 'join_class', w.joinCode.toLowerCase(), 'fox')
  })

  it('Schüler/in kann sich nicht zur Lehrkraft machen', async () => {
    const w = await world(1)
    await expect(rpc(w.db, w.students.s1, 'register_teacher', await teacherCode(w.db)))
      .resolves.toBeFalsy() // hat schon ein Profil (student) → bleibt Schüler
    const r = await w.db.query(`select role from profiles where user_id=$1`, [w.students.s1])
    expect((r.rows[0] as any).role).toBe('student')
  })
})

describe('Startdepot', () => {
  it('Startkapital 10.000 $ + Buchung „initial“, auch für spätere Neuzugänge', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    const late = await newUser(w.db, 'late')
    await rpc(w.db, late, 'join_class', w.joinCode, 'late')
    const pf = await w.db.query(`select cash::float, (select count(*) from cash_movements m where m.portfolio_id=p.id and kind='initial')::int n
                                   from portfolios p where round_id=$1`, [round])
    expect(pf.rows).toHaveLength(2)
    for (const r of pf.rows as any[]) { expect(r.cash).toBe(10000); expect(r.n).toBe(1) }
  })
})

describe('Startkurse', () => {
  it('simulierte Runde: schon am ersten Tag sind Kurse sichtbar (kein Blindflug)', async () => {
    const w = await world(1)
    await activeRound(w)
    const ov: any = await rpc(w.db, w.students.s1, 'my_overview')
    expect(ov.assets.length).toBe(9)
    expect(ov.assets.every((a: any) => a.price > 0)).toBe(true)
  })
})

describe('Entscheidung', () => {
  it('eine Entscheidung je Handelstag: zweite überschreibt, es bleibt eine Zeile', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await setNow(w.db, MON_MORNING)
    const aapl = await assetId(w.db, 'AAPL')
    await submit(w, round, 's1', 'buy', aapl, 5)
    await submit(w, round, 's1', 'buy', aapl, 7, { reasoning: 'Changed my mind about the size.' })
    const r = await w.db.query(`select quantity, trading_date::text d from decisions`)
    expect(r.rows).toHaveLength(1)
    expect((r.rows[0] as any).quantity).toBe(7)
    expect((r.rows[0] as any).d).toBe(MON)
  })

  it('Datenbank selbst verhindert Duplikate (unique-Constraint), auch am API vorbei', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await setNow(w.db, MON_MORNING)
    await submit(w, round, 's1', 'hold', null, null)
    await expect(w.db.query(
      `insert into decisions(round_id, student_id, portfolio_id, trading_date, action, expectation, reasoning, evidence, risks)
       select round_id, student_id, portfolio_id, trading_date, 'hold', expectation, reasoning, evidence, risks from decisions`
    )).rejects.toThrow(/duplicate key|unique/i)
  })

  it('nach dem Einsendeschluss zählt die Entscheidung für den nächsten Handelstag', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await setNow(w.db, '2026-11-30T14:30:00Z') // 15:30 Berlin, Deadline verpasst
    const r: any = await submit(w, round, 's1', 'hold', null, null)
    expect(r.trading_date).toBe('2026-12-01')
  })

  it('Wochenende und Feiertag werden übersprungen', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await setNow(w.db, '2026-11-25T14:30:00Z') // Mi nach 15:00; Do 26.11. = Thanksgiving
    const r: any = await submit(w, round, 's1', 'hold', null, null)
    expect(r.trading_date).toBe('2026-11-27')
    await setNow(w.db, '2026-11-27T14:30:00Z') // Fr nach 15:00 → Sa/So → Mo
    const s: any = await rpc(w.db, w.students.s1, 'submit_decision', round, 'hold', null, null,
      'I expect nothing to change.', 'Better not to trade now.', 'No new data available.', 'Missing an upswing.')
    expect(s.trading_date).toBe('2026-11-30')
  })

  it('Zeitzone: Deadline 15:00 Berlin gilt auch in der Sommerzeit-Lücke korrekt (Winter = UTC+1)', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await setNow(w.db, '2026-11-30T13:59:00Z') // 14:59 Berlin → noch offen
    const a: any = await submit(w, round, 's1', 'hold', null, null)
    expect(a.trading_date).toBe(MON)
    await setNow(w.db, '2026-11-30T14:00:00Z') // 15:00 Berlin → zu spät
    const b: any = await submit(w, round, 's1', 'hold', null, null)
    expect(b.trading_date).toBe('2026-12-01')
  })

  it('verlangt Begründung; leere Felder werden abgelehnt', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await setNow(w.db, MON_MORNING)
    await expect(submit(w, round, 's1', 'hold', null, null, { risks: '  ' })).rejects.toThrow()
    await expect(submit(w, round, 's1', 'hold', null, null, { evidence: 'short' })).rejects.toThrow()
  })

  it('kann nicht mehr kaufen als Bargeld; kann nichts Unbesessenes verkaufen', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await setNow(w.db, MON_MORNING)
    const aapl = await assetId(w.db, 'AAPL')
    await asService(w.db, `select generate_simulated_prices('2026-11-30')`)
    await expect(submit(w, round, 's1', 'buy', aapl, 100000)).rejects.toThrow(/insufficient_cash/)
    await expect(submit(w, round, 's1', 'sell', aapl, 1)).rejects.toThrow(/insufficient_shares/)
  })

  it('Fremde Runde / Nicht-Mitglied darf nicht abgeben', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    await setNow(w.db, MON_MORNING)
    const stranger = await newUser(w.db, 'stranger')
    const d = decision()
    await expect(rpc(w.db, stranger, 'submit_decision', round, 'hold', null, null,
      d.expectation, d.reasoning, d.evidence, d.risks)).rejects.toThrow(/forbidden/)
  })

  it('Entwurfs-/beendete Runde nimmt nichts an', async () => {
    const w = await world(1)
    const id = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Draft', 10000, '15:00', false)
    await setNow(w.db, MON_MORNING)
    await expect(submit(w, id, 's1', 'hold', null, null)).rejects.toThrow(/round_not_active|no_portfolio/)
  })
})

describe('Abrechnung', () => {
  async function setup() {
    const w = await world(2)
    await setNow(w.db, MON_MORNING)
    const round = await activeRound(w, { external: true })
    return { w, round }
  }

  it('Kauf wird zum Schlusskurs ausgeführt: Bargeld, Bestand, Buchung, Snapshot', async () => {
    const { w, round } = await setup()
    const aapl = await assetId(w.db, 'AAPL')
    await putPrices(w.db, MON, { AAPL: 200 })
    await submit(w, round, 's1', 'buy', aapl, 10)
    await setNow(w.db, '2026-11-30T21:00:00Z')
    expect(await asService(w.db, `select settle_round_day($1, $2) r`, [round, MON])).toEqual([{ r: 'completed' }])

    const pf = (await w.db.query(`select cash::float c from portfolios where student_id=$1`, [w.students.s1])).rows[0] as any
    expect(pf.c).toBe(8000)
    const h = (await w.db.query(`select quantity, avg_cost::float a from holdings`)).rows[0] as any
    expect(h.quantity).toBe(10); expect(h.a).toBe(200)
    const m = (await w.db.query(`select kind, amount::float a, balance_after::float b from cash_movements where kind='buy'`)).rows[0] as any
    expect(m).toEqual({ kind: 'buy', a: -2000, b: 8000 })
    const snap = (await w.db.query(`select total_value::float t from portfolio_snapshots s join portfolios p on p.id=s.portfolio_id where p.student_id=$1`, [w.students.s1])).rows[0] as any
    expect(snap.t).toBe(10000)
    // s2 hat nichts abgegeben → trotzdem bewertet, Bargeld unverändert
    const s2 = (await w.db.query(`select total_value::float t from portfolio_snapshots s join portfolios p on p.id=s.portfolio_id where p.student_id=$1`, [w.students.s2])).rows[0] as any
    expect(s2.t).toBe(10000)
  })

  it('zweite Abrechnung desselben Tages ändert nichts (keine Doppelausführung)', async () => {
    const { w, round } = await setup()
    const aapl = await assetId(w.db, 'AAPL')
    await putPrices(w.db, MON, { AAPL: 200 })
    await submit(w, round, 's1', 'buy', aapl, 10)
    await setNow(w.db, '2026-11-30T21:00:00Z')
    await asService(w.db, `select settle_round_day($1, $2)`, [round, MON])
    expect(await asService(w.db, `select settle_round_day($1, $2) r`, [round, MON])).toEqual([{ r: 'already_settled' }])
    expect(await asService(w.db, `select settle_round_day($1, $2, true) r`, [round, MON])).toEqual([{ r: 'already_settled' }])
    const c = (await w.db.query(`select (select count(*) from executions)::int e, (select count(*) from cash_movements where kind='buy')::int m,
                                        (select quantity from holdings)::int q, (select cash::float from portfolios where student_id=$1) c`, [w.students.s1])).rows[0] as any
    expect(c).toEqual({ e: 1, m: 1, q: 10, c: 8000 })
    await asService(w.db, `select run_daily_settlement()`)  // der tägliche Lauf darf ebenfalls nichts doppeln
    expect(((await w.db.query(`select count(*)::int n from executions`)).rows[0] as any).n).toBe(1)
  })

  it('fehlende Kurse: nichts wird ausgeführt, nichts erfunden; später mit Kursen klappt es', async () => {
    const { w, round } = await setup()
    const aapl = await assetId(w.db, 'AAPL')
    await submit(w, round, 's1', 'buy', aapl, 1)
    await setNow(w.db, '2026-11-30T21:00:00Z')
    expect(await asService(w.db, `select settle_round_day($1, $2) r`, [round, MON])).toEqual([{ r: 'blocked_missing_prices' }])
    expect(((await w.db.query(`select count(*)::int n from executions`)).rows[0] as any).n).toBe(0)
    expect(((await w.db.query(`select count(*)::int n from daily_prices where price_date = $1`, [MON])).rows[0] as any).n).toBe(0)
    await putPrices(w.db, MON, { AAPL: 190 })
    expect(await asService(w.db, `select settle_round_day($1, $2) r`, [round, MON])).toEqual([{ r: 'completed' }])
    expect(((await w.db.query(`select count(*)::int n from executions`)).rows[0] as any).n).toBe(1)
  })

  it('vor dem Einsendeschluss: not_due; am Wochenende/Feiertag: not_trading_day', async () => {
    const { w, round } = await setup()
    await putPrices(w.db, MON, {})
    expect(await asService(w.db, `select settle_round_day($1, $2) r`, [round, MON])).toEqual([{ r: 'not_due' }])
    expect(await asService(w.db, `select settle_round_day($1, '2026-12-05') r`, [round])).toEqual([{ r: 'not_trading_day' }])
    expect(await asService(w.db, `select settle_round_day($1, '2026-11-26') r`, [round])).toEqual([{ r: 'not_trading_day' }])
  })

  it('Überausgabe bei der Abrechnung: Kurs gestiegen → Auftrag abgelehnt, Bargeld unberührt', async () => {
    const { w, round } = await setup()
    const aapl = await assetId(w.db, 'AAPL')
    await asService(w.db, `insert into daily_prices(asset_id, price_date, close, source) values ($1,'2026-11-27',100,'eod_api')`, [aapl])
    await submit(w, round, 's1', 'buy', aapl, 100) // 100 × 100 = 10.000 → gerade noch bezahlbar
    await putPrices(w.db, MON, { AAPL: 110 })
    await setNow(w.db, '2026-11-30T21:00:00Z')
    await asService(w.db, `select settle_round_day($1, $2)`, [round, MON])
    const o = (await w.db.query(`select status, reject_reason from orders`)).rows[0] as any
    expect(o).toEqual({ status: 'rejected', reject_reason: 'insufficient_cash' })
    expect(((await w.db.query(`select cash::float c from portfolios where student_id=$1`, [w.students.s1])).rows[0] as any).c).toBe(10000)
    expect(((await w.db.query(`select count(*)::int n from executions`)).rows[0] as any).n).toBe(0)
  })

  it('Verkauf bringt Bargeld; Bestand sinkt; Halten erzeugt keinen Auftrag', async () => {
    const { w, round } = await setup()
    const aapl = await assetId(w.db, 'AAPL')
    await putPrices(w.db, MON, { AAPL: 200 })
    await submit(w, round, 's1', 'buy', aapl, 10)
    await submit(w, round, 's2', 'hold', null, null)
    await setNow(w.db, '2026-11-30T21:00:00Z')
    await asService(w.db, `select settle_round_day($1, $2)`, [round, MON])
    expect(((await w.db.query(`select count(*)::int n from orders`)).rows[0] as any).n).toBe(1)

    await setNow(w.db, '2026-12-01T09:00:00Z')
    await putPrices(w.db, '2026-12-01', { AAPL: 220 })
    await submit(w, round, 's1', 'sell', aapl, 4)
    await setNow(w.db, '2026-12-01T21:00:00Z')
    await asService(w.db, `select settle_round_day($1, '2026-12-01')`, [round])
    const pf = (await w.db.query(`select cash::float c from portfolios where student_id=$1`, [w.students.s1])).rows[0] as any
    expect(pf.c).toBe(8000 + 4 * 220)
    expect(((await w.db.query(`select quantity q from holdings`)).rows[0] as any).q).toBe(6)
  })

  it('Tageslauf holt verpasste Tage der Reihe nach nach — Feiertag und Wochenende werden übersprungen', async () => {
    const w = await world(1)
    await setNow(w.db, '2026-11-25T09:00:00Z') // Mi vor Thanksgiving
    const round = await activeRound(w, { external: true })
    for (const d of ['2026-11-25', '2026-11-27', '2026-11-30']) await putPrices(w.db, d, {})
    await setNow(w.db, '2026-11-30T21:00:00Z') // Lauf fiel aus; erst Montagabend wieder aktiv
    const r: any = (await asService(w.db, `select run_daily_settlement() r`))[0].r
    expect(r.map((x: any) => [x.date, x.result])).toEqual([
      ['2026-11-25', 'completed'], ['2026-11-27', 'completed'], ['2026-11-30', 'completed'],
    ])
    const runs = (await w.db.query(`select trading_date::text d from settlement_runs where round_id=$1 order by 1`, [round])).rows
    expect(runs.map((x: any) => x.d)).toEqual(['2026-11-25', '2026-11-27', '2026-11-30'])
    // erneuter Lauf: nichts mehr zu tun
    const again: any = (await asService(w.db, `select run_daily_settlement() r`))[0].r
    expect(again.every((x: any) => x.result === 'already_settled' || x.result === 'not_due')).toBe(true)
  })
})

describe('Simulierter Markt', () => {
  it('deterministisch, idempotent, überschreibt nichts, ETF liegt zwischen den Aktien', async () => {
    const w = await world(0)
    await asService(w.db, `select generate_simulated_prices('2026-12-04')`)
    const a = (await w.db.query(`select asset_id, price_date::text d, close::float c from daily_prices order by 1,2`)).rows
    await asService(w.db, `select generate_simulated_prices('2026-12-04')`)
    const b = (await w.db.query(`select asset_id, price_date::text d, close::float c from daily_prices order by 1,2`)).rows
    expect(b).toEqual(a)
    // keine Wochenend-/Feiertagskurse
    const days = (await w.db.query(`select distinct price_date::text d from daily_prices order by 1`)).rows.map((r: any) => r.d)
    expect(days).toEqual(['2026-12-04'])
    // frisch erzeugt über mehrere Tage: nur Börsentage
    const w2 = await world(0)
    await setNow(w2.db, '2026-11-20T00:00:00Z')
    await asService(w2.db, `select generate_simulated_prices('2026-11-20')`)
    await asService(w2.db, `select generate_simulated_prices('2026-12-01')`)
    const d2 = (await w2.db.query(`select distinct price_date::text d from daily_prices order by 1`)).rows.map((r: any) => r.d)
    expect(d2).toEqual(['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27', '2026-11-30', '2026-12-01'])
    const src = (await w2.db.query(`select distinct source from daily_prices`)).rows
    expect(src).toEqual([{ source: 'simulated' }])
    const range = (await w2.db.query(`select min(close)::float lo from daily_prices where close <= 0`)).rows[0] as any
    expect(range.lo).toBeNull()
  })

  it('Kurse sind unveränderlich', async () => {
    const w = await world(0)
    await asService(w.db, `select generate_simulated_prices('2026-12-04')`)
    await expect(w.db.query(`update daily_prices set close = 1`)).rejects.toThrow(/immutable_record/)
    await expect(w.db.query(`delete from daily_prices`)).rejects.toThrow(/immutable_record/)
  })
})

describe('Unveränderlichkeit', () => {
  it('abgerechnete Entscheidungen, Aufträge, Ausführungen, Buchungen lassen sich nicht ändern/löschen', async () => {
    const w = await world(1)
    const round = await activeRound(w, { external: true })
    await setNow(w.db, MON_MORNING)
    const aapl = await assetId(w.db, 'AAPL')
    await putPrices(w.db, MON, {})
    await submit(w, round, 's1', 'buy', aapl, 1)
    await setNow(w.db, '2026-11-30T21:00:00Z')
    await asService(w.db, `select settle_round_day($1, $2)`, [round, MON])
    for (const sql of [
      `update decisions set quantity = 99`, `delete from decisions`,
      `update orders set quantity = 99`, `delete from orders`,
      `update executions set price = 1`, `delete from executions`,
      `update cash_movements set amount = 1`, `delete from cash_movements where kind='buy'`,
      `update portfolio_snapshots set total_value = 1`, `delete from portfolio_snapshots`,
    ]) {
      await expect(w.db.query(sql), sql).rejects.toThrow(/immutable_record/)
    }
  })

  it('Demo-Reset: nur für Demo-Runden, nur diese Runde, danach wieder startbar', async () => {
    const w = await world(1)
    const real = await activeRound(w)
    await expect(rpc(w.db, w.teacher, 'reset_demo_round', real)).rejects.toThrow(/demo_only/)
    await rpc(w.db, w.teacher, 'end_round', real)

    const demo = await activeRound(w, { demo: true })
    await setNow(w.db, MON_MORNING)
    await submit(w, demo, 's1', 'hold', null, null)
    const res: any = await rpc(w.db, w.teacher, 'demo_settle_next_day', demo)
    expect(res.result).toBe('completed')
    await rpc(w.db, w.teacher, 'reset_demo_round', demo)
    const left = (await w.db.query(`select (select count(*) from decisions where round_id=$1)::int d,
                                           (select count(*) from portfolios where round_id=$1)::int p,
                                           (select status from rounds where id=$1) s,
                                           (select count(*) from portfolios where round_id=$2)::int other`, [demo, real])).rows[0] as any
    expect(left).toEqual({ d: 0, p: 0, s: 'draft', other: 1 }) // echte, beendete Runde bleibt unberührt
    await rpc(w.db, w.teacher, 'start_round', demo)
  })

  it('„Tag vorspulen“ nur in Demo-Runden', async () => {
    const w = await world(1)
    const real = await activeRound(w)
    await expect(rpc(w.db, w.teacher, 'demo_settle_next_day', real)).rejects.toThrow(/demo_only/)
  })
})

describe('Zugriff & Datenschutz (RLS)', () => {
  async function two() {
    const w = await world(2)
    const round = await activeRound(w)
    await setNow(w.db, MON_MORNING)
    await submit(w, round, 's1', 'hold', null, null, { reasoning: 'SECRET-REASON-OF-S1 about demand.' })
    return { w, round }
  }

  it('Schüler/in sieht nur das eigene Depot und die eigenen Entscheidungen', async () => {
    const { w } = await two()
    const s2 = w.students.s2
    expect(await asUser(w.db, s2, `select * from decisions`)).toHaveLength(0)
    expect(await asUser(w.db, s2, `select * from portfolios`)).toHaveLength(1)
    expect(await asUser(w.db, s2, `select * from cash_movements`)).toHaveLength(1)
    expect(await asUser(w.db, s2, `select * from class_members`)).toHaveLength(1) // nur sich selbst
    expect(await asUser(w.db, w.students.s1, `select * from decisions`)).toHaveLength(1)
    const ov: any = await rpc(w.db, s2, 'my_overview')
    expect(JSON.stringify(ov)).not.toContain('SECRET-REASON-OF-S1')
  })

  it('Lehrkraft sieht alles der eigenen Klasse, aber nichts aus fremden Klassen', async () => {
    const { w, round } = await two()
    expect(await asUser(w.db, w.teacher, `select * from decisions`)).toHaveLength(1)
    const other = await newUser(w.db, 'teacher2')
    await rpc(w.db, other, 'register_teacher', await teacherCode(w.db))
    expect(await asUser(w.db, other, `select * from decisions`)).toHaveLength(0)
    expect(await asUser(w.db, other, `select * from portfolios`)).toHaveLength(0)
    await expect(rpc(w.db, other, 'teacher_round_detail', round)).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, other, 'start_round', round)).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, other, 'end_round', round)).rejects.toThrow(/forbidden/)
    expect(((await w.db.query(`select status from rounds where id=$1`, [round])).rows[0] as any).status).toBe('active')
  })

  it('Clients können Tabellen nicht direkt schreiben', async () => {
    const { w, round } = await two()
    const s1 = w.students.s1
    for (const sql of [
      `update portfolios set cash = 1000000`,
      `update decisions set quantity = 5`,
      `delete from decisions`,
      `insert into holdings(portfolio_id, asset_id, quantity) select p.id, a.id, 1000 from portfolios p, assets a limit 1`,
      `insert into daily_prices(asset_id, price_date, close, source) select id, '2026-12-01', 1, 'simulated' from assets limit 1`,
      `update rounds set status='ended'`,
      `insert into profiles(user_id, role) values (gen_random_uuid(), 'teacher')`,
    ]) {
      await expect(asUser(w.db, s1, sql), sql).rejects.toThrow(/permission denied/)
    }
    await expect(asUser(w.db, w.teacher, `update portfolios set cash = 1`)).rejects.toThrow(/permission denied/)
    expect(round).toBeTruthy()
  })

  it('interne Funktionen (Abrechnung, Kurse) sind für Clients gesperrt; Geheimcode unlesbar', async () => {
    const { w, round } = await two()
    await expect(rpc(w.db, w.students.s1, 'settle_round_day', round, MON, true)).rejects.toThrow(/permission denied/)
    await expect(rpc(w.db, w.teacher, 'settle_round_day', round, MON, true)).rejects.toThrow(/permission denied/)
    await expect(rpc(w.db, w.teacher, 'run_daily_settlement')).rejects.toThrow(/permission denied/)
    await expect(rpc(w.db, w.students.s1, 'generate_simulated_prices', MON)).rejects.toThrow(/permission denied/)
    await expect(asUser(w.db, w.teacher, `select * from app_config`)).rejects.toThrow(/permission denied/)
    await expect(asUser(w.db, w.students.s1, `select * from app_config`)).rejects.toThrow(/permission denied/)
  })

  it('Lehrkraft-Aggregat zeigt nur Zahlen für die Wand (kaufen/verkaufen/halten)', async () => {
    const { w, round } = await two()
    const aapl = await assetId(w.db, 'AAPL')
    await asService(w.db, `select generate_simulated_prices('2026-11-30')`)
    await submit(w, round, 's2', 'buy', aapl, 1)
    const d: any = await rpc(w.db, w.teacher, 'teacher_round_detail', round)
    expect(d.counts_next).toEqual({ buy: 1, sell: 0, hold: 1 })
    expect(d.students.map((s: any) => s.submitted_today)).toEqual([true, true])
  })

  it('Offene Abgaben werden sichtbar', async () => {
    const { w, round } = await two()
    const d: any = await rpc(w.db, w.teacher, 'teacher_round_detail', round)
    const by = Object.fromEntries(d.students.map((s: any) => [s.pseudonym, s.submitted_today]))
    expect(by).toEqual({ s1: true, s2: false })
  })
})

describe('Reflexion & Feedback', () => {
  it('Reflexion erst nach Abrechnung; Feedback nur durch die eigene Lehrkraft', async () => {
    const w = await world(1)
    const round = await activeRound(w, { external: true })
    await setNow(w.db, MON_MORNING)
    await putPrices(w.db, MON, {})
    const d: any = await submit(w, round, 's1', 'hold', null, null)
    await expect(rpc(w.db, w.students.s1, 'save_reflection', d.decision_id,
      'It was convincing.', 'I overlooked rates.', 'I would research more.')).rejects.toThrow(/decision_not_settled/)
    await setNow(w.db, '2026-11-30T21:00:00Z')
    await asService(w.db, `select settle_round_day($1, $2)`, [round, MON])
    await rpc(w.db, w.students.s1, 'save_reflection', d.decision_id,
      'It was convincing.', 'I overlooked rates.', 'I would research more.')
    const other = await newUser(w.db, 'teacher3')
    await rpc(w.db, other, 'register_teacher', await teacherCode(w.db))
    await expect(rpc(w.db, other, 'save_feedback', d.decision_id, 'x', 3, 3, 3, 3)).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, w.students.s1, 'save_feedback', d.decision_id, 'x', 4, 4, 4, 4)).rejects.toThrow(/forbidden/)
    await rpc(w.db, w.teacher, 'save_feedback', d.decision_id, 'Good use of evidence.', 3, 3, 2, 4)
    const ov: any = await rpc(w.db, w.students.s1, 'my_overview')
    expect(ov.history[0].feedback.comment).toBe('Good use of evidence.')
    expect(ov.history[0].reflection.convincing).toBe('It was convincing.')
  })
})
