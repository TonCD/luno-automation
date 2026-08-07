import type { LabelHTMLAttributes, ReactNode } from 'react'

export const inputClass =
  'w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none transition-colors focus:border-rose-500 focus:ring-2 focus:ring-rose-100 dark:focus:ring-rose-950 mt-1'

export function Label({
  children,
  className = '',
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label
      className={`block text-sm font-medium text-neutral-700 dark:text-neutral-300 ${className}`}
      {...props}
    >
      {children}
    </label>
  )
}
