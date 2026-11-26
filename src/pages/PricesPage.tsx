import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../app'
import { Button, Card, H2, Input, Label, Notice, Textarea } from '../components/ui'
import type { PriceStatus } from '../lib/types'
import { formatDate, money, parsePriceLines } from '../lib/logic'
import { errorCode } from '../lib/backend'

// Echte Tagesschlusskurse eintragen (Lehrkraft). Quelle: selbst nachschlagen.
export default function PricesPage() {
  const { id } = useParams()
  const { backend, t, tError, locale } = useApp()
  const [st, setSt] = useState<PriceStatus | null>(null)
  const [date, setDate] = useState('')
  const [vals, setVals] = useState<Record<string, string>>({})
  const [paste, setPaste] = useState('')
  const [force, setForce] = useState(false)
  const [needForce, setNeedForce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await backend.rpc<PriceStatus>('teacher_price_status', { p_round: id })
      setSt(s); setDate(d => d || s.date)
    } catch (e) { setError(tError(e)) }
  }, [backend, id, tError])
  useEffect(() => { load() }, [load])

  function applyPaste(text: string) {
    setPaste(text)
    const parsed = parsePriceLines(text)
    setVals(v => ({ ...v, ...Object.fromEntries(Object.entries(parsed).map(([k, n]) => [k, String(n)])) }))
  }

  async function save() {
    setBusy(true); setError(null); setInfo(null)
    try {
      const prices: Record<string, number> = {}
      for (const [sym, raw] of Object.entries(vals)) {
        const n = Number(raw.replace(',', '.'))
        if (raw.trim() !== '' && Number.isFinite(n)) prices[sym] = n
      }
      const r = await backend.rpc<{ saved: number; missing: string[] }>('teacher_set_prices', { p_date: date, p_prices: prices, p_force: force })
      setNeedForce(false)
      setInfo(r.missing.length ? t('pricesSavedMissing', { n: r.saved, missing: r.missing.join(', ') }) : t('pricesSavedAll', { n: r.saved }))
      await load()
    } catch (e) {
      if (errorCode(e) === 'prices_implausible') setNeedForce(true)
      setError(tError(e))
    } finally { setBusy(false) }
  }

  async function settle() {
    setBusy(true); setError(null); setInfo(null)
    try {
      const r = await backend.rpc<{ date: string; result: string }[]>('teacher_settle_due', { p_round: id })
      setInfo(r.length ? r.map(x => `${formatDate(x.date, locale)}: ${x.result}`).join(' · ') : t('nothingDue'))
      await load()
    } catch (e) { setError(tError(e)) } finally { setBusy(false) }
  }

  if (!st) return error ? <Notice kind="error">{error}</Notice> : <p className="text-slate-600">…</p>
  const missing = new Set(st.missing)

  return (
    <div className="space-y-4">
      <Link to={`/teacher/round/${id}`} className="text-sm font-medium text-teal-800">← {t('back')}</Link>
      <h1 className="text-xl font-bold">{t('pricesTitle')}</h1>
      {st.data_mode !== 'external' && <Notice kind="info">{t('pricesOnlyReal')}</Notice>}
      <Notice kind="warn">{t('pricesLicenceNote')}</Notice>

      <Card>
        <H2>{t('pricesFor')}</H2>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div>
            <Label htmlFor="pdate">{t('tradingDay')}</Label>
            <Input id="pdate" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <p className="mt-1 text-xs text-slate-600">{t('nextToSettle', { date: formatDate(st.date, locale) })}</p>
          </div>
          <div>
            <Label htmlFor="ppaste" hint={t('pasteHint')}>{t('pasteLabel')}</Label>
            <Textarea id="ppaste" rows={3} value={paste} onChange={e => applyPaste(e.target.value)} placeholder={'AAPL 193.09\nMSFT 421,50'} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {st.symbols.map(s => (
            <div key={s.symbol}>
              <Label htmlFor={`p-${s.symbol}`}>
                {s.symbol} <span className="font-normal text-slate-600">{s.name}{s.last != null ? ` · ${t('lastClose')} ${money(s.last, locale)}` : ''}</span>
              </Label>
              <Input id={`p-${s.symbol}`} inputMode="decimal" value={vals[s.symbol] ?? ''} aria-invalid={date === st.date && missing.has(s.symbol)}
                onChange={e => setVals({ ...vals, [s.symbol]: e.target.value })} />
            </div>
          ))}
        </div>

        {needForce && (
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="size-5 accent-teal-700" />
            {t('forceSave')}
          </label>
        )}
        {error && <div className="mt-3"><Notice kind="error">{error}</Notice></div>}
        {info && <div className="mt-3"><Notice kind="ok">{info}</Notice></div>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy || !date}>{t('savePrices')}</Button>
          <Button variant="secondary" onClick={settle} disabled={busy || st.status !== 'active'}>{t('settleNow')}</Button>
        </div>
        {!st.closed && <p className="mt-2 text-xs text-slate-600">{t('notClosedYet')}</p>}
      </Card>
    </div>
  )
}
