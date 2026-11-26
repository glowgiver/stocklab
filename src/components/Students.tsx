import { useState } from 'react'
import { useApp } from '../app'
import { Button, Notice } from './ui'

interface Student { student_id: string; pseudonym: string }

/** Lehrkraft: Pseudonyme einer Klasse und „Neues Passwort“. Das Passwort wird nur einmal gezeigt. */
export default function Students({ classId }: { classId: string }) {
  const { backend, t, tError } = useApp()
  const [list, setList] = useState<Student[] | null>(null)
  const [result, setResult] = useState<{ pseudonym: string; password: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(open: boolean) {
    if (!open) { setResult(null); return }               // beim Zuklappen verschwindet das Passwort
    setError(null)
    try { setList(await backend.rpc<Student[]>('class_students', { p_class: classId })) } catch (e) { setError(tError(e)) }
  }
  async function reset(s: Student) {
    if (!confirm(t('confirmReset_pw', { name: s.pseudonym }))) return
    setError(null); setResult(null)
    try {
      const password = await backend.rpc<string>('teacher_reset_student_password', { p_student: s.student_id })
      setResult({ pseudonym: s.pseudonym, password })
    } catch (e) { setError(tError(e)) }
  }

  return (
    <details className="mt-1" onToggle={e => load((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium text-slate-600">{t('studentsPasswords')}</summary>
      <div className="mt-2 space-y-2">
        {result && (
          <Notice kind="ok">
            {t('tempPasswordFor', { name: result.pseudonym })}{' '}
            <code className="font-mono text-base font-bold" data-testid="temp-password">{result.password}</code>
            <span className="mt-1 block text-xs">{t('tempPasswordHint')}</span>
            <Button variant="ghost" onClick={() => setResult(null)}>{t('hide')}</Button>
          </Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        {list?.length === 0 && <p className="text-sm text-slate-600">{t('noStudentsYet')}</p>}
        <ul className="divide-y divide-slate-100">
          {list?.map(s => (
            <li key={s.student_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span>{s.pseudonym}</span>
              <Button variant="secondary" onClick={() => reset(s)}>{t('newPassword')}</Button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
