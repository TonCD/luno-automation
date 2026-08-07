// Icon lấy cảm hứng từ phong cách "duotone glitch" cyan/hồng của TikTok (nốt
// nhạc), KHÔNG dùng logo thật của TikTok để tránh vấn đề bản quyền/thương hiệu.
export function TikTokIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path
        d="M29 6h6c.6 4 3.4 7 8 7.6V20c-3.6 0-6.8-1.1-9-3v13.5c0 7-5.7 12.5-12.7 12.5S8.6 37.5 8.6 30.5 14.3 18 21.3 18c.9 0 1.8.1 2.7.3v6.9a6 6 0 1 0 5 5.9V6Z"
        fill="#25F4EE"
        transform="translate(-2,-2)"
      />
      <path
        d="M29 6h6c.6 4 3.4 7 8 7.6V20c-3.6 0-6.8-1.1-9-3v13.5c0 7-5.7 12.5-12.7 12.5S8.6 37.5 8.6 30.5 14.3 18 21.3 18c.9 0 1.8.1 2.7.3v6.9a6 6 0 1 0 5 5.9V6Z"
        fill="#FE2C55"
        transform="translate(2,2)"
        opacity="0.85"
      />
      <path d="M29 6h6c.6 4 3.4 7 8 7.6V20c-3.6 0-6.8-1.1-9-3v13.5c0 7-5.7 12.5-12.7 12.5S8.6 37.5 8.6 30.5 14.3 18 21.3 18c.9 0 1.8.1 2.7.3v6.9a6 6 0 1 0 5 5.9V6Z" fill="#0a0a0a" />
    </svg>
  )
}
