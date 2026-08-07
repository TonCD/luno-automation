import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Bắt buộc dùng đường dẫn TƯƠNG ĐỐI khi build - mặc định Vite dùng đường dẫn
  // tuyệt đối ("/assets/...") vốn chỉ đúng khi serve qua web server (dev mode).
  // Bản đóng gói Electron load index.html qua giao thức file:// (không phải
  // http://) - "/assets/..." sẽ bị trình duyệt hiểu là gốc Ổ ĐĨA thay vì đúng
  // thư mục dist/, khiến JS/CSS không load được -> app hiện trắng trơn.
  base: './',
  plugins: [react(), tailwindcss()],
})
