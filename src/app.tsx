import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { getBackend, errorCode, type Backend } from './lib/backend'
import { dict, type Lang, type Key } from './lib/i18n'
import { Button, Notice } from './components/ui'
import LoginPage from './pages/LoginPage'
import StudentPage from './pages/StudentPage'
import TeacherPage from './pages/TeacherPage'
import RoundPage from './pages/RoundPage'
import PricesPage from './pages/PricesPage'
import PasswordPage from './pages/PasswordPage'

type Role = 'student' | 'teacher' | null

interface Ctx {
  backend: Backend
  role: Role
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: Key, vars?: Record<string, string | number>) => string
  tError: (e: unknown) => string
  refreshRole: () => Promise<Role>
  signOut: () => Promise<void>
  locale: string
}

const AppCtx = createContext<Ctx | null>(null)
export const useApp = () => {
  const c = useContext(AppCtx)
  if (!c) throw new Error('no app context')
  return c
}

function Shell({ children }: { children: ReactNode }) {
  const { lang, setLang, role, signOut, t, backend } = useApp()
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between gap-2 py-4">
        <a href="#/" className="text-lg font-bold tracking-tight text-teal-800">StockLab</a>
        <div className="flex items-center gap-2">
          <button className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            aria-label={lang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
            onClick={() => setLang(lang === 'de' ? 'en' : 'de')}>{lang === 'de' ? 'EN' : 'DE'}</button>
          {role && <a href="#/password" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">{t('passwordLink')}</a>}
          {role && <Button variant="ghost" onClick={signOut}>{t('logout')}</Button>}
        </div>
      </header>
      {backend.mode === 'local' && <div className="mb-3"><Notice kind="warn">{t('localModeBanner')}</Notice></div>}
      <main>{children}</main>
    </div>
  )
}

function Home() {
  const { role } = useApp()
  if (role === 'student') return <Navigate to="/student" replace />
  if (role === 'teacher') return <Navigate to="/teacher" replace />
  return <LoginPage />
}

function Guard({ need, children }: { need: Role; children: ReactNode }) {
  const { role } = useApp()
  if (role !== need) return <Navigate to="/" replace />
  return <>{children}</>
}

function Inner({ backend }: { backend: Backend }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try { return (localStorage.getItem('stocklab_lang') as Lang) || (navigator.language.startsWith('de') ? 'de' : 'en') } catch { return 'de' }
  })
  const [role, setRole] = useState<Role>(null)
  const [ready, setReady] = useState(false)
  const nav = useNavigate()

  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem('stocklab_lang', l) } catch { /* ok */ } }
  const t = useCallback((k: Key, vars?: Record<string, string | number>) => {
    let s: string = dict[lang][k] ?? dict.de[k] ?? k
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, String(b))
    return s
  }, [lang])
  const tError = useCallback((e: unknown) => {
    const code = errorCode(e)
    const key = `err_${code}` as Key
    return dict[lang][key] ?? dict[lang].err_unknown
  }, [lang])

  const refreshRole = useCallback(async (): Promise<Role> => {
    const uid = await backend.getUserId()
    if (!uid) { setRole(null); return null }
    try {
      const w = await backend.rpc<{ role: Role }>('whoami')
      setRole(w.role ?? null)
      return w.role ?? null
    } catch { setRole(null); return null }
  }, [backend])

  useEffect(() => { refreshRole().finally(() => setReady(true)) }, [refreshRole])
  useEffect(() => { document.documentElement.lang = lang }, [lang])

  const signOut = useCallback(async () => { await backend.signOut(); setRole(null); nav('/') }, [backend, nav])
  const value = useMemo<Ctx>(() => ({
    backend, role, lang, setLang, t, tError, refreshRole, signOut, locale: lang === 'de' ? 'de-DE' : 'en-US',
  }), [backend, role, lang, t, tError, refreshRole, signOut])

  if (!ready) return <p className="p-6 text-slate-600">…</p>
  return (
    <AppCtx.Provider value={value}>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/student" element={<Guard need="student"><StudentPage /></Guard>} />
          <Route path="/teacher" element={<Guard need="teacher"><TeacherPage /></Guard>} />
          <Route path="/teacher/round/:id" element={<Guard need="teacher"><RoundPage /></Guard>} />
          <Route path="/teacher/round/:id/prices" element={<Guard need="teacher"><PricesPage /></Guard>} />
          <Route path="/password" element={role ? <PasswordPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AppCtx.Provider>
  )
}

export default function App() {
  const [backend, setBackend] = useState<Backend | null | undefined>(undefined)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => { getBackend().then(setBackend).catch(e => setFailed(String(e?.message ?? e))) }, [])

  if (failed) return <div className="p-6"><Notice kind="error">{failed}</Notice></div>
  if (backend === undefined) {
    return (
      <p className="p-6 text-slate-600">
        {import.meta.env.VITE_BACKEND === 'local'
          ? 'Demo-Datenbank wird eingerichtet — beim ersten Start dauert das etwa 15 Sekunden … / Setting up the demo database (about 15 s, first start only) …'
          : 'Loading…'}
      </p>
    )
  }
  if (backend === null) {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-6">
        <h1 className="text-xl font-bold text-teal-800">StockLab</h1>
        <Notice kind="warn">
          Kein Backend konfiguriert / No backend configured.<br />
          Lokal ausprobieren: <code>npm run dev:local</code> · Echter Betrieb: <code>.env</code> mit
          VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY (siehe README).
        </Notice>
      </div>
    )
  }
  return <HashRouter><Inner backend={backend} /></HashRouter>
}
