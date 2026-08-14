"""
=============================================================================
SHOPEE VIDEO UPLOADER - tương tự tiktok_uploader.py nhưng điều khiển trang
Shopee Video (Creator Center): https://banhang.shopee.vn/creator-center/video-upload/upload

Đăng nhập CÙNG CÁCH với TikTok: dán cookie copy từ F12 (Network tab -> Request
Headers -> cookie:) của 1 phiên Chrome đã login sẵn shopee.vn - không tự động
hoá bước login.

KHÁC BIỆT QUAN TRỌNG so với TikTok (đọc trước khi sửa code liên quan):
- Ảnh bìa: Shopee KHÔNG cho tải ảnh tuỳ ý lên làm cover - chỉ được CHỌN 1
  FRAME trong chính video đó qua thanh kéo (canvas timeline) trong popup
  "Chỉnh sửa Ảnh bìa". Vì vậy tính năng Grid Layout Cover (cắt 1 ảnh lớn thành
  nhiều mảnh) của TikTok KHÔNG áp dụng được cho Shopee.
- Sản phẩm: ô tìm kiếm chỉ tìm theo TÊN sản phẩm (không phải ID như TikTok) -
  `product_query` bắt buộc; `product_id` (số trong data-row-key) là tuỳ chọn,
  dùng để chọn ĐÚNG dòng kết quả khi tìm theo tên ra nhiều sản phẩm gần giống.
- Không có bước thêm nhạc nền (Shopee Video không có tính năng này ở màn hình
  upload).
- Nhiều selector của Shopee là class CSS Modules có hậu tố ngẫu nhiên (vd
  "...---editCover--3NDsE") CÓ THỂ ĐỔI mỗi lần Shopee build lại frontend ->
  ưu tiên chọn theo id/data-attribute thật ("#cover", "#product",
  "data-row-key") hoặc theo cấu trúc (tag "canvas", "[contenteditable=true]")
  thay vì các class hash đó ở những chỗ có thể tránh được.
- Selector thuộc thư viện dùng chung "eds-react-*" (date-picker, time-picker,
  radio, modal, button) KHÔNG bị hash - ổn định hơn nhiều, ưu tiên dùng.

LƯU Ý: các bước dưới đây viết dựa theo HTML capture thật do user chụp (F12)
1 lần duy nhất (chưa chạy thật qua Playwright) - CHƯA verify end-to-end như
tiktok_uploader.py đã được. Cần chạy thử (vd gọi main() dưới) và tinh chỉnh
timing/selector nếu có bước nào sai khác thực tế.
=============================================================================
"""

from playwright.sync_api import sync_playwright
import csv
import json
import re
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def resolve_binary(name):
    """Tìm executable trong PATH, fallback về vị trí winget phổ biến trên Windows
    (giống hệt tiktok_uploader.py/slice_grid_cover.py)."""
    import os
    found = shutil.which(name)
    if found:
        return found
    local_app = os.environ.get("LOCALAPPDATA", "")
    fallback = os.path.join(
        local_app, "Microsoft", "WinGet", "Packages",
        "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
        "ffmpeg-8.1.1-full_build", "bin", f"{name}.exe",
    )
    if Path(fallback).exists():
        return fallback
    return name


FFPROBE_BIN = resolve_binary("ffprobe")


def get_video_duration(path):
    """Thời lượng video (giây, số thực) qua ffprobe - dùng để đổi 'chọn cover
    tại giây thứ N' (UX quen thuộc từ TikTok) sang cover_ratio (0.0-1.0) mà
    set_cover() cần, vì thanh kéo chọn khung hình của Shopee chỉ nhận vị trí
    theo % chiều rộng, không có ô nhập giây."""
    cmd = [
        FFPROBE_BIN, "-v", "quiet", "-show_entries", "format=duration",
        "-of", "csv=p=0", str(path),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return float(r.stdout.strip())

# ==================== CONFIG ====================
CONFIG = {
    'cookie_file': BASE_DIR / 'shopee_cookie.txt',
    'session_state_file': BASE_DIR / 'shopee_session_state.json',

    'headless': False,
    'timeout': 30000,

    'upload_url': 'https://banhang.shopee.vn/creator-center/video-upload/upload',

    # Video test - đổi thành đường dẫn video thật khi chạy tay (python
    # shopee_uploader.py); app desktop cho chọn video qua UI, không đọc giá
    # trị này.
    'video_path': BASE_DIR / 'sample_video.mp4',

    'caption': 'Máy sấy tóc ion âm LUNO - khô tóc nhanh, giảm xơ rối, an toàn cho tóc.',
    'hashtags': ['#maysaytocluno', '#maysaytoc', '#luno'],

    # 0.0 - 1.0: vị trí (tỉ lệ % thời lượng video) trên thanh chọn khung hình
    # làm ảnh bìa - KHÔNG phải số giây cụ thể như TikTok (Shopee không có ô
    # nhập giây, chỉ có thanh kéo).
    'cover_ratio': 0.1,

    # Tìm sản phẩm theo TÊN (bắt buộc) - product_id (data-row-key, tuỳ chọn)
    # dùng để chọn đúng dòng khi kết quả tìm kiếm trả về nhiều sản phẩm.
    'product_query': 'Máy Sấy Tóc LUNO',
    'product_id': None,

    'schedule_date': None,
    'schedule_time': None,

    # Tài khoản đang active (server.py's _shopee_apply_active_account() tự set
    # trước mỗi batch) - CHỈ để ghi log/state biết video đăng qua account nào,
    # không ảnh hưởng gì tới việc chọn cookie/session dùng để đăng nhập.
    'account_id': None,
    'account_label': None,

    'log_csv': BASE_DIR / 'shopee_upload_log.csv',
    'state_json': BASE_DIR / 'shopee_upload_state.json',
}


# ==================== LOGIN / SESSION (giống hệt cơ chế TikTok) ====================

def parse_cookie_string(cookie_string, domain='.shopee.vn'):
    """Parse chuỗi cookie 'key1=value1; key2=value2; ...' copy từ F12 thành
    list cookie cho Playwright. Domain có dấu chấm đầu (.shopee.vn) để áp
    dụng cho cả subdomain banhang.shopee.vn."""
    cookies = []
    for part in cookie_string.split(';'):
        part = part.strip()
        if not part or '=' not in part:
            continue
        name, value = part.split('=', 1)
        cookies.append({
            'name': name.strip(),
            'value': value.strip(),
            'domain': domain,
            'path': '/',
        })
    return cookies


def ensure_login(playwright):
    browser = playwright.chromium.launch(channel='chrome', headless=CONFIG['headless'])
    session_file = Path(CONFIG['session_state_file'])

    if session_file.exists():
        print(f"\n🔐 Nạp lại session đã lưu: {session_file}")
        context = browser.new_context(storage_state=str(session_file), locale='vi-VN')
        return browser, context

    cookie_file = Path(CONFIG['cookie_file'])
    if not cookie_file.exists():
        raise FileNotFoundError(
            f"Chưa có {cookie_file} lẫn {session_file} - lấy cookie từ F12 Network tab của shopee.vn trước."
        )

    cookie_string = cookie_file.read_text(encoding='utf-8').strip()
    cookies = parse_cookie_string(cookie_string)
    if not cookies:
        raise ValueError(f"Không parse được cookie nào từ {cookie_file}")

    print(f"\n🔐 Nạp {len(cookies)} cookie từ {cookie_file} (lần đầu, chưa có session lưu sẵn)")
    context = browser.new_context(locale='vi-VN')
    context.add_cookies(cookies)
    return browser, context


def save_session_state(context):
    context.storage_state(path=CONFIG['session_state_file'])
    print(f"  💾 Đã lưu session vào {CONFIG['session_state_file']}")


# ==================== UPLOAD STEPS ====================

def check_login(page):
    time.sleep(2)
    current_url = page.url.lower()
    if 'login' in current_url or 'signin' in current_url or 'sso' in current_url:
        print(f"  ✗ Cookie KHÔNG hợp lệ - bị redirect về trang đăng nhập: {page.url}")
        return False
    print(f"  ✓ Cookie hợp lệ - đang ở: {page.url}")
    return True


def upload_video_file(page, video_path):
    print(f"\n📤 Upload video: {video_path}")
    file_input = page.locator('input[type="file"]').first
    file_input.set_input_files(str(video_path))

    # Theo quan sát trực tiếp của user: Shopee cần ~5-10s xử lý video trước khi
    # chuyển từ màn hình chọn video sang màn hình chỉnh sửa (caption/cover/...).
    # Chờ tín hiệu khung nhập tiêu đề xuất hiện thay vì sleep cứng, nhưng vẫn
    # cho timeout dài vì thời gian xử lý phụ thuộc kích thước video.
    print("  → Đợi Shopee xử lý video & chuyển màn hình chỉnh sửa...")
    page.wait_for_selector('[contenteditable="true"]', timeout=120000)
    page.wait_for_timeout(1500)
    print("  ✓ Video đã upload xong, đang ở màn hình chỉnh sửa")


def set_caption(page, caption_text):
    print(f"\n📝 Điền tiêu đề: {caption_text[:60]}...")
    caption_box = page.locator('[contenteditable="true"]').first
    caption_box.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Delete")
    caption_box.press_sequentially(caption_text, delay=15)
    page.wait_for_timeout(300)
    print("  ✓ Đã điền tiêu đề")


def add_hashtags(page, hashtags):
    if not hashtags:
        return
    print(f"\n#️⃣ Gắn hashtag: {', '.join(hashtags)}")
    # CHƯA XÁC NHẬN qua thực tế Shopee có bắt buộc chọn từ dropdown gợi ý (như
    # TikTok/Draft.js) để hashtag được ghi nhận là hashtag thật, hay gõ thẳng
    # "#tag" vào contenteditable thường là đủ. Áp dụng lại đúng cách AN TOÀN đã
    # rút ra từ TikTok: gõ đầy đủ "#tag" rồi bấm Enter (không click chuột - bên
    # TikTok click làm mất focus + tự đóng dropdown gợi ý) để chọn gợi ý đầu nếu
    # dropdown #hashtag_search kịp hiện ra; nếu không hiện, giữ nguyên text đã
    # gõ (không chặn tiếp tục, khác TikTok là bắt buộc).
    caption_box = page.locator('[contenteditable="true"]').first
    caption_box.click()
    page.keyboard.press("End")
    for tag in hashtags:
        tag_text = tag if tag.startswith('#') else f'#{tag}'
        page.keyboard.type(" ")
        caption_box.press_sequentially(tag_text, delay=40)
        page.wait_for_timeout(1200)
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
    print("  ✓ Đã gắn xong hashtag (CHƯA verify hiển thị đúng như hashtag thật - kiểm tra tay lần chạy đầu)")


def set_cover(page, cover_ratio=0.1):
    """Chọn ảnh bìa = 1 frame trong video, KHÔNG upload ảnh tuỳ ý (giới hạn
    của Shopee, khác TikTok). `cover_ratio` (0.0-1.0) là vị trí trên thanh
    kéo chọn khung hình, tính theo % chiều rộng thanh (xấp xỉ % thời lượng
    video, không chính xác tuyệt đối theo giây)."""
    print(f"\n🖼 Chọn ảnh bìa từ frame video (~{cover_ratio:.0%} thời lượng)")

    # #cover bọc CẢ ảnh thumbnail (90x120) LẪN chữ "Chỉnh sửa Ảnh bìa" xếp
    # chồng nhau - click thẳng vào #cover (Playwright click giữa bounding box)
    # có thể rơi vào vùng ảnh thumbnail chứ không phải đúng chữ có gắn handler
    # -> click không mở được gì. Click thẳng vào TEXT "Chỉnh sửa" cho chắc.
    page.locator('#cover').get_by_text("Chỉnh sửa", exact=False).click()
    page.wait_for_timeout(1500)

    modal_count = page.locator('.eds-react-modal__content').count()
    print(f"  ℹ Số modal đang mở sau khi click #cover: {modal_count}")
    if modal_count == 0:
        # Click vào text không ăn thua (vd bị 1 lớp che khác) -> thử lại bằng
        # click thẳng vào cả container #cover trước khi báo lỗi hẳn.
        page.locator('#cover').click()
        page.wait_for_timeout(1500)
        modal_count = page.locator('.eds-react-modal__content').count()
        print(f"  ℹ Số modal đang mở sau khi click lại #cover (fallback): {modal_count}")

    # Modal vừa mở nổi trên cùng - lấy modal cuối cùng đang mở để chắc đúng cái
    # vừa bấm (tránh trường hợp còn modal cũ chưa đóng hẳn)
    modal = page.locator('.eds-react-modal__content').last
    canvas = modal.locator('canvas').first
    canvas.wait_for(state='visible', timeout=15000)
    box = canvas.bounding_box()
    if not box:
        raise RuntimeError("Không lấy được vị trí thanh chọn khung hình (canvas) trong popup ảnh bìa")

    ratio = min(max(cover_ratio, 0.0), 1.0)
    target_x = box['x'] + box['width'] * ratio
    target_y = box['y'] + box['height'] / 2
    # Click trực tiếp lên canvas tại vị trí mong muốn - giả định thanh kéo phản
    # hồi theo kiểu "click để nhảy tới vị trí" (phổ biến ở UI dạng này). CHƯA
    # verify qua chạy thật - nếu thanh kéo chỉ nhận drag (mousedown->move->up)
    # chứ không nhận click đơn, cần đổi sang page.mouse.down/move/up.
    page.mouse.click(target_x, target_y)
    page.wait_for_timeout(800)

    modal.get_by_role("button", name="Xác nhận", exact=True).click()
    page.wait_for_timeout(500)
    print("  ✓ Đã chọn ảnh bìa (frame video)")


def add_product_link(page, product_query, product_id=None):
    if not product_query:
        return
    print(f"\n🔗 Gắn sản phẩm: tìm '{product_query}'" + (f" (ưu tiên ID {product_id})" if product_id else ""))
    # Click thẳng vào text "Thêm sản phẩm" bên trong #product (cùng lý do như
    # set_cover() - tránh rơi vào vùng không có handler click).
    page.locator('#product').get_by_text("Thêm sản phẩm", exact=False).click()
    page.wait_for_timeout(1500)

    modal_count = page.locator('.eds-react-modal__content').count()
    print(f"  ℹ Số modal đang mở sau khi click #product: {modal_count}")
    if modal_count == 0:
        page.locator('#product').click()
        page.wait_for_timeout(1500)

    modal = page.locator('.eds-react-modal__content').last
    search_box = modal.get_by_placeholder("Tìm kiếm tên sản phẩm")
    search_box.fill(product_query)
    modal.get_by_role("button", name="Áp dụng", exact=True).click()
    page.wait_for_timeout(1500)

    row = None
    if product_id:
        candidate = modal.locator(f'tr[data-row-key="{product_id}"]')
        if candidate.count() > 0:
            row = candidate.first
        else:
            print(f"  ⚠ Không thấy đúng sản phẩm ID {product_id} trong kết quả - chọn dòng đầu tiên thay thế")
    if row is None:
        row = modal.locator('tbody tr[data-row-key]').first

    # Input checkbox thật bị ẩn đi (custom checkbox kiểu label+span indicator,
    # input chỉ để giữ state, không hiển thị) - Playwright click thẳng vào input
    # sẽ timeout vì "not visible". Phải click vào <label class="eds-react-checkbox">
    # bao ngoài - click label luôn forward xuống input bên trong kể cả khi input
    # không hiển thị (hành vi chuẩn của HTML <label>).
    row.locator('label.eds-react-checkbox').click()
    page.wait_for_timeout(300)
    modal.get_by_role("button", name="Xác nhận", exact=True).click()
    page.wait_for_timeout(800)
    print("  ✓ Đã gắn sản phẩm")


def set_schedule(page, date_str, time_str):
    if not date_str or not time_str:
        print("\n⏱ Không set lịch - đăng ngay (giữ radio mặc định 'Đăng ngay')")
        return

    print(f"\n⏱ Lên lịch đăng: {date_str} {time_str}")
    # Radio "Lên lịch đăng bài sau" cũng bị 1 span trang trí đè lên input (giống
    # TikTok) - click vào <label> bao ngoài thay vì input trực tiếp.
    schedule_label = page.locator('label.eds-react-radio', has=page.locator('input[value="schedule"]'))
    schedule_label.click()
    page.wait_for_timeout(500)

    target = datetime.strptime(date_str, '%Y-%m-%d')

    # Click thẳng vào input text bị chặn bởi div bọc ngoài (.eds-react-input__inner
    # "intercepts pointer events" - xác nhận qua lỗi thật khi chạy batch 30 video)
    # - cùng dạng lỗi như radio TikTok (span trang trí đè lên input). Click vào
    # container ngoài cùng (.eds-react-date-picker__input) thay vì input nằm sâu
    # bên trong - container mới là nơi thật sự có handler mở lịch.
    date_input = page.locator('.eds-react-date-picker__input')
    date_input.click()
    page.wait_for_timeout(500)

    # Header hiển thị dạng "Th08" + "2026" (không phải tên tháng tiếng Việt như
    # TikTok) - dễ so sánh trực tiếp bằng số, không cần bảng tra tên tháng.
    calendar = page.locator('.eds-react-date-picker__panel-wrap')
    month_label = calendar.locator('.date-default-style.month')
    year_label = calendar.locator('.date-default-style.year')

    for _ in range(24):
        cur_month = int(month_label.inner_text().strip().replace('Th', ''))
        cur_year = int(year_label.inner_text().strip())
        if (cur_year, cur_month) == (target.year, target.month):
            break
        go_next = (target.year, target.month) > (cur_year, cur_month)
        arrows = calendar.locator('.btn-arrow-default:not(.double)')
        arrows.nth(1 if go_next else 0).click()
        page.wait_for_timeout(300)
    else:
        raise RuntimeError(f"Không điều hướng được lịch tới tháng {target.month}/{target.year}")

    # Vài ô ngày có thể trùng số (ngày cuối tháng trước/đầu tháng sau hiển thị
    # mờ, class "out-of-range") - lọc bỏ out-of-range/disabled, chỉ click ô
    # thuộc đúng tháng đang xem và còn chọn được.
    day_cells = calendar.locator('.eds-react-date-picker__table-cell', has_text=re.compile(rf'^{target.day}$'))
    clicked = False
    for i in range(day_cells.count()):
        cell = day_cells.nth(i)
        cls = cell.get_attribute('class') or ''
        if 'out-of-range' not in cls and 'disabled' not in cls:
            cell.click()
            clicked = True
            break
    if not clicked:
        raise RuntimeError(f"Không click được ngày {target.day} (có thể là ngày trong quá khứ hoặc đã disabled)")
    page.wait_for_timeout(500)

    # Time picker: 2 cột cuộn riêng - giờ (00-23, bước 1) và phút (00-55, bước 5)
    hh, mm = time_str.split(':')
    mm_rounded = round(int(mm) / 5) * 5
    if mm_rounded == 60:
        mm_rounded = 0
    if mm_rounded != int(mm):
        print(f"  ⚠ Shopee chỉ cho chọn phút theo bước 5 - làm tròn {mm} -> {mm_rounded:02d}")
    hh_str, mm_str = f"{int(hh):02d}", f"{mm_rounded:02d}"

    # Cùng lý do như date_input ở trên - click container ngoài, không click
    # thẳng vào input bị div bọc trong che pointer events.
    time_input = page.locator('.eds-react-time-picker__input')
    time_input.click()
    page.wait_for_timeout(500)

    time_popover = page.locator('.eds-react-time-picker__popup').last
    scroll_cols = time_popover.locator('.eds-react-time-picker__tp-scrollbar')
    scroll_cols.nth(0).locator('.time-box', has_text=re.compile(rf'^{hh_str}$')).click()
    scroll_cols.nth(1).locator('.time-box', has_text=re.compile(rf'^{mm_str}$')).click()
    page.wait_for_timeout(300)
    time_popover.get_by_role("button", name="Xác nhận", exact=True).click()
    page.wait_for_timeout(500)
    print("  ✓ Đã chọn ngày/giờ lên lịch")


def _wait_after_submit(page):
    """Đợi tín hiệu rời khỏi trang upload sau khi bấm Đăng/Lưu bản nháp - CHƯA
    xác nhận Shopee điều hướng đi đâu sau khi submit (khác TikTok đã biết rõ
    URL đích), dùng cùng chiến lược an toàn: chờ URL đổi khỏi '/video-upload/
    upload', timeout dài, có fallback nếu không thấy đổi."""
    try:
        page.wait_for_url(lambda url: '/video-upload/upload' not in url, timeout=45000)
        print(f"  ✓ Xong - chuyển sang: {page.url}")
        time.sleep(5)
    except Exception:
        print("  ⚠ Không thấy URL chuyển trang sau 45s - có thể vẫn đang xử lý hoặc Shopee không đổi URL "
              "(chưa xác nhận), kiểm tra lại thủ công trên browser.")
        time.sleep(3)


def publish(page):
    print("\n🚀 Đăng bài...")
    page.get_by_role("button", name="Đăng", exact=True).click()
    _wait_after_submit(page)


def save_draft(page):
    print("\n📝 Lưu bản nháp...")
    page.get_by_role("button", name="Lưu bản nháp", exact=True).click()
    _wait_after_submit(page)


# ==================== LOG / CACHE ====================

def log_result(video_path, status, error=None):
    log_csv = Path(CONFIG['log_csv'])
    is_new = not log_csv.exists()

    with open(log_csv, 'a', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        if is_new:
            writer.writerow(['video', 'schedule_date', 'schedule_time', 'product_query',
                              'product_id', 'cover_ratio', 'status', 'error', 'logged_at',
                              'account_id', 'account_label'])
        writer.writerow([
            str(video_path), CONFIG['schedule_date'], CONFIG['schedule_time'],
            CONFIG['product_query'], CONFIG['product_id'], CONFIG['cover_ratio'],
            status, error or '', time.strftime('%Y-%m-%d %H:%M:%S'),
            CONFIG['account_id'] or '', CONFIG['account_label'] or '',
        ])

    state_file = Path(CONFIG['state_json'])
    state = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, ValueError):
            # File rỗng/hỏng (vd tiến trình bị đóng đột ngột đúng lúc đang ghi -
            # write_text() mở file ở chế độ ghi đè nên có thể để lại file 0 byte
            # nếu bị ngắt giữa chừng) - bỏ qua nội dung cũ, ghi lại từ rỗng thay
            # vì crash toàn bộ log_result() (mất luôn cả phần log CSV vừa ghi
            # xong ở trên nếu hàm này raise exception).
            print(f"  ⚠ {state_file} bị lỗi định dạng (có thể do tắt app đột ngột) - ghi lại từ đầu")
            state = {}

    state[str(video_path)] = {
        'status': status,
        'schedule_date': CONFIG['schedule_date'],
        'schedule_time': CONFIG['schedule_time'],
        'product_query': CONFIG['product_query'],
        'account_id': CONFIG['account_id'],
        'account_label': CONFIG['account_label'],
        'logged_at': time.strftime('%Y-%m-%d %H:%M:%S'),
    }
    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"  💾 Đã log kết quả vào {CONFIG['log_csv']} / {CONFIG['state_json']}")


# ==================== MAIN (test 1 video, giống Phase 1 của TikTok) ====================

def main():
    video_path = CONFIG['video_path']
    if not Path(video_path).exists():
        print(f"❌ Không tìm thấy video: {video_path}")
        return

    with sync_playwright() as p:
        browser, context = ensure_login(p)
        page = context.new_page()

        try:
            print("\n🌐 Mở trang upload Shopee...")
            page.goto(CONFIG['upload_url'], timeout=CONFIG['timeout'])

            if not check_login(page):
                print("❌ Dừng lại - cookie hết hạn hoặc sai, lấy lại cookie mới từ F12 rồi thử lại.")
                return
            save_session_state(context)

            upload_video_file(page, video_path)
            set_caption(page, CONFIG['caption'])
            add_hashtags(page, CONFIG['hashtags'])
            set_cover(page, CONFIG['cover_ratio'])
            add_product_link(page, CONFIG['product_query'], CONFIG['product_id'])
            set_schedule(page, CONFIG['schedule_date'], CONFIG['schedule_time'])

            input("\n⏸ Kiểm tra lại toàn bộ trên browser trước khi đăng. Nhấn Enter để bấm nút đăng...")
            publish(page)

            log_result(video_path, 'success')

        except Exception as e:
            print(f"\n❌ Lỗi: {e}")
            import traceback
            traceback.print_exc()
            # Chụp lại màn hình lúc lỗi - hữu ích để debug sau này vì flow
            # Shopee còn nhiều bước chưa verify qua chạy thật, không phải lúc
            # nào cũng có người ngồi xem trực tiếp browser lúc lỗi xảy ra.
            try:
                shot_path = BASE_DIR / 'shopee_debug_error.png'
                page.screenshot(path=str(shot_path), full_page=True)
                print(f"  📸 Đã chụp màn hình lúc lỗi: {shot_path}")
            except Exception:
                pass
            log_result(video_path, 'failed', error=str(e))

        finally:
            input("\nNhấn Enter để đóng browser...")
            browser.close()


if __name__ == '__main__':
    main()
