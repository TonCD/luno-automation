import type { ReactNode } from 'react'

type Tone = 'info' | 'success' | 'warning' | 'danger'

const TONE_STYLES: Record<Tone, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-200',
  success:
    'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200',
  warning:
    'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200',
  danger:
    'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200',
}

const TONE_ICON: Record<Tone, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  danger: '❌',
}

export function Callout({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex gap-2.5 items-start rounded-xl border px-4 py-3 text-sm leading-relaxed ${TONE_STYLES[tone]} ${className}`}
    >
      <span className="shrink-0">{TONE_ICON[tone]}</span>
      <div>{children}</div>
    </div>
  )
}
