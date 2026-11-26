// Austauschbare Kursquelle für den täglichen Lauf (scripts/settle.ts).
//
//  - SimulatedProvider: Entwicklungsquelle. Die simulierten Kurse entstehen IN der Datenbank
//    (generate_simulated_prices), damit sie nie vom Client manipuliert werden können.
//  - HttpEodProvider:   Adapter für eine externe End-of-Day-API. STANDARDMÄSSIG AUS: ohne
//    ausdrückliche Lizenzbestätigung (EOD_LICENSE_CONFIRMED=yes) lässt er sich nicht einmal
//    erzeugen. Kostenlose API-Zugänge erlauben oft KEINE Anzeige/Weitergabe an Dritte
//    (Schüler) — das muss vorher geklärt sein.

export interface EodPrice { symbol: string; date: string; close: number }

export interface MarketDataProvider {
  readonly name: string
  /** Liefert nur Kurse, die die Quelle wirklich genannt hat. Fehlt einer, fehlt er — nie erfinden. */
  fetchClosingPrices(symbols: string[], date: string): Promise<EodPrice[]>
}

export class SimulatedProvider implements MarketDataProvider {
  readonly name = 'simulated (generated inside the database)'
  async fetchClosingPrices(): Promise<EodPrice[]> { return [] }
}

export interface HttpEodConfig {
  /** z. B. https://api.example.com/eod?symbol={symbol}&date={date}&token={key} */
  urlTemplate: string
  apiKey: string
  /** Pfad zum Schlusskurs in der JSON-Antwort, z. B. "close" oder "data.0.close" */
  closePath: string
  /** Optional: Pfad zum Datum der Antwort. Weicht es vom gewünschten Tag ab, wird der Kurs verworfen. */
  datePath?: string
  licenseConfirmed: boolean
  /** Pause zwischen zwei Abrufen (Gratis-Tarife erlauben oft nur wenige Abrufe pro Minute). */
  minIntervalMs?: number
  /** Wartezeit nach „429 Too Many Requests“, danach EIN weiterer Versuch. */
  retryAfterMs?: number
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}

export function pick(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj)
}

export class HttpEodProvider implements MarketDataProvider {
  readonly name = 'external end-of-day API'
  private cfg: HttpEodConfig
  constructor(cfg: HttpEodConfig) {
    this.cfg = cfg
    if (!cfg.licenseConfirmed) {
      throw new Error('external_provider_disabled: Lizenz für Anzeige/Weitergabe an Schüler nicht bestätigt (EOD_LICENSE_CONFIRMED=yes)')
    }
  }

  async fetchClosingPrices(symbols: string[], date: string): Promise<EodPrice[]> {
    const f = this.cfg.fetchImpl ?? fetch
    const sleep = this.cfg.sleepImpl ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
    const out: EodPrice[] = []
    for (const [i, symbol] of symbols.entries()) {
      if (i > 0 && this.cfg.minIntervalMs) await sleep(this.cfg.minIntervalMs)
      const url = this.cfg.urlTemplate
        .replaceAll('{symbol}', encodeURIComponent(symbol)).replaceAll('{date}', date).replaceAll('{key}', encodeURIComponent(this.cfg.apiKey))
      let res = await f(url)
      if (res.status === 429) {                                                    // Limit erreicht: einmal warten, nochmal
        await sleep(this.cfg.retryAfterMs ?? 65_000)
        res = await f(url)
      }
      if (!res.ok) throw new Error(`provider_http_${res.status} for ${symbol}`)   // Ausfall → laut scheitern
      const json = await res.json()
      if (this.cfg.datePath) {
        const d = String(pick(json, this.cfg.datePath) ?? '').slice(0, 10)
        if (d !== date) continue                                                   // Feiertag/veraltet → Kurs fehlt
      }
      const close = Number(pick(json, this.cfg.closePath))
      if (!Number.isFinite(close) || close <= 0) continue                          // unbrauchbar → fehlt, nicht raten
      out.push({ symbol, date, close })
    }
    return out
  }
}

/** CSV → Zeilen. Kann Anführungszeichen (z. B. "193,09"). */
export function parseCsv(text: string): string[][] {
  return text.split(/\r?\n/).filter(l => l.trim() !== '').map(line => {
    const cells: string[] = []
    let cur = '', quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (c === '"') quoted = false
        else cur += c
      } else if (c === '"') quoted = true
      else if (c === ',') { cells.push(cur); cur = '' }
      else cur += c
    }
    cells.push(cur)
    return cells.map(x => x.trim())
  })
}

export interface SheetCsvConfig {
  /** Veröffentlichtes Blatt „Protokoll“ als CSV (siehe google/Code.gs). */
  csvUrl: string
  licenseConfirmed: boolean
  fetchImpl?: typeof fetch
}

/** Kursquelle Google-Tabelle: liest das Protokoll (date,symbol,close,tradetime). */
export class SheetCsvProvider implements MarketDataProvider {
  readonly name = 'Google Sheet (GOOGLEFINANCE)'
  private cfg: SheetCsvConfig
  private rows: Promise<string[][]> | null = null
  constructor(cfg: SheetCsvConfig) {
    this.cfg = cfg
    if (!cfg.licenseConfirmed) {
      throw new Error('external_provider_disabled: Nutzung nicht bestätigt (EOD_LICENSE_CONFIRMED=yes)')
    }
    if (!cfg.csvUrl.startsWith('https://')) throw new Error('sheet_url_missing: SHEET_CSV_URL (https) fehlt')
  }

  private async load(): Promise<string[][]> {
    const res = await (this.cfg.fetchImpl ?? fetch)(this.cfg.csvUrl)
    if (!res.ok) throw new Error(`provider_http_${res.status} for Google Sheet`)
    const [head, ...rest] = parseCsv(await res.text())
    if ((head ?? []).slice(0, 4).join(',') !== 'date,symbol,close,tradetime') {
      throw new Error('sheet_format: erwartet date,symbol,close,tradetime — ist das Blatt „Protokoll“ als CSV veröffentlicht?')
    }
    return rest
  }

  async fetchClosingPrices(symbols: string[], date: string): Promise<EodPrice[]> {
    this.rows ??= this.load()
    const wanted = new Set(symbols)
    const found = new Map<string, number>()
    for (const [d, symbol, close, tradetime] of await this.rows) {
      if (d !== date || !wanted.has(symbol) || !(tradetime ?? '').startsWith(date)) continue
      const n = Number(close.replace(',', '.'))
      if (Number.isFinite(n) && n > 0) found.set(symbol, n)      // unbrauchbar → fehlt, nicht raten
    }
    return [...found].map(([symbol, close]) => ({ symbol, date, close }))
  }
}

// Voreinstellung „massive“ (früher Polygon.io): Tagesbalken eines einzelnen Tages, Gratis-Tarif 5 Abrufe/Min.
// Nicht gegen die echte API getestet — Adresse und Pfad stehen in der Doku des Anbieters.
const MASSIVE_URL = 'https://api.massive.com/v2/aggs/ticker/{symbol}/range/1/day/{date}/{date}?adjusted=true&apiKey={key}'

export function providerFromEnv(env: Record<string, string | undefined>): MarketDataProvider {
  if (env.MARKET_PROVIDER === 'google_sheet') {
    return new SheetCsvProvider({ csvUrl: env.SHEET_CSV_URL ?? '', licenseConfirmed: env.EOD_LICENSE_CONFIRMED === 'yes' })
  }
  if (env.MARKET_PROVIDER === 'massive') {
    return new HttpEodProvider({
      urlTemplate: env.EOD_API_URL_TEMPLATE || MASSIVE_URL,
      apiKey: env.MASSIVE_API_KEY || env.EOD_API_KEY || '',
      closePath: env.EOD_CLOSE_PATH || 'results.0.c',
      licenseConfirmed: env.EOD_LICENSE_CONFIRMED === 'yes',
      minIntervalMs: Number(env.EOD_MIN_INTERVAL_MS || 13_000),
    })
  }
  if (env.MARKET_PROVIDER !== 'http') return new SimulatedProvider()
  return new HttpEodProvider({
    urlTemplate: env.EOD_API_URL_TEMPLATE ?? '',
    apiKey: env.EOD_API_KEY ?? '',
    closePath: env.EOD_CLOSE_PATH ?? 'close',
    datePath: env.EOD_DATE_PATH,
    licenseConfirmed: env.EOD_LICENSE_CONFIRMED === 'yes',
    minIntervalMs: env.EOD_MIN_INTERVAL_MS ? Number(env.EOD_MIN_INTERVAL_MS) : undefined,
  })
}
