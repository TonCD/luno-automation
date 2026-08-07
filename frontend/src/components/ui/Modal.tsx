import type { ReactNode } from 'react'

// Popup dùng chung cho các hướng dẫn/ghi chú phụ (vd "Cách lấy ID sản phẩm",
// "Về nhạc nền") - tách khỏi luồng chính để không chiếm diện tích cố định
// trên màn hình, chỉ hiện khi user chủ động bấm xem.
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-neutral-900 rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="text-sm text-neutral-600 dark:text-neutral-400">{children}</div>
      </div>
    </div>
  )
}

// Nút nhỏ mở Modal hướng dẫn - dùng cạnh label/field thay vì nhét cả khối
// StepList/Callout cố định vào giữa màn hình chính.
export function GuideButton({ onClick, label = 'Hướng dẫn' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
    >
      <span aria-hidden>ℹ️</span>
      {label}
    </button>
  )
}
