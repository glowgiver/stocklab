import { useState, type FormEvent } from 'react'
import { useApp } from '../app'
import { Button, Input, Label, Notice } from './ui'
import type { TeacherRound } from '../lib/types'

type Act = (fn: () => Promise<unknown>) => Promise<void>

export function RenameForm({ id, current, label, onSave }:
  { id: string; current: string; label: string; onSave: (name: string) => Promise<void> }) {
  const { t } = useApp()
  const [name, setName] = useState(current)
  const submit = (ev: FormEvent) => { ev.preventDefault(); onSave(name) }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor={id}>{label}</Label>
        <Input id={id} value={name} onChange={e => setName(e.target.value)} maxLength={80} required />
      </div>
      <Button type="submit" variant="secondary" disabled={!name.trim() || name.trim() === current}>{t('rename')}</Button>
    </form>
  )
}

/** Aufklappbereich „Verwalten“ je Runde: umbenennen und löschen. */
export function ManageRound({ r, act }: { r: TeacherRound; act: Act }) {
  const { backend, t } = useApp()
  const [typed, setTyped] = useState('')
  const easy = r.status === 'draft' || r.is_demo
  const del = (confirmName: string | null) =>
    act(() => backend.rpc('delete_round', { p_round: r.id, p_confirm: confirmName }))

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-sm font-medium text-slate-600">{t('manage')}</summary>
      <div className="mt-3 space-y-4 rounded-lg bg-slate-50 p-3">
        <RenameForm id={`ren-${r.id}`} current={r.name} label={t('newRoundName')}
          onSave={name => act(() => backend.rpc('rename_round', { p_round: r.id, p_name: name }))} />
        {easy ? (
          <Button variant="danger" onClick={() => { if (confirm(t('confirmDelete', { name: r.name }))) del(null) }}>{t('deleteRound')}</Button>
        ) : r.status === 'ended' ? (
          <div className="space-y-2">
            <Notice kind="warn">{t('deleteWarning')}</Notice>
            <Label htmlFor={`del-${r.id}`}>{t('typeNameToDelete', { name: r.name })}</Label>
            <Input id={`del-${r.id}`} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
            <Button variant="danger" disabled={typed.trim() !== r.name} onClick={() => del(typed)}>{t('deleteRoundForever')}</Button>
          </div>
        ) : (
          <p className="text-sm text-slate-600">{t('deleteRunningHint')}</p>
        )}
      </div>
    </details>
  )
}
