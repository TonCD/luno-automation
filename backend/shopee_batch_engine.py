"""
=============================================================================
SHOPEE BATCH ENGINE - tương tự batch_engine.py (TikTok): lõi chạy nhiều video
Shopee liên tiếp trong CÙNG 1 browser session, dùng chung cho backend app.

KHÔNG viết lại logic đăng 1 video - toàn bộ hàm thật nằm trong
shopee_uploader.py. File này chỉ định nghĩa ShopeeVideoJob (1 video cần xử lý)
+ run_batch() (vòng lặp + callback báo tiến độ).
=============================================================================
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import shopee_uploader as sp

ProgressCallback = Callable[[dict], None]


@dataclass
class ShopeeVideoJob:
    video_path: str
    caption: str = ''
    hashtags: list[str] = field(default_factory=list)
    schedule_date: Optional[str] = None   # None (mode='schedule') => đăng "Bây giờ"
    schedule_time: Optional[str] = None
    cover_ratio: float = 0.1
    product_query: str = ''
    product_id: Optional[str] = None
    mode: str = 'schedule'  # 'schedule' | 'draft' | 'dry_run'


def _noop(_event: dict):
    pass


def run_batch(
    jobs: list[ShopeeVideoJob],
    on_progress: ProgressCallback = _noop,
    delay_between_posts: int = 12,
):
    """Chạy tuần tự nhiều video Shopee trong CÙNG 1 browser session, mỗi vòng
    lặp goto() lại trang upload (giống hệt lý do TikTok: tránh popup/hành vi
    lạ khi giữ nguyên state cũ, và khỏi phải login lại)."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser, context = sp.ensure_login(p)
        page = context.new_page()

        page.goto(sp.CONFIG['upload_url'], timeout=sp.CONFIG['timeout'])
        if not sp.check_login(page):
            on_progress({'type': 'fatal', 'message': 'Cookie hết hạn/sai - cần dán cookie mới.'})
            browser.close()
            return
        sp.save_session_state(context)

        total = len(jobs)
        for i, job in enumerate(jobs):
            on_progress({'type': 'video_start', 'index': i, 'total': total, 'video': job.video_path})

            try:
                fresh_url = f"{sp.CONFIG['upload_url']}?_r={int(time.time() * 1000)}"
                page.goto(fresh_url, timeout=sp.CONFIG['timeout'])
                sp.upload_video_file(page, job.video_path)
                on_progress({'type': 'step', 'index': i, 'step': 'upload'})

                sp.set_caption(page, job.caption)
                on_progress({'type': 'step', 'index': i, 'step': 'caption'})

                if job.hashtags:
                    sp.add_hashtags(page, job.hashtags)
                    on_progress({'type': 'step', 'index': i, 'step': 'hashtags'})

                sp.set_cover(page, job.cover_ratio)
                on_progress({'type': 'step', 'index': i, 'step': 'cover'})

                if job.product_query:
                    sp.add_product_link(page, job.product_query, job.product_id)
                    on_progress({'type': 'step', 'index': i, 'step': 'product_link'})

                if job.mode not in ('draft', 'dry_run'):
                    sp.set_schedule(page, job.schedule_date, job.schedule_time)
                    on_progress({'type': 'step', 'index': i, 'step': 'schedule'})

                sp.CONFIG['schedule_date'] = job.schedule_date
                sp.CONFIG['schedule_time'] = job.schedule_time
                sp.CONFIG['product_query'] = job.product_query
                sp.CONFIG['product_id'] = job.product_id
                sp.CONFIG['cover_ratio'] = job.cover_ratio

                if job.mode == 'dry_run':
                    sp.log_result(job.video_path, 'dry_run')
                elif job.mode == 'draft':
                    sp.save_draft(page)
                    sp.log_result(job.video_path, 'draft')
                else:
                    sp.publish(page)
                    sp.log_result(job.video_path, 'success')

                on_progress({
                    'type': 'video_done', 'index': i, 'total': total,
                    'video': job.video_path, 'status': 'success',
                })

            except Exception as e:
                try:
                    shot_path = sp.BASE_DIR / f'shopee_debug_error_{i}.png'
                    page.screenshot(path=str(shot_path), full_page=True)
                except Exception:
                    pass
                sp.log_result(job.video_path, 'failed', error=str(e))
                on_progress({
                    'type': 'video_done', 'index': i, 'total': total,
                    'video': job.video_path, 'status': 'failed', 'error': str(e),
                })

            time.sleep(delay_between_posts)

        browser.close()

    on_progress({'type': 'batch_done'})
