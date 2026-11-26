import { useEffect, useState, type FormEvent } from 'react'
import { useApp } from '../app'
import { Button, Card, Input, Label, Notice, Segmented } from '../components/ui'
import { isValidPseudonym, studentEmail } from '../lib/logic'
import { errorCode, type Credentials } from '../lib/backend'

export default function LoginPage() {
  const { backend, t, tError, refreshRole } = useApp()
  const [who, setWho] = useState<'student' | 'teacher'>('student')
  const [mode, setMode] = useState<'login' | 'join'>('login')
  const [classCode, setClassCode] = useState('')
  const [pseudonym, setPseudonym] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [demo, setDemo] = useState<{ teacher: Credentials; student: Credentials } | null>(null)

  useEffect(() => { backend.hint?.().then(h => { setHint(h?.teacherCode ?? null); setDemo(h?.demo ?? null) }) }, [backend])
  useEffect(() => { setError(null) }, [who, mode])

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); await refreshRole() } catch (e) { setError(tError(e)) } finally { setBusy(false) }
  }

  const submitStudent = (ev: FormEvent) => {
    ev.preventDefault()
    run(async () => {
      if (!isValidPseudonym(pseudonym)) throw new Error('invalid_pseudonym')
      const mail = studentEmail(classCode, pseudonym)
      if (mode === 'login') { await backend.signIn(mail, password); return }
      if (password.length < 8) throw new Error('password too short, at least 8')
      try { await backend.signUp(mail, password) }
      catch (e) {
        if (errorCode(e) !== 'user_exists') throw e
        await backend.signIn(mail, password)       // Konto aus früherem, abgebrochenem Versuch
      }
      try { await backend.rpc('join_class', { p_code: classCode, p_pseudonym: pseudonym }) }
      catch (e) { await backend.signOut(); throw e }
    })
  }

  const submitTeacher = (ev: FormEvent) => {
    ev.preventDefault()
    run(async () => {
      if (mode === 'login') { await backend.signIn(email, password); return }
      if (password.length < 8) throw new Error('password too short, at least 8')
      try { await backend.signUp(email, password) }
      catch (e) { if (errorCode(e) !== 'user_exists') throw e; await backend.signIn(email, password) }
      try { await backend.rpc('register_teacher', { p_code: inviteCode.trim() }) }
      catch (e) { await backend.signOut(); throw e }
    })
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('welcomeTitle')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('welcomeText')}</p>
      </div>

      {demo && (
        <Card>
          <p className="mb-3 text-sm font-medium text-slate-800">{t('demoLogin')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button disabled={busy} onClick={() => run(() => backend.signIn(demo.teacher.email, demo.teacher.password))}>{t('demoAsTeacher')}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => run(() => backend.signIn(demo.student.email, demo.student.password))}>{t('demoAsStudent')}</Button>
          </div>
        </Card>
      )}

      <Segmented label={t('whoAreYou')} value={who} onChange={setWho}
        options={[{ value: 'student', label: t('student') }, { value: 'teacher', label: t('teacher') }]} />

      <Card>
        <div className="mb-4">
          <Segmented label={t('loginOrJoin')} value={mode} onChange={setMode}
            options={who === 'student'
              ? [{ value: 'login', label: t('signIn') }, { value: 'join', label: t('joinClass') }]
              : [{ value: 'login', label: t('signIn') }, { value: 'join', label: t('registerTeacher') }]} />
        </div>

        {who === 'student' ? (
          <form onSubmit={submitStudent} className="space-y-3">
            <div>
              <Label htmlFor="classCode">{t('classCode')}</Label>
              <Input id="classCode" value={classCode} onChange={e => setClassCode(e.target.value)} autoCapitalize="characters" autoComplete="off" required />
            </div>
            <div>
              <Label htmlFor="pseudonym" hint={mode === 'join' ? t('pseudonymHint') : undefined}>{t('pseudonym')}</Label>
              <Input id="pseudonym" value={pseudonym} onChange={e => setPseudonym(e.target.value)} autoComplete="off" maxLength={24} required />
            </div>
            <div>
              <Label htmlFor="password" hint={mode === 'join' ? t('passwordHint') : undefined}>{t('password')}</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'join' ? 'new-password' : 'current-password'} required />
            </div>
            {error && <Notice kind="error">{error}</Notice>}
            <Button type="submit" disabled={busy} className="w-full">{mode === 'login' ? t('signIn') : t('joinClass')}</Button>
          </form>
        ) : (
          <form onSubmit={submitTeacher} className="space-y-3">
            <div>
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div>
              <Label htmlFor="tpassword">{t('password')}</Label>
              <Input id="tpassword" type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'join' ? 'new-password' : 'current-password'} required />
            </div>
            {mode === 'join' && (
              <div>
                <Label htmlFor="invite" hint={t('inviteHint')}>{t('inviteCode')}</Label>
                <Input id="invite" value={inviteCode} onChange={e => setInviteCode(e.target.value)} autoComplete="off" required />
                {hint && <p className="mt-1 text-xs text-slate-600">{t('localTeacherCode')}: <code className="font-mono font-semibold">{hint}</code></p>}
              </div>
            )}
            {error && <Notice kind="error">{error}</Notice>}
            <Button type="submit" disabled={busy} className="w-full">{mode === 'login' ? t('signIn') : t('registerTeacher')}</Button>
          </form>
        )}
      </Card>
      <p className="text-center text-xs text-slate-500">{t('simulatedNote')}</p>
    </div>
  )
}
