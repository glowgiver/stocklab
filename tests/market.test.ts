import { describe, it, expect } from 'vitest'
import { HttpEodProvider, SimulatedProvider, providerFromEnv, pick } from '../src/lib/market'

const json = (body: unknown, ok = true, status = 200) =>
  (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch

const cfg = { urlTemplate: 'https://x.test/{symbol}/{date}?k={key}', apiKey: 'K', closePath: 'data.0.close', datePath: 'data.0.date' }

describe('Kursquelle', () => {
  it('externer Provider ist ohne Lizenzbestätigung nicht erzeugbar', () => {
    expect(() => new HttpEodProvider({ ...cfg, licenseConfirmed: false })).toThrow(/external_provider_disabled/)
    expect(() => providerFromEnv({ MARKET_PROVIDER: 'http' })).toThrow(/external_provider_disabled/)
  })
  it('Standard ist die simulierte Quelle (liefert keine eigenen Kurse)', async () => {
    const p = providerFromEnv({})
    expect(p).toBeInstanceOf(SimulatedProvider)
    expect(await p.fetchClosingPrices([], '2026-12-01')).toEqual([])
  })
  it('liefert nur echte Antworten; falsches Datum oder Müll → Kurs fehlt, nichts erfunden', async () => {
    const ok = new HttpEodProvider({ ...cfg, licenseConfirmed: true, fetchImpl: json({ data: [{ date: '2026-12-01T00:00:00', close: 123.4 }] }) })
    expect(await ok.fetchClosingPrices(['AAPL'], '2026-12-01')).toEqual([{ symbol: 'AAPL', date: '2026-12-01', close: 123.4 }])
    expect(await ok.fetchClosingPrices(['AAPL'], '2026-12-02')).toEqual([])
    const junk = new HttpEodProvider({ ...cfg, licenseConfirmed: true, fetchImpl: json({ data: [{ date: '2026-12-01', close: 'n/a' }] }) })
    expect(await junk.fetchClosingPrices(['AAPL'], '2026-12-01')).toEqual([])
  })
  it('API-Ausfall scheitert laut (statt still zu überspringen)', async () => {
    const down = new HttpEodProvider({ ...cfg, licenseConfirmed: true, fetchImpl: json({}, false, 503) })
    await expect(down.fetchClosingPrices(['AAPL'], '2026-12-01')).rejects.toThrow(/provider_http_503/)
  })
  it('pick liest verschachtelte Pfade', () => {
    expect(pick({ a: [{ b: 5 }] }, 'a.0.b')).toBe(5)
    expect(pick({}, 'a.0.b')).toBeUndefined()
  })
  it('Massive-Voreinstellung: Pfad results.0.c, Pause zwischen Abrufen, Schlüssel nur aus der Umgebung', async () => {
    const urls: string[] = []
    const sleeps: number[] = []
    const p = providerFromEnv({ MARKET_PROVIDER: 'massive', MASSIVE_API_KEY: 'SECRET', EOD_LICENSE_CONFIRMED: 'yes' }) as HttpEodProvider
    // fetch/sleep austauschen, ohne die Konfiguration zu ändern
    ;(p as any).cfg.fetchImpl = (async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ results: [{ c: 101.5 }] }) } }) as unknown as typeof fetch
    ;(p as any).cfg.sleepImpl = async (ms: number) => { sleeps.push(ms) }
    const r = await p.fetchClosingPrices(['AAPL', 'MSFT'], '2026-12-01')
    expect(r).toEqual([{ symbol: 'AAPL', date: '2026-12-01', close: 101.5 }, { symbol: 'MSFT', date: '2026-12-01', close: 101.5 }])
    expect(urls[0]).toContain('/AAPL/range/1/day/2026-12-01/2026-12-01')
    expect(urls[0]).toContain('apiKey=SECRET')
    expect(sleeps).toEqual([13000])                       // eine Pause zwischen zwei Abrufen
    expect(() => providerFromEnv({ MARKET_PROVIDER: 'massive', MASSIVE_API_KEY: 'x' })).toThrow(/external_provider_disabled/)
  })
  it('429 (Limit erreicht): einmal warten, dann erneut; zweite 429 scheitert laut', async () => {
    let n = 0
    const waits: number[] = []
    const f = (async () => (++n === 1
      ? { ok: false, status: 429, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ data: [{ date: '2026-12-01', close: 5 }] }) })) as unknown as typeof fetch
    const ok = new HttpEodProvider({ ...cfg, licenseConfirmed: true, fetchImpl: f, sleepImpl: async ms => { waits.push(ms) } })
    expect(await ok.fetchClosingPrices(['KO'], '2026-12-01')).toEqual([{ symbol: 'KO', date: '2026-12-01', close: 5 }])
    expect(waits).toEqual([65000])
    const always = new HttpEodProvider({ ...cfg, licenseConfirmed: true, fetchImpl: json({}, false, 429), sleepImpl: async () => {} })
    await expect(always.fetchClosingPrices(['KO'], '2026-12-01')).rejects.toThrow(/provider_http_429/)
  })
})
