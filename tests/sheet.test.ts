import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { SheetCsvProvider, parseCsv, providerFromEnv } from '../src/lib/market'

const csv = (body: string, ok = true, status = 200) =>
  (async () => ({ ok, status, text: async () => body })) as unknown as typeof fetch
const provider = (body: string, ok = true, status = 200) =>
  new SheetCsvProvider({ csvUrl: 'https://sheet.test/pub?output=csv', licenseConfirmed: true, fetchImpl: csv(body, ok, status) })

const HEAD = 'date,symbol,close,tradetime'

describe('Kursquelle Google-Tabelle', () => {
  it('liefert nur Kurse des gewünschten Tages; Dezimalkomma in Anführungszeichen geht', async () => {
    const p = provider(`${HEAD}\r\n2026-11-24,AAPL,190.5,2026-11-24 16:00\r\n2026-11-25,AAPL,"193,09",2026-11-25 16:00\r\n2026-11-25,KO,62,2026-11-25 16:00`)
    expect(await p.fetchClosingPrices(['AAPL', 'KO', 'MSFT'], '2026-11-25')).toEqual([
      { symbol: 'AAPL', date: '2026-11-25', close: 193.09 }, { symbol: 'KO', date: '2026-11-25', close: 62 }])
    expect(await p.fetchClosingPrices(['AAPL'], '2026-11-26')).toEqual([])   // Feiertag → nichts erfunden
  })
  it('Fehlerwerte und ein Kurs mit fremdem Handelsdatum werden verworfen', async () => {
    const p = provider(`${HEAD}\n2026-11-25,AAPL,#N/A,2026-11-25 16:00\n2026-11-25,KO,62,2026-11-24 16:00\n2026-11-25,NKE,-1,2026-11-25 16:00`)
    expect(await p.fetchClosingPrices(['AAPL', 'KO', 'NKE'], '2026-11-25')).toEqual([])
  })
  it('falsche Seite (nicht veröffentlicht) oder Ausfall scheitern laut', async () => {
    await expect(provider('<html>Sign in</html>').fetchClosingPrices(['AAPL'], '2026-11-25')).rejects.toThrow(/sheet_format/)
    await expect(provider('', false, 404).fetchClosingPrices(['AAPL'], '2026-11-25')).rejects.toThrow(/provider_http_404/)
  })
  it('ohne Bestätigung oder ohne https-Link nicht erzeugbar', () => {
    expect(() => providerFromEnv({ MARKET_PROVIDER: 'google_sheet', SHEET_CSV_URL: 'https://x.test/a' })).toThrow(/external_provider_disabled/)
    expect(() => providerFromEnv({ MARKET_PROVIDER: 'google_sheet', EOD_LICENSE_CONFIRMED: 'yes' })).toThrow(/sheet_url_missing/)
  })
  it('parseCsv: Anführungszeichen und doppelte Anführungszeichen', () => {
    expect(parseCsv('a,"b,c","d""e"\n\n1,2,3')).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']])
  })
})

describe('Google-Skript: was darf ins Protokoll?', () => {
  const ctx: any = {}
  runInNewContext(readFileSync(join(import.meta.dirname, '..', 'google', 'Code.gs'), 'utf8'), ctx)
  const inZone = (timeZone: string) => (d: Date, muster: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(x => [x.type, x.value]))
    return muster.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute)
  }
  // Wie echtes Google Sheets: die Tabelle steht in Europe/Berlin, tradetime zeigt die New-Yorker
  // Uhrzeit („16:00“) — das Date-Objekt ist also 16:00 BERLIN (= 15:00 UTC im Winter).
  const wanduhr = (tag: string, uhr: string) => new Date(`${tag}T${uhr}:00+01:00`)
  const run = (jetzt: string, zeilen: unknown[], vorhanden = {}, tabellenZone = 'Europe/Berlin') =>
    JSON.parse(JSON.stringify(ctx.neueZeilen(new Date(jetzt), zeilen, vorhanden, inZone('America/New_York'), inZone(tabellenZone))))
  const close = wanduhr('2026-11-25', '16:00')

  it('nach Börsenschluss wird der Schlusskurs protokolliert (Tabelle in deutscher Zeitzone)', () => {
    expect(run('2026-11-25T22:15:00Z', [['AAPL', 193.09, close]]))
      .toEqual([['2026-11-25', 'AAPL', 193.09, '2026-11-25 16:00']])
  })
  it('auch eine Tabelle in New-York-Zeit funktioniert', () => {
    expect(run('2026-11-25T22:15:00Z', [['AAPL', 193.09, new Date('2026-11-25T21:00:00Z')]], {}, 'America/New_York')[0][3])
      .toBe('2026-11-25 16:00')
  })
  it('während der Handelszeit nichts', () => {
    expect(run('2026-11-25T17:00:00Z', [['AAPL', 190, wanduhr('2026-11-25', '12:40')]])).toEqual([])
  })
  it('Feiertag: alter Kurs ist schon protokolliert → nichts Neues, kein falsches Datum', () => {
    expect(run('2026-11-26T22:15:00Z', [['AAPL', 193.09, close]], { '2026-11-25|AAPL': true })).toEqual([])
  })
  it('verkürzter Handelstag (Schluss 13:00) zählt', () => {
    expect(run('2026-11-27T22:15:00Z', [['AAPL', 195, wanduhr('2026-11-27', '13:00')]])[0][0]).toBe('2026-11-27')
  })
  it('Fehlerwerte werden übersprungen', () => {
    expect(run('2026-11-25T22:15:00Z', [['AAPL', '#N/A', close], ['KO', 62, ''], ['NKE', 0, close]])).toEqual([])
  })
})
