// Icon túi mua sắm đơn giản màu cam, gợi nhớ Shopee qua MÀU SẮC chứ KHÔNG
// dùng logo thật của Shopee (tránh vấn đề bản quyền/thương hiệu) - cùng tinh
// thần với TikTokIcon.tsx.
export function ShopeeIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M14 16h20l2 24a4 4 0 0 1-4 4.4H16a4 4 0 0 1-4-4.4l2-24Z"
        fill="#EE4D2D"
      />
      <path
        d="M18 16v-2a6 6 0 1 1 12 0v2"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M20.5 24c.4 2.3 2 3.6 3.8 3.6s3.6-1.4 3.7-3.6"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
