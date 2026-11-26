// Täglicher Lauf (GitHub Action). Braucht SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY als
// GitHub-Secrets — der service_role-Key gehört NIE in den Browser oder ins Repository.
//   node --experimental-strip-types scripts/settle.ts [YYYY-MM-DD]
//
// 1) Läuft eine Runde mit echten Kursen und ist ein Anbieter eingerichtet: fehlende Schlusskurse
//    der letzten Tage holen (nur was fehlt — spart Abrufe; von Hand Eingetragenes bleibt unberührt).
// 2) Alle fälligen Tage abrechnen (idempotent; simulierte Kurse entstehen dabei in der Datenbank).
import { createClient } from '@supabase/supabase-js'
import { providerFromEnv, SimulatedProvider } from '../src/lib/market.ts'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen.')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })
const provider = providerFromEnv(process.env)

const iso = (d: Date) => d.toISOString().slice(0, 10)

async function fetchMissingPrices() {
  if (provider instanceof SimulatedProvider) return
  const { data: rounds, error: re } = await sb.from('rounds')
    .select('start_date,status').in('status', ['active', 'draft']).eq('data_mode', 'external')
  if (re) throw re
  if (!rounds?.length) { console.log('keine Runde mit echten Kursen — kein Abruf'); return }

  // Eine Runde im Entwurf braucht Startkurse von VOR ihrem Start → dann keine Untergrenze.
  const earliest = rounds.some(r => r.status === 'draft') ? '' : rounds.map(r => r.start_date as string).sort()[0]
  const end = process.argv[2] ? new Date(process.argv[2] + 'T00:00:00Z') : new Date()
  const days: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(end); d.setUTCDate(d.getUTCDate() - i)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6 && iso(d) >= earliest) days.push(iso(d))
  }
  if (!days.length) return

  const { data: assets, error: ae } = await sb.from('assets').select('id,symbol').eq('active', true)
  if (ae) throw ae
  const { data: have, error: he } = await sb.from('daily_prices')
    .select('asset_id,price_date').eq('market', 'real').in('price_date', days)
  if (he) throw he
  const haveSet = new Set((have ?? []).map(r => `${r.asset_id}|${r.price_date}`))

  for (const day of days) {
    const missing = assets!.filter(a => !haveSet.has(`${a.id}|${day}`))
    if (!missing.length) continue
    const prices = await provider.fetchClosingPrices(missing.map(a => a.symbol), day)
    const rows = prices.map(p => ({
      asset_id: missing.find(a => a.symbol === p.symbol)!.id, price_date: day, close: p.close, source: 'eod_api',
    }))
    if (rows.length) {
      const { error } = await sb.from('daily_prices')
        .upsert(rows, { onConflict: 'asset_id,price_date,market', ignoreDuplicates: true })
      if (error) throw error
    }
    console.log(`${provider.name}: ${day}: ${rows.length}/${missing.length} Kurse geholt`)
  }
}

await fetchMissingPrices()

const { data, error } = await sb.rpc('run_daily_settlement')
if (error) throw error
console.log(JSON.stringify(data, null, 2))
