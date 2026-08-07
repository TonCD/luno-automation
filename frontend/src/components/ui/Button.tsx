import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const VARIANT_STYLES: Record<Variant, string> = {
  primary:
    'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 disabled:bg-neutral-300 disabled:text-neutral-500',
  secondary:
    'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 active:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-40',
  ghost:
    'bg-transparent text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 disabled:opacity-40',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed ${VARIANT_STYLES[variant]} ${className}`}
      {...props}
    />
  )
}
