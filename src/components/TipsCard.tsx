import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useApp } from '../app'
import { Button, Card, H2, Input, Label, Notice } from './ui'
import type { ReadingTip } from '../lib/types'

// Lesetipps: nur Überschrift + Quelle + Link zur Originalseite. Es wird nie Artikeltext kopiert.
export default function TipsCard({ roundId, canEdit }: { roundId: string; canEdit: boolean }) {
  const { backend, t, tError } = useApp()
  const [tips, setTips] = useState<ReadingTip[] | null>(null)
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setTips(await backend.rpc<ReadingTip[]>('list_reading_tips', { p_round: roundId })) } catch (e) { setError(tError(e)) }
  }, [backend, roundId, tError])
  useEffect(() => { load() }, [load])

  async function add(ev: FormEvent) {
    ev.preventDefault(); setError(null)
    try {
      await backend.rpc('add_reading_tip', { p_round: roundId, p_title: title, p_source: source, p_url: url })
      setTitle(''); setSource(''); setUrl(''); await load()
    } catch (e) { setError(tError(e)) }
  }
  async function remove(id: string) {
    setError(null)
    try { await backend.rpc('delete_reading_tip', { p_tip: id }); await load() } catch (e) { setError(tError(e)) }
  }

  if (!canEdit && (!tips || tips.length === 0)) return null
  return (
    <Card>
      <H2>{t('tipsTitle')}</H2>
      {!canEdit && <p className="mb-2 text-xs text-slate-600">{t('tipsHintStudent')}</p>}
      {tips?.length === 0 && <p className="text-sm text-slate-600">{t('noTips')}</p>}
      <ul className="divide-y divide-slate-100">
        {tips?.map(x => (
          <li key={x.id} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div>
              <a href={x.url} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-800 underline underline-offset-2">{x.title}</a>
              {x.source && <span className="ml-2 text-slate-600">· {x.source}</span>}
            </div>
            {canEdit && <Button variant="ghost" onClick={() => remove(x.id)} aria-label={t('removeTip')}>✕</Button>}
          </li>
        ))}
      </ul>
      {error && <div className="mt-2"><Notice kind="error">{error}</Notice></div>}
      {canEdit && (
        <form onSubmit={add} className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor={`tt-${roundId}`}>{t('tipTitle')}</Label>
            <Input id={`tt-${roundId}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required />
          </div>
          <div>
            <Label htmlFor={`ts-${roundId}`}>{t('tipSource')}</Label>
            <Input id={`ts-${roundId}`} value={source} onChange={e => setSource(e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label htmlFor={`tu-${roundId}`}>{t('tipUrl')}</Label>
            <Input id={`tu-${roundId}`} type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} required />
          </div>
          <div className="sm:col-span-2"><Button type="submit" variant="secondary">{t('addTip')}</Button></div>
          <p className="text-xs text-slate-600 sm:col-span-2">{t('tipsHintTeacher')}</p>
        </form>
      )}
    </Card>
  )
}
