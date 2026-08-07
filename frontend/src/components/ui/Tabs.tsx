export interface TabItem {
  key: string
  label: string
}

export function Tabs({
  items,
  active,
  reachable,
  onChange,
}: {
  items: TabItem[]
  active: string
  reachable: Set<string>
  onChange: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-neutral-200 dark:border-neutral-800 pb-3 mb-6">
      {items.map((item) => {
        const isActive = item.key === active
        const canGo = reachable.has(item.key)
        return (
          <button
            key={item.key}
            type="button"
            disabled={!canGo}
            onClick={() => canGo && onChange(item.key)}
            className={[
              'px-3.5 py-2 rounded-full text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-rose-600 text-white shadow-sm'
                : canGo
                  ? 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 cursor-pointer'
                  : 'text-neutral-300 dark:text-neutral-700 cursor-not-allowed',
            ].join(' ')}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
