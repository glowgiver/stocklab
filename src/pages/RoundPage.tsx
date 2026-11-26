import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../app'
import { Badge, Button, Card, H2, Label, Notice, Select, Textarea } from '../components/ui'
import type { PriceStatus, RoundDetail, TeacherDecision } from '../lib/types'
import TipsCard from '../components/TipsCard'
import { formatDate, money, toCsv, weightedPercent } from '../lib/logic'

export default function RoundPage() {
  const { id } = useParams()
  const { backend, t, tError, locale } = useApp()
  const [d, setD] = useState<RoundDetail | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [ps, setPs] = useState<PriceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setD(await backend.rpc<RoundDetail>('teacher_round_detail', { p_round: id }))
      const classes = await backend.rpc<{ rounds: { id: string; is_demo: boolean }[] }[]>('teacher_overview')
      setIsDemo(classes.some(c => c.rounds.some(r => r.id === id && r.is_demo)))
      setPs(await backend.rpc<PriceStatus>('teacher_price_status', { p_round: id }))
    } catch (e) { setError(tError(e)) }
  }, [backend, id, tError])
  useEffect(() => { load() }, [load])

  async function demoAdvance() {
    setError(null); setInfo(null)
    try {
      const r = await backend.rpc<{ date: string; result: string }>('demo_settle_next_day', { p_round: id })
      setInfo(t('advanced', { date: formatDate(r.date, locale), result: r.result }))
      await load()
    } catch (e) { setError(tError(e)) }
  }
  async function demoReset() {
    if (!confirm(t('confirmReset'))) return
    setError(null)
    try { await backend.rpc('reset_demo_round', { p_round: id }); window.location.hash = '#/teacher' } catch (e) { setError(tError(e)) }
  }

  function exportCsv() {
    if (!d) return
    const rows = d.decisions.map(x => ({
      date: x.trading_date, pseudonym: x.pseudonym, action: x.action, symbol: x.symbol ?? '', quantity: x.quantity ?? '',
      result: x.order_status ?? x.status, price: x.price ?? '',
      expectation: x.expectation, reasoning: x.reasoning, evidence: x.evidence, risks: x.risks,
      reflection_convincing: x.reflection?.convincing ?? '', reflection_overlooked: x.reflection?.overlooked ?? '', reflection_change: x.reflection?.would_change ?? '',
      score_reasoning: x.feedback?.score_reasoning ?? '', score_evidence: x.feedback?.score_evidence ?? '',
      score_risk: x.feedback?.score_risk ?? '', score_reflection: x.feedback?.score_reflection ?? '',
      feedback: x.feedback?.comment ?? '',
    }))
    const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'stocklab-decisions.csv'; a.click()
    URL.revokeObjectURL(a.href)
  }

  if (error && !d) return <Notice kind="error">{error}</Notice>
  if (!d) return <p className="text-slate-600">…</p>
  const missing = d.students.filter(s => !s.submitted_today)
  const cn = d.counts_next ?? { buy: 0, sell: 0, hold: 0 }

  return (
    <div className="space-y-4">
      <Link to="/teacher" className="text-sm font-medium text-teal-800">← {t('back')}</Link>
      {error && <Notice kind="error">{error}</Notice>}
      {info && <Notice kind="ok">{info}</Notice>}

      <Card>
        <H2>{t('wallTitle', { date: formatDate(d.next_trading_date, locale) })}</H2>
        <div className="grid grid-cols-3 gap-3 text-center" data-testid="counts">
          {([['buy', cn.buy, 'text-emerald-700'], ['sell', cn.sell, 'text-red-700'], ['hold', cn.hold, 'text-slate-700']] as const).map(([k, n, c]) => (
            <div key={k} className="rounded-lg bg-slate-50 py-4">
              <div className={`text-4xl font-bold tabular-nums ${c}`} data-testid={`count-${k}`}>{n}</div>
              <div className="text-sm text-slate-600">{t(k)}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-600">{t('wallNote')}</p>
        {d.counts_last?.date && (
          <p className="mt-1 text-sm text-slate-700">
            {t('lastDay')} ({formatDate(d.counts_last.date, locale)}): {t('buy')} {d.counts_last.buy} · {t('sell')} {d.counts_last.sell} · {t('hold')} {d.counts_last.hold}
          </p>
        )}
      </Card>

      {ps?.data_mode === 'external' && (
        <Card>
          <H2>{t('pricesTitle')}</H2>
          <p className="text-sm text-slate-700">
            {ps.status !== 'active' ? t('roundNotRunning')
              : ps.missing.length === 0 ? t('pricesComplete', { date: formatDate(ps.date, locale) })
              : t('pricesMissing', { date: formatDate(ps.date, locale), n: ps.missing.length })}
          </p>
          <div className="mt-3">
            <Link to={`/teacher/round/${id}/prices`} className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">{t('enterPrices')}</Link>
          </div>
        </Card>
      )}

      <Card>
        <H2>{t('missingTitle')} ({missing.length})</H2>
        {missing.length === 0
          ? <p className="text-sm text-emerald-800">{t('allSubmitted')}</p>
          : <p className="text-sm text-slate-800" data-testid="missing">{missing.map(s => s.pseudonym).join(', ')}</p>}
      </Card>

      <Card>
        <H2>{t('portfolios')}</H2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-600">
            <th className="py-1 font-medium">{t('pseudonym')}</th>
            <th className="py-1 text-right font-medium">{t('cash')}</th>
            <th className="py-1 text-right font-medium">{t('totalValue')}</th>
          </tr></thead>
          <tbody>
            {d.students.map(s => (
              <tr key={s.student_id} className="border-t border-slate-100">
                <td className="py-1.5">{s.pseudonym}</td>
                <td className="py-1.5 text-right tabular-nums">{money(s.cash, locale)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(s.total ?? s.cash, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-600">{t('noRanking')}</p>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('decisionsTitle')} ({d.decisions.length})</h2>
        <Button variant="secondary" onClick={exportCsv} disabled={!d.decisions.length}>{t('exportCsv')}</Button>
      </div>
      {d.decisions.map(x => <DecisionRow key={x.id} x={x} reload={load} />)}

      <TipsCard roundId={id!} canEdit />

      {isDemo && (
        <Card>
          <H2>{t('demoTools')}</H2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={demoAdvance}>{t('advanceDay')}</Button>
            <Button variant="danger" onClick={demoReset}>{t('resetDemo')}</Button>
          </div>
          <p className="mt-2 text-xs text-slate-600">{t('demoNote')}</p>
        </Card>
      )}
    </div>
  )
}

const SCALE = [0, 1, 2, 3, 4]

function DecisionRow({ x, reload }: { x: TeacherDecision; reload: () => Promise<void> }) {
  const { backend, t, tError, locale } = useApp()
  const f = x.feedback
  const [comment, setComment] = useState(f?.comment ?? '')
  const [s, setS] = useState<Record<string, number | null>>({
    reasoning: f?.score_reasoning ?? null, evidence: f?.score_evidence ?? null,
    risk: f?.score_risk ?? null, reflection: f?.score_reflection ?? null,
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const pct = weightedPercent(s)

  async function save() {
    setError(null); setSaved(false)
    try {
      await backend.rpc('save_feedback', {
        p_decision: x.id, p_comment: comment || null,
        p_reasoning: s.reasoning, p_evidence: s.evidence, p_risk: s.risk, p_reflection: s.reflection,
      })
      setSaved(true); await reload()
    } catch (e) { setError(tError(e)) }
  }

  const what = x.action === 'hold' ? t('hold') : `${x.action === 'buy' ? t('buy') : t('sell')} ${x.quantity} × ${x.symbol}`
  const crit: [string, string][] = [['reasoning', t('critReasoning')], ['evidence', t('critEvidence')], ['risk', t('critRisk')], ['reflection', t('critReflection')]]

  return (
    <Card>
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{x.pseudonym}</span>
          <span className="text-slate-600">{formatDate(x.trading_date, locale)} · {what}</span>
          {x.order_status === 'executed' && <Badge tone="teal">{money(x.price, locale)}</Badge>}
          {x.order_status === 'rejected' && <Badge tone="red">{t('rejected')}</Badge>}
          {x.status === 'pending' && <Badge tone="amber">{t('pending')}</Badge>}
          {f && <Badge tone="teal">{t('rated')}</Badge>}
        </summary>
        <dl className="mt-3 space-y-2 text-sm">
          <div><dt className="font-medium">{t('qExpect')}</dt><dd className="text-slate-700">{x.expectation}</dd></div>
          <div><dt className="font-medium">{t('qWhy')}</dt><dd className="text-slate-700">{x.reasoning}</dd></div>
          <div><dt className="font-medium">{t('qEvidence')}</dt><dd className="text-slate-700">{x.evidence}</dd></div>
          <div><dt className="font-medium">{t('qRisk')}</dt><dd className="text-slate-700">{x.risks}</dd></div>
          {x.reflection && (
            <div className="rounded-lg bg-slate-50 p-2">
              <dt className="font-medium">{t('myReflection')}</dt>
              <dd className="text-slate-700">{x.reflection.convincing} · {x.reflection.overlooked} · {x.reflection.would_change}</dd>
            </div>
          )}
        </dl>

        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-600">{t('feedbackNote')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {crit.map(([k, label]) => (
              <div key={k}>
                <Label htmlFor={`${x.id}-${k}`}>{label}</Label>
                <Select id={`${x.id}-${k}`} value={s[k] ?? ''} onChange={e => setS({ ...s, [k]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">–</option>
                  {SCALE.map(n => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
            ))}
          </div>
          {pct != null && <p className="text-sm text-slate-700">{t('helperValue', { pct })}</p>}
          <div>
            <Label htmlFor={`${x.id}-c`}>{t('feedbackComment')}</Label>
            <Textarea id={`${x.id}-c`} rows={2} maxLength={500} value={comment} onChange={e => setComment(e.target.value)} />
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          <Button variant="secondary" onClick={save}>{t('saveFeedback')}</Button>
          {saved && <span className="ml-2 text-sm text-emerald-700">{t('saved')}</span>}
        </div>
      </details>
    </Card>
  )
}
