<p align="center">
  <img src="logo_luno.png" alt="LUNO" height="80" />
</p>

<h1 align="center">LUNO Automation</h1>

<p align="center">
  Đăng video hàng loạt lên <b>TikTok</b> và <b>Shopee Video</b> (gắn kèm link sản phẩm affiliate,
  lên lịch, ảnh bìa,...) qua ứng dụng desktop - không cần đụng vào code mỗi lần dùng.
</p>

## Vì sao dự án này tồn tại

- **TikTok không có API chính thức cho việc đăng hàng loạt kèm gắn link sản phẩm** (Product Anchor)
  - API chính thức (Content Posting API) không hỗ trợ đủ tính năng cần thiết cho use-case bán hàng
    affiliate này.
- **Tự đăng tay từng video hàng loạt cũng không gắn được link sản phẩm** ở quy mô lớn - thao tác
  lặp lại hàng trăm lần qua UI web là không thực tế.
- **Shopee tuy có API chính thức**, nhưng việc xin quyền + tích hợp cho use-case "đăng video kèm
  sản phẩm hàng loạt" không nhanh hơn đáng kể so với việc tự động hoá qua UI - trong khi làm 1 flow
  chung (Playwright) cho cả 2 nền tảng lại đơn giản và nhất quán hơn.

→ Giải pháp: dùng [Playwright](https://playwright.dev) điều khiển **chính trình duyệt Chrome thật
  đã cài trên máy** để thao tác qua giao diện web TikTok Studio / Shopee Creator Center, y hệt như
  người dùng thật thao tác tay - chỉ khác là tự động hoá hàng loạt. Không giả lập/vượt qua bất kỳ cơ
  chế bảo mật nào của 2 nền tảng; đăng nhập vẫn do chính bạn thực hiện thủ công (xem mục "Đăng
  nhập" bên dưới).

## Tính năng

**Chung cho cả 2 kênh:**
- Đăng nhập bằng cookie tự dán từ trình duyệt (không tự động hoá bước login/QR - xem lý do bên dưới)
- Lưu tối đa 3 tài khoản/kênh, chuyển đổi nhanh giữa các tài khoản
- Chọn video theo 2 cách: lọc theo dải số thứ tự trong tên file, HOẶC tự duyệt & chọn tuỳ ý qua
  dialog hệ thống (kết hợp cả 2 cách trong cùng 1 batch)
- Chỉnh mô tả, hashtag (mặc định hoặc tuỳ chỉnh riêng từng video), lịch đăng (có 4 nút chọn nhanh
  khung giờ), bật/tắt gắn link sản phẩm riêng từng video
- Lưu bản nháp thay vì đăng thật nếu muốn tự kiểm tra lại trước
- Chạy cả batch trong 1 phiên trình duyệt duy nhất, xem tiến độ real-time qua log
- Tự động lưu batch đang chỉnh dở ra đĩa - đóng/mở lại app không mất dữ liệu đã nhập, tự bỏ qua
  video đã đăng thành công khi chạy lại
- Nút "chạy lại video lỗi" sau khi batch chạy xong
- Màn hình "⚙ Cài đặt mặc định" - tự đổi caption/hashtag/ID sản phẩm/dB nhạc/thời gian nghỉ giữa
  các video mặc định, không cần sửa code

**Riêng TikTok:**
- Ảnh bìa dạng **Grid Layout** - cắt 1 ảnh lớn thành N mảnh (3x3 hoặc 3x4), đăng đúng thứ tự để
  khi xem trang hồ sơ TikTok (lưới 3 cột) sẽ thấy ảnh ghép hoàn chỉnh
- Tên sản phẩm hiển thị trên video: dùng tên mặc định trên Seller Center, hoặc tự gõ tên riêng cho
  từng video (tối đa 30 ký tự - đúng giới hạn của TikTok)
- Bật/tắt nhạc nền riêng từng video (chọn ngẫu nhiên trong mục Yêu thích, chỉnh dB)

**Riêng Shopee:**
- Ảnh bìa: chọn khung hình (frame) trong chính video theo giây - Shopee không hỗ trợ tải ảnh bìa
  tuỳ ý như TikTok
- Tìm sản phẩm theo tên (khác TikTok tìm theo ID), tuỳ chọn nhập thêm ID để chọn đúng sản phẩm khi
  kết quả tìm kiếm ra nhiều dòng giống tên

## Giá trị mặc định

Dự án ban đầu được viết để phục vụ 1 thương hiệu máy sấy tóc (LUNO) - các giá trị mặc định có sẵn
trong code (caption mẫu, hashtag mẫu, ID sản phẩm mẫu) đang nghiêng theo nội dung máy sấy tóc. Đây
chỉ là dữ liệu mẫu, **không ảnh hưởng gì đến việc dùng cho sản phẩm/ngành hàng khác** - vào
**"⚙ Cài đặt mặc định"** ngay trong app để đổi lại cho phù hợp, không cần sửa code.

## Kiến trúc

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ Electron (frontend/electron) │  spawn  │ FastAPI + Playwright (backend/)   │
│  - Cửa sổ desktop            │────────▶│  http://127.0.0.1:8756            │
│  - Dialog chọn file/folder   │        │  - Điều khiển Chrome thật          │
└──────────────┬────────────────┘        │  - Chạy batch trong thread riêng  │
               │ hiển thị                └──────────────────────────────────┘
               ▼
┌─────────────────────────────┐
│ React + TypeScript (src/)    │
│  - Giao diện wizard nhiều    │
│    bước, gọi API qua fetch   │
└─────────────────────────────┘
```

- **`backend/`** - Python thuần (FastAPI + Playwright), không phụ thuộc gì vào Electron/Node. Có
  thể chạy độc lập qua CLI (`python bulk_upload.py`, `python test_shopee_single.py`) để test không
  cần mở app.
- **`frontend/`** - Electron + React + Vite + TypeScript + Tailwind CSS. Chỉ là lớp giao diện, KHÔNG
  chứa logic tự động hoá - mọi thao tác Playwright đều nằm ở `backend/`.
- 2 phần giao tiếp qua HTTP/WebSocket local (`127.0.0.1:8756`, không lộ ra mạng ngoài).

## Cài đặt (chạy từ source, chế độ dev)

Yêu cầu: [Node.js](https://nodejs.org) 18+, [Python](https://python.org) 3.11+, **Google Chrome**
đã cài sẵn (dùng `channel='chrome'` của Playwright - điều khiển thẳng Chrome thật, không tải
Chromium riêng).

```bash
git clone <repo-url> luno-automation
cd luno-automation

# 1. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt

# 2. Frontend
cd ../frontend
npm install

# 3. Chạy dev (từ frontend/)
npm run electron:dev
```

Lần đầu mở app: bấm "+ Thêm tài khoản khác" ở bước Đăng nhập, làm theo hướng dẫn trong app để lấy
cookie từ F12 DevTools. Chỉ cần làm 1 lần/tài khoản - session tự lưu lại cho các lần sau.

## Đóng gói thành file cài đặt (.exe)

```bash
# 1. Đóng gói backend thành 1 file .exe độc lập (PyInstaller) - không cần máy
#    đích cài Python
cd backend
pip install pyinstaller
pyinstaller server.spec

# 2. Đóng gói app hoàn chỉnh (electron-builder tự nhúng backend vừa build ở
#    trên qua extraResources)
cd ../frontend
npm run electron:build
```

Kết quả: `frontend/release/LUNO Automation Setup <version>.exe` - installer NSIS chuẩn Windows.
Máy cài chỉ cần **Windows + Google Chrome**, không cần cài Node/Python/pip gì cả.

## Giới hạn cần biết

- **TikTok**: tối đa 30 video ở trạng thái "đã lên lịch" cùng lúc/tài khoản, chỉ lên lịch được
  trong vòng 30 ngày tới - đây là giới hạn cứng của TikTok, không phải giới hạn của app.
- **Đăng nhập bằng cookie thủ công có chủ đích**: TikTok/Shopee giám sát bước login/QR/password
  chặt hơn nhiều so với hành động sau khi đã đăng nhập - tự động hoá bước đó dễ bị chặn. App KHÔNG
  bao giờ tự động nhập mật khẩu hay bấm nút đăng nhập giúp bạn.
- Selector giao diện được xác nhận từ HTML thật tại thời điểm viết - TikTok/Shopee có thể đổi giao
  diện bất kỳ lúc nào khiến 1 vài bước cần cập nhật lại selector.
- Dùng có trách nhiệm: tự động hoá thao tác trên tài khoản CỦA CHÍNH BẠN, tuân thủ Điều khoản dịch
  vụ của từng nền tảng.

## Bảo mật & dữ liệu không public

Repo này **không chứa** (xem `.gitignore`): cookie/session đã lưu, danh sách tài khoản, log/lịch sử
đăng, ảnh bìa đã cắt, ghi chú phát triển nội bộ, HTML chụp màn hình dùng để tham khảo selector lúc
viết code (có thể chứa dữ liệu sản phẩm/kinh doanh thật). Toàn bộ dữ liệu đó chỉ tồn tại trên máy
bạn sau khi tự chạy app, không đi kèm mã nguồn.

## Giấy phép

[MIT](LICENSE)
