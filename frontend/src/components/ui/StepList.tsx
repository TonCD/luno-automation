import type { ReactNode } from 'react'

export function StepList({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
          <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold mt-0.5">
            {i + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  )
}
