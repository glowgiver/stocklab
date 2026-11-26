import { describe, it, expect } from 'vitest'
import {
  world, activeRound, rpc, asService, asUser, setNow, assetId, decision, newUser, teacherCode,
} from './helpers'

const MON = '2026-11-30'
const MON_MORNING = '2026-11-30T09:00:00Z'

const prices = (aapl: number) => ({
  AAPL: aapl, MSFT: 420, AMZN: 180, TSLA: 250, KO: 62, NKE: 95, DIS: 110, MCD: 290, URTH: 165,
})

async function submitBuy(w: Awaited<ReturnType<typeof world>>, round: string, who: string, symbol: string, qty: number) {
  const d = decision()
  const asset = await assetId(w.db, symbol)
  return rpc(w.db, w.students[who], 'submit_decision', round, 'buy', asset, qty, d.expectation, d.reasoning, d.evidence, d.risks)
}

describe('Echte Tagesschlusskurse (von der Lehrkraft eingetragen)', () => {
  it('Runde mit echten Kursen startet erst, wenn echte Startkurse da sind — simulierte zählen nicht', async () => {
    const w = await world(1)
    await asService(w.db, `select generate_simulated_prices('2026-11-20')`) // Demo-Welt existiert bereits
    const id = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Real', 10000, '15:00', false, 'external')
    await expect(rpc(w.db, w.teacher, 'start_round', id)).rejects.toThrow(/no_start_prices/)
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-20', prices(190), false)
    await rpc(w.db, w.teacher, 'start_round', id)
  })

  it('Entwurf mit echten Kursen: Status nennt den letzten Handelstag als Startkurs-Tag', async () => {
    const w = await world(1)
    await setNow(w.db, '2026-11-30T09:00:00Z')   // Montag
    const id = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Real', 10000, '15:00', false, 'external')
    const st: any = await rpc(w.db, w.teacher, 'teacher_price_status', id)
    expect(st.date).toBe('2026-11-27')           // Freitag; Do 26.11. war Thanksgiving
    expect(st.data_mode).toBe('external')
    expect(st.missing).toHaveLength(9)
  })

  it('Demo mit echten Kursen ist nicht erlaubt (Tag vorspulen gibt es nur simuliert)', async () => {
    const w = await world(1)
    await expect(rpc(w.db, w.teacher, 'create_round', w.classId, 'X', 10000, '15:00', true, 'external'))
      .rejects.toThrow(/invalid_round_settings/)
  })

  it('Ablauf: eintragen → abrechnen → Ausführung zum eingetragenen Schlusskurs', async () => {
    const w = await world(1)
    await setNow(w.db, '2026-11-23T09:00:00Z')
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-20', prices(190), false)
    const round = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Real', 10000, '15:00', false, 'external')
    await setNow(w.db, MON_MORNING)
    await rpc(w.db, w.teacher, 'start_round', round)
    await submitBuy(w, round, 's1', 'AAPL', 10)

    await setNow(w.db, '2026-11-30T22:30:00Z')   // nach Börsenschluss, noch keine Kurse eingetragen
    const st: any = await rpc(w.db, w.teacher, 'teacher_price_status', round)
    expect(st.date).toBe(MON)
    expect(st.missing).toHaveLength(9)
    expect(st.closed).toBe(true)
    const blocked: any = await rpc(w.db, w.teacher, 'teacher_settle_due', round)
    expect(blocked.map((x: any) => x.result)).toEqual(['blocked_missing_prices'])

    const saved: any = await rpc(w.db, w.teacher, 'teacher_set_prices', MON, prices(200), false)
    expect(saved).toEqual({ saved: 9, missing: [] })
    const done: any = await rpc(w.db, w.teacher, 'teacher_settle_due', round)
    expect(done.map((x: any) => x.result)).toEqual(['completed'])
    const row = (await w.db.query(`select price::float p, quantity q from executions`)).rows[0] as any
    expect(row).toEqual({ p: 200, q: 10 })
    const src = (await w.db.query(`select distinct source from daily_prices`)).rows
    expect(src).toEqual([{ source: 'manual' }])
  })

  it('Eingabe ist geprüft: nur Lehrkräfte, nur Börsentage in der Vergangenheit, nur Zahlen > 0', async () => {
    const w = await world(1)
    await setNow(w.db, MON_MORNING)
    await expect(rpc(w.db, w.students.s1, 'teacher_set_prices', '2026-11-27', prices(190), false)).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-28', prices(190), false)).rejects.toThrow(/invalid_price_date/) // Samstag
    await expect(rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-26', prices(190), false)).rejects.toThrow(/invalid_price_date/) // Thanksgiving
    await expect(rpc(w.db, w.teacher, 'teacher_set_prices', '2026-12-02', prices(190), false)).rejects.toThrow(/invalid_price_date/) // Zukunft
    await expect(rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-27', { AAPL: -1 }, false)).rejects.toThrow(/invalid_prices/)
    await expect(rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-27', { AAPL: 'abc' }, false)).rejects.toThrow(/invalid_prices/)
    await expect(rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-27', { NOPE: 5 }, false)).rejects.toThrow(/invalid_prices/)
    expect(((await w.db.query(`select count(*)::int n from daily_prices`)).rows[0] as any).n).toBe(0) // nichts halb geschrieben
  })

  it('Tippfehler-Schutz: Kurssprung > 35 % braucht Bestätigung; Korrektur vor Abrechnung möglich', async () => {
    const w = await world(1)
    await setNow(w.db, MON_MORNING)
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-25', prices(190), false)
    await expect(rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-27', prices(1930), false)).rejects.toThrow(/prices_implausible/)
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-27', prices(193), false)
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-27', prices(194.5), false) // Korrektur
    const p = (await w.db.query(`select close::float c from daily_prices p join assets a on a.id=p.asset_id where a.symbol='AAPL' and price_date='2026-11-27'`)).rows
    expect(p).toEqual([{ c: 194.5 }])
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-27', { AAPL: 400 }, true) // bewusst bestätigt
  })

  it('abgerechnete Tage sind gesperrt (Kurse lassen sich nicht nachträglich ändern)', async () => {
    const w = await world(1)
    await setNow(w.db, '2026-11-23T09:00:00Z')
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-20', prices(190), false)
    const round = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Real', 10000, '15:00', false, 'external')
    await rpc(w.db, w.teacher, 'start_round', round)
    await setNow(w.db, '2026-11-23T22:30:00Z')
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-23', prices(191), false)
    await rpc(w.db, w.teacher, 'teacher_settle_due', round)
    await expect(rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-23', prices(150), false)).rejects.toThrow(/prices_locked/)
  })

  it('simulierte und echte Welt mischen sich nie — auch nicht am selben Datum', async () => {
    const w = await world(1)
    await setNow(w.db, '2026-11-23T09:00:00Z')
    const sim = await activeRound(w)                                 // simulierte Runde → erzeugt Startkurse (11-20)
    const simPrice = ((await rpc<any>(w.db, w.students.s1, 'my_overview')).assets as any[]).find(a => a.symbol === 'AAPL').price
    await rpc(w.db, w.teacher, 'end_round', sim)
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-20', prices(simPrice + 5), false) // gleiches Datum, echte Welt
    const real = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Real', 10000, '15:00', false, 'external')
    await rpc(w.db, w.teacher, 'start_round', real)
    const ov: any = await rpc(w.db, w.students.s1, 'my_overview')
    expect(ov.assets.find((a: any) => a.symbol === 'AAPL').price).toBeCloseTo(simPrice + 5, 2) // echte Kurse, nicht die simulierten
    expect(ov.round.data_mode).toBe('external')
  })

  it('nur die eigene Lehrkraft rechnet ab', async () => {
    const w = await world(1)
    await setNow(w.db, '2026-11-23T09:00:00Z')
    await rpc(w.db, w.teacher, 'teacher_set_prices', '2026-11-20', prices(190), false)
    const round = await rpc<string>(w.db, w.teacher, 'create_round', w.classId, 'Real', 10000, '15:00', false, 'external')
    await rpc(w.db, w.teacher, 'start_round', round)
    const other = await newUser(w.db, 'other-teacher')
    await rpc(w.db, other, 'register_teacher', await teacherCode(w.db))
    await expect(rpc(w.db, other, 'teacher_settle_due', round)).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, other, 'teacher_price_status', round)).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, w.students.s1, 'teacher_settle_due', round)).rejects.toThrow(/forbidden/)
  })
})

describe('Lesetipps', () => {
  it('Lehrkraft legt https-Links an; Klasse sieht sie; andere Klassen nicht; Löschen nur durch Besitzer', async () => {
    const w = await world(1)
    const round = await activeRound(w)
    const id = await rpc<string>(w.db, w.teacher, 'add_reading_tip', round, 'Zinsen bleiben hoch', 'Tagesschau', 'https://www.tagesschau.de/wirtschaft/')
    expect(id).toBeTruthy()
    for (const bad of ['http://example.com/a', 'javascript:alert(1)', 'https://x y.de', 'ftp://x.de/a', 'tagesschau.de'])
      await expect(rpc(w.db, w.teacher, 'add_reading_tip', round, 'Titel', 'Q', bad)).rejects.toThrow(/invalid_tip/)

    const list: any[] = await rpc(w.db, w.students.s1, 'list_reading_tips', round)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ title: 'Zinsen bleiben hoch', source: 'Tagesschau', url: 'https://www.tagesschau.de/wirtschaft/' })

    // Schüler/in kann nichts anlegen oder löschen
    await expect(rpc(w.db, w.students.s1, 'add_reading_tip', round, 'Hack', 'x', 'https://evil.example/')).rejects.toThrow(/forbidden/)
    await expect(rpc(w.db, w.students.s1, 'delete_reading_tip', id)).rejects.toThrow(/forbidden/)
    await expect(asUser(w.db, w.students.s1, `insert into reading_tips(round_id,title,url) values ($1,'x y z','https://a.de')`, [round])).rejects.toThrow(/permission denied/)

    // fremde Klasse
    const t2 = await newUser(w.db, 't2')
    await rpc(w.db, t2, 'register_teacher', await teacherCode(w.db))
    const c2: any = await rpc(w.db, t2, 'create_class', 'Other')
    const s2 = await newUser(w.db, 'outsider')
    await rpc(w.db, s2, 'join_class', c2.join_code, 'outsider')
    expect(await rpc(w.db, s2, 'list_reading_tips', round)).toEqual([])
    await expect(rpc(w.db, t2, 'delete_reading_tip', id)).rejects.toThrow(/forbidden/)

    await rpc(w.db, w.teacher, 'delete_reading_tip', id)
    expect(await rpc(w.db, w.students.s1, 'list_reading_tips', round)).toEqual([])
  })
})
