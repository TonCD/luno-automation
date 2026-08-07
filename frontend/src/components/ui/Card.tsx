import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm p-6 md:p-8 ${className}`}
    >
      {children}
    </section>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
      {children}
    </h2>
  )
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{children}</p>
}
