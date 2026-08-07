"""
=============================================================================
BULK TIKTOK UPLOAD (CLI) - Phase 2: đăng hàng loạt nhiều video liên tiếp.

Đây là lớp mỏng phía trên batch_engine.py: chỉ lo phần chọn video theo cấu
hình BATCH bên dưới (folder, dải số, lịch tự sinh, ảnh cover grid, resume qua
state_json) rồi build thành list VideoJob, gọi batch_engine.run_batch() chạy
thật. Toàn bộ logic đăng 1 video / vòng lặp batch nằm trong batch_engine.py +
tiktok_uploader.py - file này không tự thao tác Playwright.
=============================================================================
"""

import json
import re
from datetime import date, timedelta
from pathlib import Path

from batch_engine import VideoJob, run_batch
from tiktok_uploader import BASE_DIR, CONFIG

# ==================== BATCH CONFIG ====================
# CLI này là lựa chọn thay thế cho app desktop (Electron) - hầu hết user nên
# dùng app (có UI, chọn video/lịch bằng tay). Sửa lại BATCH bên dưới cho đúng
# folder/dải số video của bạn trước khi chạy.
BATCH = {
    'video_dir': BASE_DIR / 'sample_videos',  # đổi thành folder video thật của bạn
    'video_glob': '*.mp4',

    'start_date': '2026-01-01',                            # ngày đăng video ĐẦU TIÊN của batch
    'daily_times': ['08:00', '12:00', '16:00', '20:00'],   # N slot/ngày = len(list)

    # Lọc theo SỐ trong tên file (vd video_040.mp4 -> 40) - dùng khi folder
    # video đánh số không liên tục (thiếu file giữa chừng) để tránh lệch vị
    # trí so với skip/limit thuần theo index.
    'video_number_range': None,  # (start, end) hoặc None để dùng skip/limit bên dưới
    'skip': 0,        # chỉ áp dụng khi video_number_range = None
    'limit': None,    # chỉ áp dụng khi video_number_range = None

    'delay_between_posts': 12,  # giây, nghỉ giữa các lần đăng để tránh bị TikTok flag spam

    # 'schedule' = lên lịch đăng thật, 'draft' = lưu bản nháp, 'dry_run' = làm hết
    # các bước NHƯNG KHÔNG bấm nút cuối - test an toàn trước khi chạy thật.
    'mode': 'dry_run',

    # Tuỳ chọn: trỏ vào 1 folder mà slice_grid_cover.py đã xuất ra (đặt tên
    # theo khoảng ngày, vd "grid_covers/2026-01-01_2026-01-03") để dùng ảnh
    # bìa Grid Layout - để None thì mỗi video tự cắt cover từ chính video.
    'cover_image_dir': None,
}


def list_videos(video_dir, pattern):
    videos = sorted(Path(video_dir).glob(pattern))
    if not videos:
        raise FileNotFoundError(f"Không tìm thấy video nào trong {video_dir} (pattern {pattern})")
    return videos


def select_by_number_range(videos, start, end):
    """Lọc theo đúng SỐ trong tên file (vd video_040.mp4 -> 40), không theo vị
    trí trong danh sách - tránh bị lệch khi folder thiếu file giữa chừng (vd
    còn 49 file nhưng số thứ tự nhảy cóc do đã xoá bớt video giữa chừng)."""
    numbered = []
    for v in videos:
        m = re.search(r'(\d+)(?=\.\w+$)', v.name)
        if m:
            numbered.append((int(m.group(1)), v))
    selected = [v for n, v in numbered if start <= n <= end]
    selected.sort(key=lambda v: int(re.search(r'(\d+)(?=\.\w+$)', v.name).group(1)))
    expected_count = end - start + 1
    if len(selected) != expected_count:
        found_nums = sorted(int(re.search(r'(\d+)(?=\.\w+$)', v.name).group(1)) for v in selected)
        missing = sorted(set(range(start, end + 1)) - set(found_nums))
        print(f"⚠ Yêu cầu video số {start}-{end} ({expected_count} video) nhưng chỉ tìm thấy "
              f"{len(selected)} - THIẾU số: {missing}")
    return selected


def build_schedule(start_date_str, daily_times, count):
    """Sinh danh sách (ngày, giờ) cho `count` video, N video/ngày = len(daily_times),
    theo đúng thứ tự thời gian tăng dần bắt đầu từ start_date_str."""
    start = date.fromisoformat(start_date_str)
    per_day = len(daily_times)
    slots = []
    for i in range(count):
        day_offset, slot = divmod(i, per_day)
        slots.append((str(start + timedelta(days=day_offset)), daily_times[slot]))
    return slots


def load_done_videos(state_json):
    """Danh sách video đã đăng THÀNH CÔNG (status success) từ lần chạy trước -
    để resume, bỏ qua không đăng lại. Video ở trạng thái 'dry_run'/'draft'/'failed'
    vẫn được xử lý lại ở lần chạy tiếp theo."""
    state_file = Path(state_json)
    if not state_file.exists():
        return set()
    try:
        state = json.loads(state_file.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, ValueError):
        # File rỗng/hỏng (vd tiến trình bị đóng đột ngột đúng lúc đang ghi) -
        # coi như chưa có video nào done, KHÔNG crash cả script vì lỗi này.
        print(f"⚠ {state_file} bị lỗi định dạng - coi như chưa đăng video nào (resume từ đầu)")
        return set()
    return {v for v, info in state.items() if info.get('status') == 'success'}


def build_jobs():
    videos = list_videos(BATCH['video_dir'], BATCH['video_glob'])
    if BATCH.get('video_number_range'):
        start, end = BATCH['video_number_range']
        videos = select_by_number_range(videos, start, end)
    else:
        videos = videos[BATCH['skip']:]
        if BATCH['limit']:
            videos = videos[:BATCH['limit']]

    schedule = build_schedule(BATCH['start_date'], BATCH['daily_times'], len(videos))

    cover_images = []
    if BATCH['cover_image_dir']:
        cover_images = sorted(Path(BATCH['cover_image_dir']).glob('*.jpg'))
        if len(cover_images) != len(videos):
            print(f"⚠ Số ảnh cover ({len(cover_images)}) khác số video ({len(videos)}) trong batch "
                  f"- các video dư sẽ dùng fallback cover_second (cắt frame từ video).")

    done = load_done_videos(CONFIG['state_json'])
    print(f"📋 {len(videos)} video tìm thấy ({len(done)} đã đăng thành công từ trước, sẽ bỏ qua)")

    jobs = []
    for i, video_path in enumerate(videos):
        if str(video_path) in done:
            continue
        schedule_date, schedule_time = schedule[i]
        cover_image_path = str(cover_images[i]) if i < len(cover_images) else None
        jobs.append(VideoJob(
            video_path=str(video_path),
            caption=CONFIG['caption'],
            hashtags=CONFIG['hashtags'],
            schedule_date=schedule_date,
            schedule_time=schedule_time,
            cover_image_path=cover_image_path,
            cover_second=CONFIG['cover_second'],
            product_id=CONFIG['product_id'],
            music_pick_range=CONFIG['music_pick_range'],
            music_volume_db=CONFIG['music_volume_db'],
            mode=BATCH['mode'],
        ))
    return jobs


def print_progress(event: dict):
    t = event['type']
    if t == 'fatal':
        print(f"❌ {event['message']}")
    elif t == 'video_start':
        print(f"\n{'=' * 70}\n[{event['index'] + 1}/{event['total']}] {event['video']}\n{'=' * 70}")
    elif t == 'step':
        print(f"  ✓ Xong bước: {event['step']}")
    elif t == 'video_done':
        if event['status'] == 'success':
            print(f"  ✅ Xong video {event['index'] + 1}/{event['total']}")
        else:
            print(f"  ❌ Lỗi video {event['index'] + 1}/{event['total']}: {event.get('error')}")
    elif t == 'batch_done':
        print(f"\n{'=' * 70}\n✅ XONG BATCH\n{'=' * 70}")


def main():
    jobs = build_jobs()
    if BATCH['mode'] == 'dry_run':
        print("⚠ DRY RUN - sẽ KHÔNG bấm nút đăng/lưu nháp thật, chỉ chạy thử toàn bộ flow")
    run_batch(jobs, on_progress=print_progress, delay_between_posts=BATCH['delay_between_posts'])


if __name__ == '__main__':
    main()
