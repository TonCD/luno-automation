"""
=============================================================================
BATCH ENGINE - lõi chạy nhiều video liên tiếp, dùng chung cho cả CLI
(bulk_upload.py) và desktop app (server.py).

KHÔNG viết lại logic đăng 1 video - toàn bộ hàm thật (upload_video_file,
set_caption, add_hashtags, set_cover, add_product_link, set_schedule,
add_music, publish, save_draft, log_result,...) vẫn nằm trong
tiktok_uploader.py. File này chỉ định nghĩa VideoJob (1 video cần xử lý,
không phụ thuộc CONFIG cứng) + run_batch() (vòng lặp + callback báo tiến độ)
để tầng trên (CLI hoặc API) có thể tái sử dụng mà không phải tự viết lại loop.
=============================================================================
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import tiktok_uploader as tk

ProgressCallback = Callable[[dict], None]


@dataclass
class VideoJob:
    video_path: str
    caption: str = ''
    hashtags: list[str] = field(default_factory=list)
    schedule_date: Optional[str] = None   # None (mode='schedule') => đăng "Bây giờ"
    schedule_time: Optional[str] = None
    cover_image_path: Optional[str] = None
    cover_second: int = 7
    product_id: Optional[str] = None
    product_display_name: Optional[str] = None  # None = giữ tên mặc định trên TikTok
    add_music: bool = True
    music_pick_range: tuple[int, int] = (1, 8)
    music_volume_db: int = -20
    mode: str = 'schedule'  # 'schedule' | 'draft'


def _noop(_event: dict):
    pass


def run_batch(
    jobs: list[VideoJob],
    on_progress: ProgressCallback = _noop,
    delay_between_posts: int = 12,
):
    """Chạy tuần tự nhiều video trong CÙNG 1 browser session (không mở mới cho
    từng video - tránh tutorial popup lặp lại + khỏi login lại, xem
    TIKTOK_UPLOAD_PLAN.md mục Phase 2). Gọi on_progress(event) sau mỗi bước để
    tầng trên (WebSocket, CLI print,...) tự quyết định hiển thị ra sao."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser, context = tk.ensure_login(p)
        page = context.new_page()

        page.goto(tk.CONFIG['upload_url'], timeout=tk.CONFIG['timeout'])
        if not tk.check_login(page):
            on_progress({'type': 'fatal', 'message': 'Cookie hết hạn/sai - cần dán cookie mới.'})
            browser.close()
            return
        tk.save_session_state(context)

        total = len(jobs)
        for i, job in enumerate(jobs):
            on_progress({'type': 'video_start', 'index': i, 'total': total, 'video': job.video_path})

            try:
                # Thêm tham số đổi mỗi lần vào URL - ép trình duyệt coi đây là
                # điều hướng HOÀN TOÀN MỚI, tránh khả năng TikTok Studio (SPA)
                # giữ lại state JS (caption, video đang chọn,...) của video
                # trước đó khi goto() lại đúng 1 URL giống hệt nhau liên tục.
                fresh_url = f"{tk.CONFIG['upload_url']}&_r={int(time.time() * 1000)}"
                page.goto(fresh_url, timeout=tk.CONFIG['timeout'])
                tk.upload_video_file(page, job.video_path)
                on_progress({'type': 'step', 'index': i, 'step': 'upload'})

                tk.set_caption(page, job.caption)
                on_progress({'type': 'step', 'index': i, 'step': 'caption'})

                if job.hashtags:
                    tk.add_hashtags(page, job.hashtags)
                    on_progress({'type': 'step', 'index': i, 'step': 'hashtags'})

                tk.set_cover(page, job.video_path, job.cover_second, job.cover_image_path)
                on_progress({'type': 'step', 'index': i, 'step': 'cover'})

                if job.product_id:
                    tk.add_product_link(page, job.product_id, job.product_display_name)
                    on_progress({'type': 'step', 'index': i, 'step': 'product_link'})

                if job.mode not in ('draft', 'dry_run'):
                    tk.set_schedule(page, job.schedule_date, job.schedule_time)
                    on_progress({'type': 'step', 'index': i, 'step': 'schedule'})

                if job.add_music:
                    tk.add_music(page, job.music_pick_range, job.music_volume_db)
                    on_progress({'type': 'step', 'index': i, 'step': 'music'})

                # log_result() đọc từ CONFIG - cập nhật trước khi gọi để log đúng giá trị video này
                tk.CONFIG['schedule_date'] = job.schedule_date
                tk.CONFIG['schedule_time'] = job.schedule_time
                tk.CONFIG['product_id'] = job.product_id
                tk.CONFIG['cover_second'] = job.cover_second

                if job.mode == 'dry_run':
                    # Làm hết các bước NHƯNG KHÔNG bấm nút đăng/lưu nháp cuối cùng -
                    # dùng để test an toàn cả batch trước khi chạy thật.
                    tk.log_result(job.video_path, 'dry_run')
                elif job.mode == 'draft':
                    tk.save_draft(page)
                    tk.log_result(job.video_path, 'draft')
                else:
                    tk.publish(page)
                    tk.log_result(job.video_path, 'success')

                on_progress({
                    'type': 'video_done', 'index': i, 'total': total,
                    'video': job.video_path, 'status': 'success',
                })

            except Exception as e:
                tk.log_result(job.video_path, 'failed', error=str(e))
                on_progress({
                    'type': 'video_done', 'index': i, 'total': total,
                    'video': job.video_path, 'status': 'failed', 'error': str(e),
                })

            time.sleep(delay_between_posts)

        browser.close()

    on_progress({'type': 'batch_done'})
