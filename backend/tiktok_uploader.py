"""
=============================================================================
TIKTOK BULK UPLOADER - Phase 1: đăng thử 1 video qua TikTok Studio
Dùng Playwright điều khiển browser Chrome thật, đăng nhập bằng cách nạp thẳng
cookie session (copy từ F12 Network tab của 1 phiên Chrome đã login) - không
tự động hoá bước login/QR/password (TikTok chặn automation ở đúng bước đó).

LƯU Ý: Selector đã được xác nhận từ HTML thật (F12) cho toàn bộ flow: upload,
caption, cover, product link, schedule (giờ + ngày, có điều hướng tháng), sounds/
volume, publish. Chạy với headless=False để theo dõi.
=============================================================================
"""

from playwright.sync_api import sync_playwright
import csv
import json
import random
import re
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

# Mọi đường dẫn tương đối trong file này đều tính từ vị trí file (__file__), KHÔNG
# phải từ thư mục đang chạy lệnh (cwd) - nhờ vậy chạy script từ đâu cũng ra kết quả
# đúng chỗ, không cần phải `cd` vào backend/ trước. Cookie/session/log/state đều
# lưu ngay cạnh file này (BASE_DIR) - xem .gitignore, các file này KHÔNG commit.
BASE_DIR = Path(__file__).resolve().parent

VN_MONTHS = [
    'Tháng Một', 'Tháng Hai', 'Tháng Ba', 'Tháng Tư', 'Tháng Năm', 'Tháng Sáu',
    'Tháng Bảy', 'Tháng Tám', 'Tháng Chín', 'Tháng Mười', 'Tháng Mười Một', 'Tháng Mười Hai',
]


class ContentModerationBlocked(Exception):
    """TikTok chặn đăng vì nội dung có thể vi phạm/bị hạn chế kiểm duyệt (popup
    "Nội dung có thể sẽ bị hạn chế" hiện ra thay vì đăng/lên lịch thành công -
    xác nhận từ captured_html/tiktok_upload.html dòng 1357-1517). Raise RIÊNG
    loại lỗi này (khác Exception kỹ thuật thường) để tầng trên (batch_engine,
    app) phân biệt được: lỗi này do CHÍNH VIDEO bị TikTok đánh giá vi phạm -
    thử lại y hệt video đó nhiều khả năng vẫn bị chặn giống hệt, cần đổi sang
    video khác chứ không phải chạy lại suông."""
    pass

# ==================== CONFIG ====================
CONFIG = {
    # Chuỗi cookie copy từ F12 (Network tab -> request headers -> "cookie:")
    # của 1 phiên Chrome cá nhân đã login TikTok. File 1 dòng, không commit/chia sẻ.
    # Chỉ cần dùng 1 LẦN ĐẦU - từ lần sau script tự load lại 'session_state_file'
    # (đã lưu đủ cookie + localStorage, không phải re-login/dán cookie nữa).
    'cookie_file': BASE_DIR / 'tiktok_cookie.txt',
    'session_state_file': BASE_DIR / 'tiktok_session_state.json',

    'headless': False,
    'timeout': 30000,

    'upload_url': 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=video',

    # Video test - đổi thành đường dẫn video thật của bạn khi chạy tay
    # (python tiktok_uploader.py); app desktop cho chọn video qua UI, không
    # đọc giá trị này.
    'video_path': BASE_DIR / 'sample_video.mp4',

    # Caption - sẽ gắn thủ công theo từng video, đây là giá trị test
    'caption': 'Máy sấy tóc ion âm LUNO - khô tóc nhanh, giảm xơ rối, an toàn cho tóc.',

    # Hashtag cố định cho toàn bộ video
    'hashtags': [
        '#maysaytocluno', '#maysaytoc', '#luno', '#chamsoctoc',
        '#depmoingay', '#tocdep', '#haircare',
    ],

    # Ảnh bìa: ưu tiên 'cover_image_path' (ảnh dựng sẵn, vd cắt từ grid layout).
    # 'cover_second' chỉ dùng khi KHÔNG có cover_image_path (fallback/optional).
    'cover_image_path': None,
    'cover_second': 7,
    'cover_output_dir': BASE_DIR / 'covers',  # folder chung lưu ảnh bìa đã cắt, không lưu cạnh video nữa

    # Link sản phẩm affiliate
    'product_id': '1736094128168862925',

    # Lên lịch đăng - None = đăng "Bây giờ"
    'schedule_date': '2026-07-30',
    'schedule_time': '12:00',

    # Nhạc nền: random 1 bài trong N bài đầu của tab Yêu thích
    'music_pick_range': (1, 8),
    'music_volume_db': -20,

    # Log / cache
    'log_csv': BASE_DIR / 'tiktok_upload_log.csv',
    'state_json': BASE_DIR / 'tiktok_upload_state.json',
}


def resolve_binary(name):
    """Tìm executable trong PATH, fallback về vị trí winget phổ biến trên Windows."""
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


FFMPEG_BIN = resolve_binary("ffmpeg")


# ==================== LOGIN / SESSION ====================

def parse_cookie_string(cookie_string, domain='.tiktok.com'):
    """Parse chuỗi cookie dạng 'key1=value1; key2=value2; ...' (copy từ F12
    Network tab -> Request Headers -> cookie:) thành list cookie cho Playwright."""
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
    """Mở browser Chrome thật (bundled, không cần profile riêng).

    Ưu tiên load lại 'session_state_file' đã lưu từ lần chạy trước (gồm cả
    cookie + localStorage) - giúp TikTok nhận ra đây là session/thiết bị "quen"
    thay vì mỗi lần chạy đều bị coi là lần đầu (tránh hiện lại tutorial popup
    "Got it" mỗi lần). Chỉ khi chưa có file này mới cần nạp cookie thô từ F12.
    """
    browser = playwright.chromium.launch(channel='chrome', headless=CONFIG['headless'])
    session_file = Path(CONFIG['session_state_file'])

    # Ghim locale='vi-VN' để UI TikTok luôn hiển thị tiếng Việt, nhất quán giữa
    # các lần chạy (nếu không ghim, TikTok tự chọn EN/VI tuỳ ý -> toàn bộ selector
    # dựa theo text tiếng Việt sẽ ngẫu nhiên fail khi nó tự chuyển qua English)
    if session_file.exists():
        print(f"\n🔐 Nạp lại session đã lưu: {session_file}")
        context = browser.new_context(storage_state=str(session_file), locale='vi-VN')
        return browser, context

    cookie_file = Path(CONFIG['cookie_file'])
    if not cookie_file.exists():
        raise FileNotFoundError(
            f"Chưa có {cookie_file} lẫn {session_file} - xem hướng dẫn lấy cookie từ F12 Network tab trước khi chạy."
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
    """Lưu lại cookie + localStorage sau khi login thành công, để lần chạy sau
    không cần dán lại cookie từ F12 nữa."""
    context.storage_state(path=CONFIG['session_state_file'])
    print(f"  💾 Đã lưu session vào {CONFIG['session_state_file']}")


def dismiss_popups(page, max_attempts=3):
    """Tự động đóng các popup tutorial/tooltip (vd nút 'Got it'/'Đã hiểu') - TikTok
    hay hiện hướng dẫn tính năng mới cho session/browser bị coi là 'mới'. Mỗi khu
    vực (trang upload, cover editor, sound/clip editor) dùng class riêng
    (.tutorial-tooltip__footer, .editor-guide-tooltip__footer,...) nên match theo
    substring "tooltip__footer" thay vì 1 class cụ thể để bắt được mọi biến thể."""
    dismissed = 0
    for _ in range(max_attempts):
        try:
            page.locator('[class*="tooltip__footer"] button').first.click(timeout=1000)
            page.wait_for_timeout(400)
            dismissed += 1
        except Exception:
            break
    if dismissed:
        print(f"  ℹ Đã đóng {dismissed} popup hướng dẫn (tutorial tooltip)")
    return dismissed


# ==================== FFMPEG HELPERS ====================

def extract_cover_frame(video_path, second, out_path):
    """Cắt 1 frame tại giây chỉ định làm ảnh bìa."""
    cmd = [
        FFMPEG_BIN, "-y", "-ss", str(second), "-i", str(video_path),
        "-frames:v", "1", "-q:v", "2", str(out_path),
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not Path(out_path).exists():
        raise RuntimeError(f"ffmpeg cắt frame thất bại: {r.stderr.decode(errors='ignore')[:300]}")
    print(f"  ✓ Cắt frame tại giây {second}s -> {out_path}")


# ==================== UPLOAD STEPS ====================

def check_login(page):
    """Kiểm tra cookie có login thành công hay không trước khi làm gì tiếp."""
    time.sleep(2)
    current_url = page.url
    if '/login' in current_url:
        print(f"  ✗ Cookie KHÔNG hợp lệ - bị redirect về trang login: {current_url}")
        return False
    print(f"  ✓ Cookie hợp lệ - đang ở: {current_url}")
    return True


def upload_video_file(page, video_path):
    print(f"\n📤 Upload video: {video_path}")
    dismiss_popups(page)  # tutorial tooltip hay hiện ngay khi vừa vào trang upload
    file_input = page.locator('input[type="file"]').first
    file_input.set_input_files(str(video_path))

    # Đợi TikTok xử lý xong video và hiện khung caption (data-e2e ổn định,
    # không phụ thuộc ngôn ngữ UI - khác với chờ text "Mô tả"/"Description")
    print("  → Đợi TikTok xử lý video...")
    page.wait_for_selector('[data-e2e="caption_container"]', timeout=120000)
    # Đợi lâu hơn (không chỉ 2s) trước khi động vào caption - nghi ngờ TikTok có
    # cơ chế tự khôi phục caption/draft cũ chạy bất đồng bộ sau khi khung caption
    # xuất hiện; gõ caption mới quá sớm có thể bị ghi đè lại bởi giá trị cũ khi
    # cơ chế đó chạy xong sau (từng gặp: caption/video của lượt sau bị lẫn nội
    # dung lượt trước khi chạy batch nhiều video liên tiếp).
    time.sleep(4)
    dismiss_popups(page)  # có thể hiện thêm tooltip khác sau khi video xử lý xong
    print("  ✓ Video đã upload xong")


def set_caption(page, caption_text):
    print(f"\n📝 Điền mô tả: {caption_text[:60]}...")
    caption_box = page.locator('[data-e2e="caption_container"] div[contenteditable="true"]').first
    caption_box.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Delete")
    caption_box.press_sequentially(caption_text, delay=15)
    page.keyboard.press("Shift+Enter")  # xuống dòng mềm, tách mô tả với hashtag phía sau
    time.sleep(0.5)
    print("  ✓ Đã điền mô tả")


def add_hashtags(page, hashtags):
    print(f"\n#️⃣ Gắn hashtag: {', '.join(hashtags)}")
    # Gõ "#tag" đầy đủ sẽ mở dropdown gợi ý (nổi bằng Popper, div có
    # data-popper-placement + z-index 9999) - PHẢI chọn 1 mục trong dropdown đó
    # (bằng phím Enter, không phải click chuột - click làm mất focus caption và
    # tự đóng dropdown) thì TikTok mới tạo entity thật (span.mention). Gõ xong rồi
    # bấm Space suông (không qua dropdown) sẽ để lại text thường, không phải hashtag.
    # Dò "dropdown đã sẵn sàng" qua selector không đáng tin cậy (luôn báo "không
    # thấy" dù dropdown thực sự có hiện) - theo quan sát trực tiếp của user, chỉ
    # cần đợi cố định rồi bấm Enter là dropdown đã kịp load và ghi nhận đúng.
    # Tag cuối từng bị bỏ sót ở delay 1s -> tăng lên 1.5s cho chắc.
    caption_box = page.locator('[data-e2e="caption_container"] div[contenteditable="true"]').first
    caption_box.click()
    page.keyboard.press("End")
    for tag in hashtags:
        caption_box.press_sequentially(tag, delay=40)
        page.wait_for_timeout(1500)
        page.keyboard.press("Enter")  # chọn gợi ý đầu tiên trong dropdown -> tạo entity mention
        page.wait_for_timeout(400)
        page.keyboard.press("Space")
        page.wait_for_timeout(500)
    print("  ✓ Đã gắn xong hashtag")


def set_cover(page, video_path, second=None, image_path=None):
    """Ảnh bìa: ưu tiên dùng thẳng image_path (vd ảnh cắt từ grid layout) nếu có.
    Chỉ khi không truyền image_path mới fallback về cắt frame tại giây `second`
    trong video bằng ffmpeg (cách cũ, giờ là phụ/optional)."""
    if image_path:
        print(f"\n🖼 Dùng ảnh bìa có sẵn: {image_path}")
        frame_path = Path(image_path)
    else:
        print(f"\n🖼 Chọn ảnh bìa tại giây {second}s (fallback - chưa có ảnh dựng sẵn)")
        cover_dir = Path(CONFIG['cover_output_dir'])
        cover_dir.mkdir(exist_ok=True)
        frame_path = cover_dir / f"{Path(video_path).stem}.cover.jpg"
        extract_cover_frame(video_path, second, frame_path)

    # data-e2e="cover_container" -> .edit-container ("Edit cover"/"Sửa ảnh bìa",
    # không phụ thuộc ngôn ngữ vì chọn theo cấu trúc chứ không theo text)
    page.locator('[data-e2e="cover_container"] .edit-container').click()
    page.wait_for_timeout(1500)
    dismiss_popups(page)  # cover editor có thể hiện tutorial riêng lần đầu

    # Xác nhận từ HTML thật (edit_cover.html): .ImageUpload__uploadArea chứa
    # input[type=file] ẩn cho "Tải ảnh bìa lên" - ưu tiên cách này thay vì kéo
    # FramePicker (canvas timeline), chính xác đúng giây vì ffmpeg cắt sẵn frame
    page.locator('.ImageUpload__uploadArea input[type="file"]').set_input_files(str(frame_path))

    # Đợi ảnh thực sự upload/render xong lên canvas trước khi bấm Lưu - click
    # quá sớm có thể lưu nhầm cover mặc định (frame tự chọn) thay vì ảnh vừa tải
    save_btn = page.locator('.cover-editor-header .header-right button.Button__root--type-primary')
    save_btn.wait_for(state='visible')
    page.wait_for_timeout(3000)

    save_btn.click()
    time.sleep(1)
    print("  ✓ Đã đặt ảnh bìa")


def add_product_link(page, product_id, display_name=None):
    """`display_name` (tuỳ chọn, tối đa 30 ký tự - giới hạn thật của TikTok):
    ghi đè tên sản phẩm hiển thị trên video ở popup xác nhận cuối, thay vì
    dùng nguyên tên mặc định đã cấu hình sẵn trên TikTok Seller Center."""
    print(f"\n🔗 Gắn link sản phẩm ID: {product_id}")
    # data-e2e="anchor_container" chứa đúng 1 nút "+ Thêm"
    page.locator('[data-e2e="anchor_container"] button').click()
    time.sleep(1)

    # Popup 1 "Thêm liên kết" (xác nhận từ Add_link.html dòng 1-72): combobox
    # "Loại liên kết" mặc định đã là "Sản phẩm" - vẫn chọn lại cho chắc, rồi bấm Tiếp
    page.locator('.TUXSelect-button').click()
    page.get_by_text("Sản phẩm", exact=True).last.click()
    page.get_by_role("button", name="Tiếp", exact=True).click()
    time.sleep(1)

    # Popup 2 "Thêm liên kết sản phẩm" (dòng 74-603): tab "Trưng bày sản phẩm"
    # mặc định active -> ô tìm kiếm placeholder "Tìm kiếm sản phẩm" -> chọn dòng
    # đầu trong bảng kết quả
    search_box = page.get_by_placeholder("Tìm kiếm sản phẩm")
    search_box.fill(product_id)
    search_box.press("Enter")  # fill() không tự trigger search - cần Enter để bấm tìm
    page.wait_for_timeout(1500)
    page.locator('.product-table tbody tr').first.locator('input[type="radio"]').click()
    page.get_by_role("button", name="Tiếp", exact=True).click()
    time.sleep(1.5)

    # Popup 3 xác nhận (dòng 605-647): input "Tên sản phẩm" điền sẵn tên mặc
    # định đã cấu hình trên TikTok Seller Center (tối đa 30 ký tự, có đếm
    # "30/30" ngay dưới ô). Nếu có display_name -> ghi đè bằng fill() (tự xoá
    # giá trị cũ trước khi gõ) trước khi bấm Thêm; không có thì giữ nguyên mặc
    # định, không đụng vào ô này.
    if display_name:
        name_input = page.get_by_label("Tên sản phẩm")
        name_input.fill(display_name[:30])
        page.wait_for_timeout(300)

    page.get_by_role("button", name="Thêm", exact=True).click()
    time.sleep(1)
    print("  ✓ Đã gắn link sản phẩm")


def set_schedule(page, date_str, time_str):
    if not date_str or not time_str:
        print("\n⏱ Không set lịch - đăng ngay (Now)")
        return

    print(f"\n⏱ Lên lịch đăng: {date_str} {time_str}")
    # input[name="postSchedule"][value="schedule"] nằm dưới 1 span trang trí
    # (.Radio__innerCircle) đè lên trên -> click thẳng vào input bị chặn pointer-
    # events, retry vô tận rồi timeout. Phải click vào <label> bao ngoài (đúng
    # như UI thật: người dùng bấm label/chữ, không bấm trúng pixel input).
    schedule_container = page.locator('[data-e2e="schedule_container"]')
    schedule_label = schedule_container.locator(
        'label.Radio__root', has=page.locator('input[value="schedule"]')
    )
    schedule_label.click()
    time.sleep(0.5)

    # Xác nhận từ HTML thật (schedule.html): giờ chỉ chọn được theo bước 5 phút
    # (danh sách phút: 00,05,10,...,55) - làm tròn nếu người dùng truyền phút lẻ
    hh, mm = time_str.split(':')
    mm_rounded = round(int(mm) / 5) * 5
    if mm_rounded == 60:
        mm_rounded = 0
    if mm_rounded != int(mm):
        print(f"  ⚠ TikTok chỉ cho chọn phút theo bước 5 - làm tròn {mm} -> {mm_rounded:02d}")
    hh_str, mm_str = f"{int(hh):02d}", f"{mm_rounded:02d}"

    picker_inputs = schedule_container.locator('.scheduled-picker input[readonly]')
    picker_inputs.nth(0).click()  # mở time picker
    page.wait_for_timeout(500)
    scroll_cols = page.locator('.tiktok-timepicker-time-scroll-container')
    scroll_cols.nth(0).get_by_text(hh_str, exact=True).click()
    scroll_cols.nth(1).get_by_text(mm_str, exact=True).click()
    time.sleep(0.5)

    # Xác nhận từ HTML thật: click ô ngày -> mount .calendar-wrapper (grid ngày,
    # class "valid" = chọn được, "selected" = đang chọn). Điều hướng tháng bằng
    # 2 mũi tên .arrow (trái=tháng trước, phải=tháng sau) cho tới khi header
    # (.month-title/.year-title) khớp tháng/năm mong muốn.
    target = datetime.strptime(date_str, '%Y-%m-%d')
    picker_inputs.nth(1).click()
    page.wait_for_timeout(500)
    calendar = page.locator('.calendar-wrapper')

    for _ in range(24):
        month_name = calendar.locator('.month-title').inner_text().strip()
        year_name = calendar.locator('.year-title').inner_text().strip()
        if month_name == VN_MONTHS[target.month - 1] and year_name == str(target.year):
            break
        current_month = VN_MONTHS.index(month_name) + 1
        current = datetime(int(year_name), current_month, 1)
        arrows = calendar.locator('.arrow')
        arrows.nth(1 if (target.year, target.month) > (current.year, current.month) else 0).click()
        page.wait_for_timeout(300)
    else:
        raise RuntimeError(f"Không điều hướng được lịch tới tháng {target.month}/{target.year}")

    calendar.locator('span.day.valid', has_text=re.compile(rf'^{target.day}$')).click()
    time.sleep(0.5)
    print("  ✓ Đã chọn ngày/giờ lên lịch")


def add_music(page, pick_range, volume_db):
    lo, hi = pick_range
    pick_index = random.randint(lo, hi)
    print(f"\n🎵 Thêm nhạc nền (chọn ngẫu nhiên bài #{pick_index} trong Yêu thích)")

    # button[data-button-name="sounds"] mở MusicPanel - selector chính xác,
    # không phụ thuộc text "Sounds"/"Âm thanh"
    page.locator('button[data-button-name="sounds"]').click()
    page.wait_for_timeout(1500)
    dismiss_popups(page)  # clip editor có thể hiện tutorial riêng lần đầu

    # Xác nhận từ HTML thật (sounds.html): tab role="tab" name "Yêu thích"
    page.get_by_role("tab", name="Yêu thích").click()
    page.wait_for_timeout(1000)
    dismiss_popups(page)  # tooltip "Phone mode" có thể load trễ hơn (video preload)

    # Mỗi bài hát là 1 [role="listitem"], nút "+" là button chứa icon PlusBold.
    # Nếu bài đã random trúng đang bị disable (đã add nhạc khác từ trước), thử bài kế tiếp.
    items = page.locator('[role="listitem"][data-item-id]')
    count = items.count()
    if count == 0:
        print("  ⚠ Không tìm thấy bài hát nào trong Yêu thích, bỏ qua bước nhạc")
        return

    tried = 0
    idx = min(pick_index, count) - 1
    added = False
    while tried < count:
        add_btn = items.nth(idx).locator('button:has(span[data-icon="PlusBold"])')
        if add_btn.count() and add_btn.first.get_attribute('aria-disabled') != 'true':
            add_btn.first.click()
            added = True
            break
        idx = (idx + 1) % count
        tried += 1

    if not added:
        print("  ⚠ Không tìm thấy bài hát nào có thể thêm (tất cả đều bị disable), bỏ qua bước nhạc")
        return

    # Sau khi add nhạc, panel chuyển từ danh sách bài hát sang khung chỉnh sửa
    # (âm lượng, rõ dần/mờ dần) - cần đợi panel này render xong
    page.wait_for_timeout(2000)

    # .PropSettingSliderInput__numberInput input dính CẢ 3 ô (dB + 2 ô giây của
    # "Rõ dần và mờ dần") vì cùng dùng chung class input - dùng accessible name
    # "dB" (Playwright tự nhận từ label cạnh input) để trỏ đúng 1 ô duy nhất.
    db_input = page.get_by_role("textbox", name="dB")
    db_input.fill(str(volume_db))
    page.keyboard.press("Tab")
    time.sleep(0.5)

    # Xác nhận từ HTML thật: nút Lưu nằm trong .clip-forge-editor-header-right
    page.locator('.clip-forge-editor-header-right button.Button__root--type-primary').click()

    print(f"  ✓ Đã thêm nhạc, target volume {volume_db}dB")


def _dismiss_moderation_block(page):
    """Kiểm tra TikTok có đang chặn đăng bằng popup "Nội dung có thể sẽ bị hạn
    chế" hay không (xác nhận từ captured_html/tiktok_upload.html dòng
    1357-1517 - hiện RA THAY VÌ đăng/lên lịch thành công khi bấm nút Đăng/Lưu
    bản nháp). Trước đây bước chờ URL đổi trang chỉ timeout sau 45s rồi NUỐT
    LỖI im lặng (except Exception: print cảnh báo, không raise) - khiến video
    bị TikTok chặn vẫn được ghi nhận 'success' trong log dù thực ra chưa hề
    đăng, và batch bị "đơ" giữa chừng chờ user tự bấm tay ngoài kịch bản.

    Nếu thấy popup: tự đóng popup cảnh báo (KHÔNG bấm "Thay thế video" - việc
    chọn video khác cần làm thủ công qua UI riêng của app, không tự động chọn
    hộ được) -> bấm "Hủy bỏ" (discard_post_button) ở trang chính -> xác nhận
    "Hủy bỏ" ở popup hỏi lại -> raise ContentModerationBlocked để tầng trên
    (batch_engine) ghi nhận ĐÚNG nguyên nhân thất bại, khác lỗi kỹ thuật
    thường. Nếu KHÔNG thấy popup trong thời gian chờ ngắn, trả về bình
    thường (không phải bị chặn)."""
    modal = page.locator('.TUXModal', has_text="Nội dung có thể sẽ bị hạn chế")
    try:
        modal.first.wait_for(state='visible', timeout=5000)
    except Exception:
        return  # không bị chặn - tiếp tục flow đăng bình thường

    print("  ⚠ TikTok chặn đăng: nội dung có thể bị hạn chế kiểm duyệt - tự huỷ video này")
    modal.first.locator('.common-modal-close').click()
    page.wait_for_timeout(500)

    page.locator('[data-e2e="discard_post_button"]').click()
    page.wait_for_timeout(500)

    # Popup xác nhận "Hủy bỏ bài đăng này?" - class riêng common-modal-confirm-modal
    # (khác modal cảnh báo ở trên) để không nhầm nút "Hủy bỏ" giữa 2 popup.
    confirm_modal = page.locator('.common-modal-confirm-modal')
    confirm_modal.get_by_role("button", name="Hủy bỏ", exact=True).click()
    page.wait_for_timeout(2000)

    raise ContentModerationBlocked(
        "TikTok chặn đăng - nội dung có thể vi phạm/bị hạn chế kiểm duyệt, cần đổi video khác"
    )


def publish(page):
    print("\n🚀 Đăng bài...")
    page.mouse.wheel(0, 3000)
    time.sleep(1)

    # data-e2e="post_video_button" - selector chính xác, giữ nguyên label "Post"
    # bất kể chọn "Now" hay "Schedule"
    page.locator('[data-e2e="post_video_button"]').click()

    # Kiểm tra popup chặn kiểm duyệt NGAY (không đợi hết 45s wait_for_url bên
    # dưới rồi mới phát hiện) - raise ContentModerationBlocked nếu bị chặn,
    # dừng hẳn ở đây (không chạy tiếp phần chờ URL đổi trang).
    _dismiss_moderation_block(page)

    # Đợi TikTok xử lý xong submit trước khi làm gì tiếp (vd goto video kế tiếp
    # trong bulk_upload.py) - nếu điều hướng đi quá sớm lúc còn đang submit, có
    # thể làm gián đoạn, video không được tạo lịch thật. Tín hiệu chờ: URL
    # chuyển khỏi trang "/upload" (TikTok redirect sau khi đăng/lên lịch thành công).
    try:
        page.wait_for_url(lambda url: '/upload' not in url, timeout=45000)
        print(f"  ✓ Đã đăng/lên lịch xong - chuyển sang: {page.url}")
        # URL đổi chỉ báo hiệu TRÌNH DUYỆT đã chuyển trang, KHÔNG chắc chắn
        # TikTok đã xử lý xong hoàn toàn ở phía server - đợi thêm cho chắc trước
        # khi video kế tiếp bắt đầu (goto lại trang upload ngay có thể phá giữa
        # chừng quá trình submit, gây lẫn dữ liệu giữa 2 video liên tiếp).
        time.sleep(5)
    except Exception:
        print("  ⚠ Không thấy URL chuyển trang sau 45s - có thể vẫn đang xử lý hoặc "
              "flow khác dự kiến, kiểm tra lại thủ công trên browser.")
        time.sleep(3)


def save_draft(page):
    """Lưu bản nháp thay vì đăng/lên lịch - data-e2e="save_draft_button" nằm
    cùng hàng với post_video_button (xác nhận từ captured_html/tiktok_upload.html).
    CHƯA verify: lịch đã set (nếu có) có được giữ lại trong bản nháp hay không."""
    print("\n📝 Lưu bản nháp...")
    page.mouse.wheel(0, 3000)
    time.sleep(1)

    page.locator('[data-e2e="save_draft_button"]').click()

    # Cùng lý do như publish() - phòng trường hợp popup chặn kiểm duyệt cũng
    # hiện ra khi lưu nháp (chưa xác nhận chắc chắn có xảy ra hay không, nhưng
    # kiểm tra thêm ở đây an toàn hơn, tốn thêm tối đa 5s nếu không xảy ra).
    _dismiss_moderation_block(page)

    try:
        page.wait_for_url(lambda url: '/upload' not in url, timeout=45000)
        print(f"  ✓ Đã lưu bản nháp - chuyển sang: {page.url}")
        time.sleep(5)  # đợi thêm cho chắc, xem lý do trong publish()
    except Exception:
        print("  ⚠ Không thấy URL chuyển trang sau 45s - kiểm tra lại thủ công trên browser.")
        time.sleep(3)


# ==================== LOG / CACHE ====================

def log_result(video_path, status, error=None, error_type=None):
    log_csv = Path(CONFIG['log_csv'])
    is_new = not log_csv.exists()

    with open(log_csv, 'a', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        if is_new:
            writer.writerow(['video', 'schedule_date', 'schedule_time', 'product_id',
                              'cover_second', 'status', 'error', 'logged_at'])
        writer.writerow([
            str(video_path), CONFIG['schedule_date'], CONFIG['schedule_time'],
            CONFIG['product_id'], CONFIG['cover_second'], status, error or '',
            time.strftime('%Y-%m-%d %H:%M:%S'),
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
        'product_id': CONFIG['product_id'],
        'error_type': error_type,  # vd 'moderation' - None với lỗi kỹ thuật thường/thành công
        'logged_at': time.strftime('%Y-%m-%d %H:%M:%S'),
    }
    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"  💾 Đã log kết quả vào {CONFIG['log_csv']} / {CONFIG['state_json']}")


# ==================== MAIN ====================

def main():
    video_path = CONFIG['video_path']
    if not Path(video_path).exists():
        print(f"❌ Không tìm thấy video: {video_path}")
        return

    with sync_playwright() as p:
        browser, context = ensure_login(p)
        page = context.new_page()

        try:
            print(f"\n🌐 Mở trang upload...")
            page.goto(CONFIG['upload_url'], timeout=CONFIG['timeout'])

            if not check_login(page):
                print("❌ Dừng lại - cookie hết hạn hoặc sai, lấy lại cookie mới từ F12 rồi thử lại.")
                return
            save_session_state(context)  # từ lần sau khỏi cần dán lại cookie F12

            upload_video_file(page, video_path)
            set_caption(page, CONFIG['caption'])
            add_hashtags(page, CONFIG['hashtags'])
            set_cover(page, video_path, CONFIG['cover_second'], CONFIG['cover_image_path'])
            add_product_link(page, CONFIG['product_id'])
            set_schedule(page, CONFIG['schedule_date'], CONFIG['schedule_time'])
            add_music(page, CONFIG['music_pick_range'], CONFIG['music_volume_db'])

            input("\n⏸ Kiểm tra lại toàn bộ trên browser trước khi đăng. Nhấn Enter để bấm nút đăng...")
            publish(page)

            log_result(video_path, 'success')

        except Exception as e:
            print(f"\n❌ Lỗi: {e}")
            import traceback
            traceback.print_exc()
            log_result(video_path, 'failed', error=str(e))

        finally:
            input("\nNhấn Enter để đóng browser...")
            browser.close()


if __name__ == '__main__':
    main()
