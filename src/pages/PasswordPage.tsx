import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app'
import { Button, Card, Input, Label, Notice } from '../components/ui'

/** Eigenes Passwort ändern (Schüler und Lehrkraft). Verlangt das bisherige Passwort. */
export default function PasswordPage() {
  const { backend, t, tError } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(ev: FormEvent) {
    ev.preventDefault(); setError(null); setDone(false); setBusy(true)
    try {
      if (next.length < 8) throw new Error('password too short, at least 8')
      await backend.changePassword(current, next)
      setDone(true); setCurrent(''); setNext('')
    } catch (e) { setError(tError(e)) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-md space-y-3">
      <Link to="/" className="text-sm font-medium text-teal-800">← {t('back')}</Link>
      <h1 className="text-xl font-bold">{t('changePassword')}</h1>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="pw-current">{t('currentPassword')}</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="pw-next" hint={t('passwordMin')}>{t('nextPassword')}</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required />
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          {done && <Notice kind="ok">{t('passwordChanged')}</Notice>}
          <Button type="submit" disabled={busy}>{t('changePassword')}</Button>
        </form>
      </Card>
    </div>
  )
}
