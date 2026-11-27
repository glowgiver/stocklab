import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '../app'
import { Badge, Button, Card, H2, Input, Label, Notice, Segmented, Select, Textarea } from '../components/ui'
import type { AssetInfo, HistoryItem, Overview } from '../lib/types'
import TipsCard from '../components/TipsCard'
import { formatDate, formatDateTime, money, percent } from '../lib/logic'

export default function StudentPage() {
  const { backend, t, tError } = useApp()
  const [ov, setOv] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'trade' | 'review'>('trade')

  const load = useCallback(async () => {
    try { setOv(await backend.rpc<Overview>('my_overview')) } catch (e) { setError(tError(e)) }
  }, [backend, tError])
  useEffect(() => { load() }, [load])

  if (error) return <Notice kind="error">{error}</Notice>
  if (!ov) return <p className="text-slate-600">…</p>
  if (!ov.member) return <Notice kind="warn">{t('notInClass')}</Notice>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t('hello', { name: ov.pseudonym ?? '' })}</h1>
        <p className="text-sm text-slate-600">{ov.class_name}</p>
      </div>

      {!ov.round ? (
        <Notice kind="info">{t('noRound')}</Notice>
      ) : (
        <>
          <Notice kind="info">{ov.round.data_mode === 'simulated' ? t('simulatedBanner') : t('realBanner')}</Notice>
          <Segmented label="view" value={tab} onChange={setTab}
            options={[{ value: 'trade', label: t('tabTrade') }, { value: 'review', label: t('tabReview') }]} />
          {tab === 'trade' ? <TradeView ov={ov} reload={load} /> : <ReviewView ov={ov} reload={load} />}
        </>
      )}
    </div>
  )
}

function describe(t: ReturnType<typeof useApp>['t'], d: { action: 'buy' | 'sell' | 'hold'; quantity: number | null }, asset?: AssetInfo) {
  return d.action === 'hold' ? t('hold') : `${d.action === 'buy' ? t('buy') : t('sell')} ${d.quantity} × ${asset?.symbol ?? ''}`
}

// ───────────────────────────── Handeln ─────────────────────────────

function TradeView({ ov, reload }: { ov: Overview; reload: () => Promise<void> }) {
  const { t, locale } = useApp()
  const assets = ov.assets
  const byId = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets])
  const holdingsValue = (ov.holdings ?? []).reduce((s, h) => s + h.quantity * (h.price ?? 0), 0)
  const total = (ov.cash ?? 0) + holdingsValue
  const start = ov.round!.starting_capital
  const change = start ? (total - start) / start : null

  const chart = useMemo(() => {
    const pts = (ov.snapshots ?? []).map(s => ({ date: s.date, total: s.total }))
    return pts.length ? pts : []
  }, [ov.snapshots])

  const waiting = (ov.history ?? []).filter(h => h.status === 'pending')

  return (
    <div className="space-y-4">
      {waiting.map(h => {
        const a = h.asset_id ? byId.get(h.asset_id) : undefined
        const open = ov.round!.status === 'active' && h.trading_date === ov.next_trading_date
        return (
          <Notice key={h.id} kind="warn">
            <div data-testid="pending-box">
              <strong>{t('pendingTitle', { what: describe(t, h, a) })}</strong>
              {h.action !== 'hold' && a?.price != null && <> · {t('pendingEstimate', { sum: money(h.quantity! * a.price, locale) })}</>}
              <span className="mt-1 block">
                {h.action === 'hold'
                  ? t('pendingHold', { date: formatDate(h.trading_date, locale) })
                  : t('pendingExplain', { date: formatDate(h.trading_date, locale) })}
              </span>
              <span className="mt-1 block">
                {open ? t('pendingOpen', { time: formatDateTime(ov.deadline, locale, ov.round!.timezone) }) : t('pendingClosed')}
              </span>
            </div>
          </Notice>
        )
      })}

      <Card>
        <H2>{t('yourPortfolio')}</H2>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <div className="text-3xl font-bold tabular-nums" data-testid="total-value">{money(total, locale)}</div>
            <div className="text-sm text-slate-600">{t('sinceStart', { pct: percent(change, locale) })}</div>
          </div>
          <div className="text-sm text-slate-700">
            <div>{t('cash')}: <span className="font-semibold tabular-nums" data-testid="cash">{money(ov.cash, locale)}</span></div>
            <div>{t('shares')}: <span className="font-semibold tabular-nums">{money(holdingsValue, locale)}</span></div>
          </div>
        </div>

        {chart.length > 0 && (
          <div className="mt-4 h-44" aria-label={t('chartLabel')} role="img">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={d => formatDate(d, locale)} tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={56} tickFormatter={v => Math.round(v).toLocaleString(locale)} />
                <Tooltip formatter={(v) => money(Number(v), locale)} labelFormatter={d => formatDate(String(d), locale)} />
                <ReferenceLine y={start} stroke="#94a3b8" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="total" stroke="#0f766e" strokeWidth={2} dot={chart.length < 12} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {(ov.holdings ?? []).length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-600">
              <th className="py-1 font-medium">{t('asset')}</th><th className="py-1 text-right font-medium">{t('qty')}</th>
              <th className="py-1 text-right font-medium">{t('value')}</th></tr></thead>
            <tbody>
              {ov.holdings!.map(h => {
                const a = byId.get(h.asset_id)
                return (
                  <tr key={h.asset_id} className="border-t border-slate-100">
                    <td className="py-1.5">{a?.symbol} <span className="text-slate-500">{a?.name}</span></td>
                    <td className="py-1.5 text-right tabular-nums">{h.quantity}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(h.quantity * (h.price ?? 0), locale)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <TipsCard roundId={ov.round!.id} canEdit={false} />

      {ov.round!.status === 'active' && ov.next_trading_date
        ? <DecisionForm ov={ov} assets={assets} reload={reload} />
        : <Notice kind="info">{ov.round!.status === 'ended' ? t('roundEnded') : t('noTradingDay')}</Notice>}
    </div>
  )
}

function DecisionForm({ ov, assets, reload }: { ov: Overview; assets: AssetInfo[]; reload: () => Promise<void> }) {
  const { backend, t, tError, locale } = useApp()
  const pending = ov.pending_decision
  const [action, setAction] = useState<'buy' | 'sell' | 'hold'>(pending?.action ?? 'buy')
  const [assetId, setAssetId] = useState<string>(pending?.asset_id ?? assets[0]?.id ?? '')
  const [qty, setQty] = useState<string>(pending?.quantity?.toString() ?? '1')
  const [expectation, setExpectation] = useState(pending?.expectation ?? '')
  const [reasoning, setReasoning] = useState(pending?.reasoning ?? '')
  const [evidence, setEvidence] = useState(pending?.evidence ?? '')
  const [risks, setRisks] = useState(pending?.risks ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const asset = assets.find(a => a.id === assetId)
  const owned = ov.holdings?.find(h => h.asset_id === assetId)?.quantity ?? 0
  const q = Number.parseInt(qty, 10)
  const estimate = asset?.price && Number.isFinite(q) ? q * asset.price : null
  const tooShort = [expectation, reasoning, evidence, risks].some(s => s.trim().length < 10)
  const changed = !!pending && (
    action !== pending.action
    || (action !== 'hold' && (assetId !== pending.asset_id || q !== pending.quantity))
    || expectation !== pending.expectation || reasoning !== pending.reasoning
    || evidence !== pending.evidence || risks !== pending.risks)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setBusy(true); setError(null); setSaved(null)
    try {
      const r = await backend.rpc<{ deadline: string }>('submit_decision', {
        p_round: ov.round!.id, p_action: action,
        p_asset: action === 'hold' ? null : assetId, p_quantity: action === 'hold' ? null : q,
        p_expectation: expectation, p_reasoning: reasoning, p_evidence: evidence, p_risks: risks,
      })
      setSaved(t('savedUntil', { time: formatDateTime(r.deadline, locale, ov.round!.timezone) }))
      await reload()
    } catch (e) { setError(tError(e)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <H2>{t('decisionFor', { date: formatDate(ov.next_trading_date, locale) })}</H2>
      <p className="mb-3 text-sm text-slate-600">
        {t('deadlineIs', { time: formatDateTime(ov.deadline, locale, ov.round!.timezone) })}
        {pending && <> <Badge tone="teal">{t('alreadySubmitted')}</Badge></>}
      </p>
      <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">{t('oneDecisionRule')}</p>
      <form onSubmit={submit} className="space-y-4">
        <Segmented label={t('action')} value={action} onChange={setAction}
          options={[{ value: 'buy', label: t('buy') }, { value: 'sell', label: t('sell') }, { value: 'hold', label: t('hold') }]} />

        {action !== 'hold' && (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div>
              <Label htmlFor="asset">{t('asset')}</Label>
              <Select id="asset" value={assetId} onChange={e => setAssetId(e.target.value)}>
                {assets.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.symbol} — {a.name} · {money(a.price, locale)}
                  </option>
                ))}
              </Select>
              {asset && (
                <p className="mt-1 text-xs text-slate-600">
                  {asset.description}
                  {asset.price && asset.prev_price ? <> · {t('lastDay')}: {percent(asset.price / asset.prev_price - 1, locale)}</> : null}
                  {action === 'sell' && <> · {t('youOwn', { n: owned })}</>}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="qty">{t('qty')}</Label>
              <Input id="qty" type="number" min={1} step={1} inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} />
              {estimate != null && action === 'buy' && <p className="mt-1 text-xs text-slate-600">≈ {money(estimate, locale)}</p>}
            </div>
          </div>
        )}
        {action !== 'hold' && <p className="text-xs text-slate-600">{t('closingPriceNote')}</p>}

        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-semibold text-slate-900">{t('journal')}</legend>
          <div>
            <Label htmlFor="exp">{t('qExpect')}</Label>
            <Textarea id="exp" value={expectation} onChange={e => setExpectation(e.target.value)} maxLength={1000} />
          </div>
          <div>
            <Label htmlFor="why">{t('qWhy')}</Label>
            <Textarea id="why" value={reasoning} onChange={e => setReasoning(e.target.value)} maxLength={1000} />
          </div>
          <div>
            <Label htmlFor="evi">{t('qEvidence')}</Label>
            <Textarea id="evi" value={evidence} onChange={e => setEvidence(e.target.value)} maxLength={1000} />
          </div>
          <div>
            <Label htmlFor="risk">{t('qRisk')}</Label>
            <Textarea id="risk" value={risks} onChange={e => setRisks(e.target.value)} maxLength={1000} />
          </div>
        </fieldset>

        {error && <Notice kind="error">{error}{pending && <span className="mt-1 block">{t('oldStays', { what: describe(t, pending, assets.find(a => a.id === pending.asset_id)) })}</span>}</Notice>}
        {saved && <Notice kind="ok">{saved}</Notice>}
        {changed && <p className="text-sm font-medium text-amber-900">{t('willReplace', { what: describe(t, pending, assets.find(a => a.id === pending.asset_id)) })}</p>}
        <Button type="submit" disabled={busy || tooShort || (action !== 'hold' && !(q > 0)) || (!!pending && !changed)} className="w-full sm:w-auto">
          {pending ? t('updateDecision') : t('submitDecision')}
        </Button>
        {tooShort && <p className="text-xs text-slate-600">{t('needAllFour')}</p>}
      </form>
    </Card>
  )
}

// ───────────────────────────── Rückblick ─────────────────────────────

function ReviewView({ ov, reload }: { ov: Overview; reload: () => Promise<void> }) {
  const { t } = useApp()
  const byId = useMemo(() => new Map(ov.assets.map(a => [a.id, a])), [ov.assets])
  const items = ov.history ?? []
  if (!items.length) return <Notice kind="info">{t('noHistory')}</Notice>
  return (
    <div className="space-y-3">
      <Notice kind="info">{t('profitNotQuality')}</Notice>
      {items.map(h => <HistoryCard key={h.id} h={h} asset={h.asset_id ? byId.get(h.asset_id) : undefined} reload={reload} />)}
    </div>
  )
}

function HistoryCard({ h, asset, reload }: { h: HistoryItem; asset?: AssetInfo; reload: () => Promise<void> }) {
  const { backend, t, tError, locale } = useApp()
  const [convincing, setConvincing] = useState('')
  const [overlooked, setOverlooked] = useState('')
  const [change, setChange] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const what = h.action === 'hold'
    ? t('hold')
    : `${h.action === 'buy' ? t('buy') : t('sell')} ${h.quantity} × ${asset?.symbol ?? ''}`
  const moved = h.price && asset?.price ? asset.price / h.price - 1 : null

  async function save(ev: FormEvent) {
    ev.preventDefault(); setBusy(true); setError(null)
    try {
      await backend.rpc('save_reflection', { p_decision: h.id, p_convincing: convincing, p_overlooked: overlooked, p_change: change })
      await reload()
    } catch (e) { setError(tError(e)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{formatDate(h.trading_date, locale)} · {what}</div>
        <div>
          {h.status === 'pending' && <Badge tone="amber">{t('pending')}</Badge>}
          {h.order_status === 'executed' && <Badge tone="teal">{t('executedAt', { price: money(h.price, locale) })}</Badge>}
          {h.order_status === 'rejected' && <Badge tone="red">{t('rejected')}: {t(`err_${h.reject_reason}` as never)}</Badge>}
          {h.status === 'settled' && h.action === 'hold' && <Badge>{t('heldNoTrade')}</Badge>}
        </div>
      </div>
      {moved != null && h.order_status === 'executed' && (
        <p className="mt-1 text-sm text-slate-700">{t('sinceThen', { pct: percent(moved, locale) })}</p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-medium text-teal-800">{t('myJournal')}</summary>
        <dl className="mt-2 space-y-2 text-sm">
          <div><dt className="font-medium">{t('qExpect')}</dt><dd className="text-slate-700">{h.expectation}</dd></div>
          <div><dt className="font-medium">{t('qWhy')}</dt><dd className="text-slate-700">{h.reasoning}</dd></div>
          <div><dt className="font-medium">{t('qEvidence')}</dt><dd className="text-slate-700">{h.evidence}</dd></div>
          <div><dt className="font-medium">{t('qRisk')}</dt><dd className="text-slate-700">{h.risks}</dd></div>
        </dl>
      </details>

      {h.feedback?.comment && (
        <div className="mt-3"><Notice kind="ok"><strong>{t('teacherFeedback')}:</strong> {h.feedback.comment}</Notice></div>
      )}

      {h.status === 'settled' && (h.reflection ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-teal-800">{t('myReflection')}</summary>
          <dl className="mt-2 space-y-2 text-sm">
            <div><dt className="font-medium">{t('rConvincing')}</dt><dd className="text-slate-700">{h.reflection.convincing}</dd></div>
            <div><dt className="font-medium">{t('rOverlooked')}</dt><dd className="text-slate-700">{h.reflection.overlooked}</dd></div>
            <div><dt className="font-medium">{t('rChange')}</dt><dd className="text-slate-700">{h.reflection.would_change}</dd></div>
          </dl>
        </details>
      ) : (
        <form onSubmit={save} className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <p className="text-sm font-semibold">{t('reflect')}</p>
          <div><Label htmlFor={`c-${h.id}`}>{t('rConvincing')}</Label><Textarea id={`c-${h.id}`} value={convincing} onChange={e => setConvincing(e.target.value)} /></div>
          <div><Label htmlFor={`o-${h.id}`}>{t('rOverlooked')}</Label><Textarea id={`o-${h.id}`} value={overlooked} onChange={e => setOverlooked(e.target.value)} /></div>
          <div><Label htmlFor={`w-${h.id}`}>{t('rChange')}</Label><Textarea id={`w-${h.id}`} value={change} onChange={e => setChange(e.target.value)} /></div>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" variant="secondary" disabled={busy || [convincing, overlooked, change].some(s => s.trim().length < 5)}>{t('saveReflection')}</Button>
        </form>
      ))}
    </Card>
  )
}
