import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

// Kleine, eigene Bausteine im Stil von shadcn/ui (ruhig, hoher Kontrast, große Touch-Flächen).
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

export function Button({ variant = 'primary', className, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-300 disabled:text-slate-500',
    secondary: 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-700 hover:bg-slate-100',
    danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50',
  }[variant]
  return <button {...p} className={cx('min-h-11 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed', styles, className)} />
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}>{children}</section>
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-base font-semibold text-slate-900">{children}</h2>
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-800">
      {children}
      {hint && <span className="mt-0.5 block text-xs font-normal text-slate-600">{hint}</span>}
    </label>
  )
}

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-teal-700'
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, 'min-h-11', p.className)} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx(field, p.className)} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, 'min-h-11', p.className)} />

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'warn' | 'ok'; children: ReactNode }) {
  const s = {
    info: 'bg-sky-50 border-sky-200 text-sky-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    warn: 'bg-amber-50 border-amber-300 text-amber-900',
    ok: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  }[kind]
  return <div role={kind === 'error' ? 'alert' : 'status'} className={cx('rounded-lg border px-3 py-2 text-sm', s)}>{children}</div>
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'teal' | 'amber' | 'red' }) {
  const s = { slate: 'bg-slate-100 text-slate-700', teal: 'bg-teal-50 text-teal-800', amber: 'bg-amber-100 text-amber-900', red: 'bg-red-50 text-red-800' }[tone]
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium', s)}>{children}</span>
}

export function Segmented<T extends string>({ value, onChange, options, label }:
  { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-slate-100 p-1">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('min-h-10 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-teal-700',
            value === o.value ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
