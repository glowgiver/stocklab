import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app'
import { Badge, Button, Card, H2, Input, Label, Notice, Segmented } from '../components/ui'
import type { TeacherClass, TeacherRound } from '../lib/types'
import { formatDateTime } from '../lib/logic'

export default function TeacherPage() {
  const { backend, t, tError } = useApp()
  const [classes, setClasses] = useState<TeacherClass[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')

  const load = useCallback(async () => {
    try { setClasses(await backend.rpc<TeacherClass[]>('teacher_overview')) } catch (e) { setError(tError(e)) }
  }, [backend, tError])
  useEffect(() => { load() }, [load])

  async function createClass(ev: FormEvent) {
    ev.preventDefault(); setError(null)
    try { await backend.rpc('create_class', { p_name: name }); setName(''); await load() } catch (e) { setError(tError(e)) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('yourClasses')}</h1>
      {error && <Notice kind="error">{error}</Notice>}
      {classes?.length === 0 && <Notice kind="info">{t('noClassesYet')}</Notice>}
      {classes?.map(c => <ClassCard key={c.id} c={c} reload={load} />)}
      <Card>
        <form onSubmit={createClass} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="cname">{t('newClass')}</Label>
            <Input id="cname" value={name} onChange={e => setName(e.target.value)} placeholder="Economics S1" maxLength={80} required />
          </div>
          <Button type="submit">{t('createClass')}</Button>
        </form>
      </Card>
    </div>
  )
}

function ClassCard({ c, reload }: { c: TeacherClass; reload: () => Promise<void> }) {
  const { backend, t, tError } = useApp()
  const [rname, setRname] = useState('')
  const [capital, setCapital] = useState('10000')
  const [deadline, setDeadline] = useState('15:00')
  const [demo, setDemo] = useState(false)
  const [mode, setMode] = useState<'simulated' | 'external'>('simulated')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn(); await reload() } catch (e) { setError(tError(e)) }
  }
  const createRound = (ev: FormEvent) => {
    ev.preventDefault()
    act(async () => {
      await backend.rpc('create_round', { p_class: c.id, p_name: rname, p_capital: Number(capital), p_deadline: deadline, p_is_demo: mode === 'simulated' && demo, p_data_mode: mode })
      setRname('')
    })
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(c.join_code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ok */ }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <H2>{c.name}</H2>
          <p className="text-sm text-slate-600">{t('members', { n: c.member_count })}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-600">{t('classCode')}</div>
          <button onClick={copy} className="min-h-11 rounded-lg bg-slate-100 px-3 font-mono text-xl font-bold tracking-widest text-slate-900 hover:bg-slate-200"
            aria-label={t('copyCode')} data-testid="join-code">{c.join_code}</button>
          <div className="h-4 text-xs text-teal-700">{copied ? t('copied') : ''}</div>
        </div>
      </div>

      <ul className="mt-2 divide-y divide-slate-100">
        {c.rounds.map(r => <RoundRow key={r.id} r={r} act={act} />)}
      </ul>

      {error && <div className="mt-2"><Notice kind="error">{error}</Notice></div>}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-teal-800">{t('newRound')}</summary>
        <form onSubmit={createRound} className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Label htmlFor={`rn-${c.id}`}>{t('roundName')}</Label>
            <Input id={`rn-${c.id}`} value={rname} onChange={e => setRname(e.target.value)} required maxLength={80} />
          </div>
          <div>
            <Label htmlFor={`cap-${c.id}`}>{t('startCapital')}</Label>
            <Input id={`cap-${c.id}`} type="number" min={100} step={100} value={capital} onChange={e => setCapital(e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`dl-${c.id}`} hint={t('deadlineHint')}>{t('deadlineTime')}</Label>
            <Input id={`dl-${c.id}`} type="time" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>
          <div className="sm:col-span-3">
            <Label hint={mode === 'external' ? t('realModeHint') : t('simModeHint')}>{t('priceSource')}</Label>
            <Segmented label={t('priceSource')} value={mode} onChange={setMode}
              options={[{ value: 'simulated', label: t('modeSimulated') }, { value: 'external', label: t('modeReal') }]} />
          </div>
          {mode === 'simulated' && (
            <label className="flex min-h-11 items-center gap-2 self-end text-sm sm:col-span-3">
              <input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} className="size-5 accent-teal-700" />
              {t('demoRound')}
            </label>
          )}
          <div className="sm:col-span-3"><Button type="submit">{t('createRound')}</Button></div>
        </form>
      </details>
    </Card>
  )
}

function RoundRow({ r, act }: { r: TeacherRound; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { backend, t, locale } = useApp()
  const tone = r.status === 'active' ? 'teal' : r.status === 'ended' ? 'slate' : 'amber'
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div>
        <div className="font-medium">{r.name} {r.is_demo && <Badge tone="amber">{t('demo')}</Badge>} <Badge tone={tone}>{t(`status_${r.status}` as never)}</Badge> {r.data_mode === 'external' && <Badge tone="teal">{t('modeReal')}</Badge>}</div>
        {r.status === 'active' && (
          <div className="text-xs text-slate-600">
            {t('nextDeadline')}: {formatDateTime(r.deadline, locale)} · {t('settledDays', { n: r.settled_days })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {r.status === 'draft' && r.data_mode === 'external' && <Link to={`/teacher/round/${r.id}/prices`} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50">{t('enterStartPrices')}</Link>}
        {r.status === 'draft' && <Button onClick={() => act(() => backend.rpc('start_round', { p_round: r.id }))}>{t('startRound')}</Button>}
        {r.status === 'active' && <Button variant="secondary" onClick={() => { if (confirm(t('confirmEnd'))) act(() => backend.rpc('end_round', { p_round: r.id })) }}>{t('endRound')}</Button>}
        {r.status !== 'draft' && <Link to={`/teacher/round/${r.id}`} className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">{t('open')}</Link>}
      </div>
    </li>
  )
}
