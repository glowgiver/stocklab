// Reine Hilfsfunktionen (ohne Browser/DB) — gut testbar.

const DOMAIN = (import.meta as any).env?.VITE_STUDENT_EMAIL_DOMAIN ?? 'students.stocklab.invalid'

/** Schüler-Login ohne echte E-Mail: Klassencode + Pseudonym → interne Adresse. */
export function studentEmail(classCode: string, pseudonym: string): string {
  const slug = pseudonym
    .trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug}.${classCode.trim().toLowerCase()}@${DOMAIN}`
}

export function isValidPseudonym(p: string): boolean {
  return /^[A-Za-z0-9ÄÖÜäöüß _-]{2,24}$/.test(p.trim())
}

/** Bewertungsraster 40/20/20/20 — nur eine Rechenhilfe, die Lehrkraft vergibt die Stufen 0–4 selbst. */
export const WEIGHTS = { reasoning: 0.4, evidence: 0.2, risk: 0.2, reflection: 0.2 } as const

export function weightedPercent(s: { reasoning?: number | null; evidence?: number | null; risk?: number | null; reflection?: number | null }): number | null {
  const parts = [
    [s.reasoning, WEIGHTS.reasoning], [s.evidence, WEIGHTS.evidence],
    [s.risk, WEIGHTS.risk], [s.reflection, WEIGHTS.reflection],
  ] as const
  if (parts.some(([v]) => v == null)) return null
  const sum = parts.reduce((a, [v, w]) => a + (v as number) * w, 0)
  return Math.round((sum / 4) * 100)
}

export function money(n: number | null | undefined, locale = 'de-DE'): string {
  if (n == null) return '–'
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(n)
}

export function percent(n: number | null | undefined, locale = 'de-DE'): string {
  if (n == null || !isFinite(n)) return '–'
  return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(n)
}

/** CSV mit Excel-Schutz gegen Formel-Injection (=, +, -, @ am Zellanfang). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
}

export function formatDate(iso: string | null | undefined, locale = 'de-DE'): string {
  if (!iso) return '–'
  return new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
    .toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export function formatDateTime(iso: string | null | undefined, locale = 'de-DE', tz = 'Europe/Berlin'): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz })
}

/** „AAPL 193.09“ / „MSFT;421,50“ / „KO: 62“ (pro Zeile) → { AAPL: 193.09, … }. Unlesbare Zeilen werden übersprungen. */
export function parsePriceLines(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z.]{0,9})\s*[:;,\t ]\s*([0-9]+(?:[.,][0-9]+)?)\s*$/)
    if (m) out[m[1].toUpperCase()] = Number(m[2].replace(',', '.'))
  }
  return out
}
