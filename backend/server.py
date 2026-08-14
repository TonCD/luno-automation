"""
Backend cho desktop app LUNO Automation - FastAPI server chạy local, Electron
tự spawn tiến trình này khi mở app (xem frontend/electron/main.cjs).

Toàn bộ logic automation (Playwright, cắt ảnh grid, sinh lịch,...) tái sử dụng
từ tiktok_uploader.py / batch_engine.py / shopee_uploader.py /
shopee_batch_engine.py / slice_grid_cover.py - các module NẰM CÙNG THƯ MỤC
(backend/) nên import thẳng, không cần chỉnh sys.path. server.py chỉ là lớp
API mỏng để UI (React) gọi vào, KHÔNG viết lại logic automation.

App chỉ bind 127.0.0.1 (không lộ ra mạng ngoài) nên các endpoint đọc/ghi file
theo đường dẫn tuyệt đối do chính Electron (dialog chọn file/folder) cung cấp
là chấp nhận được - cùng mức tin cậy như bản thân desktop app đã có toàn quyền
truy cập hệ thống.
"""

import json
import queue
import re
import shutil
import threading
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import tiktok_uploader as tk
from batch_engine import VideoJob, run_batch

import shopee_uploader as sp
from shopee_batch_engine import ShopeeVideoJob, run_batch as run_shopee_batch

app = FastAPI(title="LUNO Automation Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TIKTOK_MAX_SCHEDULED = 30   # giới hạn cứng của TikTok
TIKTOK_MAX_DAYS_AHEAD = 30  # chỉ lên lịch được trong vòng 1 tháng tới


@app.get("/health")
def health():
    return {"status": "ok"}


# ==================== CÀI ĐẶT GIÁ TRỊ MẶC ĐỊNH (user tự đổi qua UI) ====================
# CONFIG gốc trong tiktok_uploader.py/shopee_uploader.py là giá trị mặc định
# viết cứng trong code (đang nghiêng về brand máy sấy tóc LUNO - xem
# README.md mục "Giá trị mặc định"). Thay vì bắt user sửa trực tiếp code Python
# mỗi lần muốn đổi caption/ID sản phẩm/dB nhạc mặc định, lưu phần user tự đổi
# ra 2 file riêng (không commit git - xem .gitignore), áp dụng đè lên CONFIG
# mỗi khi backend khởi động.

TIKTOK_SETTINGS_FILE = tk.BASE_DIR / 'tiktok_user_settings.json'
SHOPEE_SETTINGS_FILE = sp.BASE_DIR / 'shopee_user_settings.json'

# delay_between_posts không phải field có sẵn trong CONFIG (chỉ là hằng số
# 12 viết cứng ở nhiều nơi) - lưu riêng ở đây thay vì thêm vào CONFIG để
# không phải sửa tiktok_uploader.py/shopee_uploader.py chỉ vì 1 field UI.
_extra_defaults = {'tiktok_delay_between_posts': 12, 'shopee_delay_between_posts': 12}


def _load_settings_file(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, ValueError):
        return {}


def _apply_saved_settings():
    tk_saved = _load_settings_file(TIKTOK_SETTINGS_FILE)
    for key in ('caption', 'hashtags', 'product_id', 'cover_second', 'music_volume_db'):
        if key in tk_saved:
            tk.CONFIG[key] = tk_saved[key]
    if 'delay_between_posts' in tk_saved:
        _extra_defaults['tiktok_delay_between_posts'] = tk_saved['delay_between_posts']

    sp_saved = _load_settings_file(SHOPEE_SETTINGS_FILE)
    for key in ('caption', 'hashtags', 'product_query', 'cover_ratio'):
        if key in sp_saved:
            sp.CONFIG[key] = sp_saved[key]
    if 'delay_between_posts' in sp_saved:
        _extra_defaults['shopee_delay_between_posts'] = sp_saved['delay_between_posts']


_apply_saved_settings()  # chạy 1 lần lúc backend khởi động


@app.get("/config/defaults")
def config_defaults():
    """Giá trị mặc định lấy từ CONFIG trong tiktok_uploader.py - 1 nguồn duy
    nhất, tránh trùng lặp giữa Python và frontend. Đã áp dụng phần user tự
    đổi qua "Cài đặt mặc định" (nếu có) đè lên giá trị gốc trong code."""
    return {
        "caption": tk.CONFIG["caption"],
        "hashtags": tk.CONFIG["hashtags"],
        "product_id": tk.CONFIG["product_id"],
        "cover_second": tk.CONFIG["cover_second"],
        "music_volume_db": tk.CONFIG["music_volume_db"],
        "delay_between_posts": _extra_defaults['tiktok_delay_between_posts'],
    }


class TiktokDefaultsUpdate(BaseModel):
    caption: Optional[str] = None
    hashtags: Optional[list[str]] = None
    product_id: Optional[str] = None
    cover_second: Optional[int] = None
    music_volume_db: Optional[int] = None
    delay_between_posts: Optional[int] = None


@app.post("/config/defaults")
def update_config_defaults(body: TiktokDefaultsUpdate):
    """Lưu lại giá trị mặc định user tự chỉnh (chỉ ghi đè field nào có gửi
    lên) - áp dụng ngay, và còn nguyên sau khi restart app."""
    saved = _load_settings_file(TIKTOK_SETTINGS_FILE)
    saved.update(body.model_dump(exclude_none=True))
    TIKTOK_SETTINGS_FILE.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding='utf-8')
    _apply_saved_settings()
    return config_defaults()


# ==================== SESSION / TÀI KHOẢN (đa tài khoản, tối đa MAX_ACCOUNTS) ====================
# Mỗi tài khoản lưu riêng 1 folder accounts/<id>/ chứa cookie.txt (dán từ F12,
# chỉ cần lúc chưa có session) + session.json (storage_state đầy đủ, tự sinh
# sau lần chạy batch đầu thành công). "active_id" trong registry.json quyết
# định tài khoản nào đang được dùng - trước mỗi thao tác cần session, gọi
# _apply_active_account() để trỏ tk.CONFIG['cookie_file']/['session_state_file']
# đúng vào tài khoản đang active (tiktok_uploader.py không cần sửa gì thêm).

ACCOUNTS_DIR = tk.BASE_DIR / 'accounts'
ACCOUNTS_REGISTRY = ACCOUNTS_DIR / 'registry.json'
MAX_ACCOUNTS = 3


def _load_registry() -> dict:
    if not ACCOUNTS_REGISTRY.exists():
        return {"accounts": [], "active_id": None}
    try:
        return json.loads(ACCOUNTS_REGISTRY.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, ValueError):
        # File rỗng/hỏng (vd app từng bị đóng đột ngột đúng lúc đang ghi) -
        # coi như chưa có tài khoản nào thay vì crash toàn bộ app. Không mất
        # dữ liệu account thật (cookie.txt/session.json từng account vẫn còn
        # nguyên trong accounts/<id>/, chỉ registry liệt kê bị hỏng).
        return {"accounts": [], "active_id": None}


def _save_registry(reg: dict):
    ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
    ACCOUNTS_REGISTRY.write_text(json.dumps(reg, ensure_ascii=False, indent=2), encoding='utf-8')


def _migrate_legacy_session_if_needed() -> dict:
    """Trước khi có multi-account, app chỉ dùng 1 cookie/session cố định ở
    BASE_DIR (tiktok_cookie.txt/tiktok_session_state.json). Nếu registry chưa
    có tài khoản nào mà 2 file cũ đó đang tồn tại (đã login từ trước) - tự
    chuyển thành "Tài khoản 1" để không mất session đã đăng nhập sẵn."""
    reg = _load_registry()
    if reg['accounts']:
        return reg

    legacy_session = tk.BASE_DIR / 'tiktok_session_state.json'
    legacy_cookie = tk.BASE_DIR / 'tiktok_cookie.txt'
    if not legacy_session.exists() and not legacy_cookie.exists():
        return reg

    acc_id = uuid.uuid4().hex[:8]
    acc_dir = ACCOUNTS_DIR / acc_id
    acc_dir.mkdir(parents=True, exist_ok=True)
    if legacy_session.exists():
        shutil.copy2(legacy_session, acc_dir / 'session.json')
    if legacy_cookie.exists():
        shutil.copy2(legacy_cookie, acc_dir / 'cookie.txt')

    reg['accounts'].append({
        'id': acc_id,
        'label': 'Tài khoản 1',
        'saved_at': datetime.now().isoformat(timespec='seconds'),
    })
    reg['active_id'] = acc_id
    _save_registry(reg)
    return reg


def _apply_active_account() -> Optional[str]:
    """Trỏ tk.CONFIG['cookie_file']/['session_state_file'] vào đúng tài khoản
    đang active. Gọi hàm này TRƯỚC MỌI thao tác cần session (check status,
    chạy batch) - phải gọi lại mỗi lần vì user có thể đổi active account giữa
    các lần.

    Đồng thời set tk.CONFIG['account_id']/['account_label'] - CHỈ để
    log_result() ghi vào log/state biết video vừa đăng qua tài khoản nào (hữu
    ích khi có nhiều tài khoản), không ảnh hưởng gì tới việc đăng nhập."""
    reg = _migrate_legacy_session_if_needed()
    active_id = reg.get('active_id')
    if not active_id:
        return None
    acc_dir = ACCOUNTS_DIR / active_id
    tk.CONFIG['cookie_file'] = acc_dir / 'cookie.txt'
    tk.CONFIG['session_state_file'] = acc_dir / 'session.json'
    tk.CONFIG['account_id'] = active_id
    tk.CONFIG['account_label'] = next(
        (a['label'] for a in reg['accounts'] if a['id'] == active_id), None
    )
    return active_id


class AccountSaveBody(BaseModel):
    cookie: str
    label: str = ""


class AccountActivateBody(BaseModel):
    id: str


@app.get("/accounts")
def list_accounts():
    return _migrate_legacy_session_if_needed()


@app.post("/accounts")
def save_account(body: AccountSaveBody):
    cookie = body.cookie.strip()
    if not cookie or '=' not in cookie:
        raise HTTPException(400, "Chuỗi cookie không hợp lệ (thiếu dấu '=')")

    reg = _migrate_legacy_session_if_needed()

    acc_id = uuid.uuid4().hex[:8]
    acc_dir = ACCOUNTS_DIR / acc_id
    acc_dir.mkdir(parents=True, exist_ok=True)
    (acc_dir / 'cookie.txt').write_text(cookie, encoding='utf-8')
    # Cookie mới hoàn toàn -> chưa có session.json, sẽ tự sinh sau khi chạy
    # batch thành công lần đầu (giống hệt cơ chế cũ, chỉ khác là theo từng tài khoản)

    label = body.label.strip() or f"Tài khoản {len(reg['accounts']) + 1}"
    reg['accounts'].append({
        'id': acc_id,
        'label': label,
        'saved_at': datetime.now().isoformat(timespec='seconds'),
    })

    # Giới hạn tối đa MAX_ACCOUNTS - vượt quá thì xoá tài khoản CŨ NHẤT
    if len(reg['accounts']) > MAX_ACCOUNTS:
        reg['accounts'].sort(key=lambda a: a['saved_at'])
        oldest = reg['accounts'].pop(0)
        shutil.rmtree(ACCOUNTS_DIR / oldest['id'], ignore_errors=True)

    reg['active_id'] = acc_id
    _save_registry(reg)
    return {"status": "saved", "id": acc_id}


@app.post("/accounts/activate")
def activate_account(body: AccountActivateBody):
    reg = _load_registry()
    if not any(a['id'] == body.id for a in reg['accounts']):
        raise HTTPException(404, "Không tìm thấy tài khoản")
    reg['active_id'] = body.id
    _save_registry(reg)
    return {"status": "ok"}


@app.get("/session/status")
def session_status():
    _apply_active_account()
    has_session = Path(tk.CONFIG['session_state_file']).exists()
    has_cookie = Path(tk.CONFIG['cookie_file']).exists()
    return {"has_session": has_session, "has_cookie": has_cookie}


@app.get("/today")
def today_info():
    """Ngày hôm nay + ngày xa nhất có thể lên lịch (giới hạn 30 ngày của TikTok),
    và ước tính số video đang lên lịch (dựa vào state_json - CHỈ LÀ ƯỚC TÍNH, vì
    app không có cách nào query trực tiếp TikTok xem đã đăng thật hay chưa)."""
    t = date.today()
    max_date = t + timedelta(days=TIKTOK_MAX_DAYS_AHEAD)

    estimated_scheduled = 0
    state_file = Path(tk.CONFIG['state_json'])
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, ValueError):
            # File rỗng/hỏng (vd app từng bị đóng đột ngột đúng lúc đang ghi) -
            # coi như chưa ước tính được gì, không crash cả endpoint /today.
            state = {}
        for info in state.values():
            if info.get('status') != 'success':
                continue
            sd = info.get('schedule_date')
            if sd and date.fromisoformat(sd) >= t:
                estimated_scheduled += 1

    return {
        "today": str(t),
        "max_schedule_date": str(max_date),
        "max_scheduled_allowed": TIKTOK_MAX_SCHEDULED,
        "estimated_currently_scheduled": estimated_scheduled,
        "estimated_remaining_slots": max(0, TIKTOK_MAX_SCHEDULED - estimated_scheduled),
        "estimate_source": "tiktok_upload_state.json",
        "estimate_note": (
            "Ước tính dựa trên lịch sử app đã đăng (tiktok_upload_state.json), KHÔNG phải số liệu "
            "trực tiếp từ TikTok - nếu bạn xoá video đã lên lịch thủ công trên TikTok, hoặc chỉnh "
            "sửa/xoá file này, số liệu sẽ không còn khớp thực tế."
        ),
    }


@app.get("/state")
def tiktok_state():
    """Trả về nội dung tiktok_upload_state.json (video_path -> {status,...}) -
    mirror /shopee/state, dùng để UI biết video nào ĐÃ đăng thành công thật khi
    cần khôi phục lại 1 batch dở dang sau khi app phải restart giữa chừng."""
    state_file = Path(tk.CONFIG['state_json'])
    if not state_file.exists():
        return {}
    try:
        return json.loads(state_file.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, ValueError):
        return {}


# ==================== BATCH DRAFT (lưu tạm batch TikTok đang chỉnh) ====================
# Lưu ra file trên đĩa qua backend (không dùng localStorage của trình duyệt -
# xem TIKTOK_UPLOAD_PLAN.md mục Shopee để biết lý do đầy đủ) - mirror hệt
# /shopee/draft, chỉ khác file lưu riêng cho TikTok.

TIKTOK_DRAFT_FILE = tk.BASE_DIR / 'tiktok_batch_draft.json'


@app.get("/draft")
def get_draft():
    if not TIKTOK_DRAFT_FILE.exists():
        return None
    try:
        return json.loads(TIKTOK_DRAFT_FILE.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, ValueError):
        return None


@app.post("/draft")
def save_draft(body: dict):
    TIKTOK_DRAFT_FILE.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding='utf-8')
    return {"status": "saved"}


@app.delete("/draft")
def clear_draft():
    if TIKTOK_DRAFT_FILE.exists():
        TIKTOK_DRAFT_FILE.unlink()
    return {"status": "cleared"}


# ==================== VIDEOS ====================

_NUM_RE = re.compile(r'(\d+)(?=\.\w+$)')

# Định dạng video TikTok chấp nhận upload (web) - không chỉ .mp4. Tìm không
# phân biệt hoa/thường (Windows filesystem vốn đã không phân biệt).
VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v', 'mpeg', 'mpg', 'flv']


def _video_info_entry(v: Path, include_duration: bool) -> dict:
    """1 video -> {number, filename, path, duration_sec?} - dùng chung cho cả
    liệt kê theo folder (/videos) lẫn chọn tay từng file (/videos/by-paths)."""
    m = _NUM_RE.search(v.name)
    num = int(m.group(1)) if m else None
    entry = {"number": num, "filename": v.name, "path": str(v)}
    if include_duration:
        # Chỉ dùng cho Shopee (chọn ảnh bìa theo giây thay vì % thủ công) -
        # ffprobe từng file có chi phí, nên mặc định TẮT (TikTok không cần).
        try:
            entry["duration_sec"] = sp.get_video_duration(v)
        except Exception:
            entry["duration_sec"] = None
    return entry


@app.get("/videos")
def list_videos(
    dir: str,
    start: Optional[int] = None,
    end: Optional[int] = None,
    include_duration: bool = False,
):
    folder = Path(dir)
    if not folder.is_dir():
        raise HTTPException(400, f"Không tìm thấy folder: {dir}")

    videos = sorted(
        {v for ext in VIDEO_EXTENSIONS for v in folder.glob(f'*.{ext}')},
        key=lambda p: p.name,
    )
    result = []
    for v in videos:
        m = _NUM_RE.search(v.name)
        num = int(m.group(1)) if m else None
        if start is not None and (num is None or num < start):
            continue
        if end is not None and (num is None or num > end):
            continue
        result.append(_video_info_entry(v, include_duration))

    result.sort(key=lambda x: (x["number"] is None, x["number"]))

    missing = []
    if start is not None and end is not None:
        found_nums = {r["number"] for r in result}
        missing = sorted(set(range(start, end + 1)) - found_nums)

    return {"videos": result, "count": len(result), "missing_numbers": missing}


class VideosByPathsBody(BaseModel):
    paths: list[str]
    include_duration: bool = False


@app.post("/videos/by-paths")
def videos_by_paths(body: VideosByPathsBody):
    """Cách chọn video thứ 2: user tự duyệt & chọn tuỳ ý qua dialog hệ thống
    (không theo dải số/folder như /videos) - nhận thẳng danh sách đường dẫn đã
    chọn, trả về đúng shape VideoInfo như /videos để dùng chung UI phía sau."""
    result = []
    for p in body.paths:
        path = Path(p)
        if not path.is_file():
            continue
        result.append(_video_info_entry(path, body.include_duration))
    result.sort(key=lambda x: (x["number"] is None, x["number"], x["filename"]))
    return {"videos": result, "count": len(result)}


# ==================== GRID COVER SLICE ====================

class GridSliceBody(BaseModel):
    image_path: str
    video_count: int
    batch_name: str = "batch"


@app.post("/grid/slice")
def grid_slice(body: GridSliceBody):
    if body.video_count % 3 != 0:
        raise HTTPException(400, f"Số video ({body.video_count}) phải là bội số của 3 để chia đúng lưới 3 cột")
    if not Path(body.image_path).exists():
        raise HTTPException(400, f"Không tìm thấy ảnh: {body.image_path}")

    from slice_grid_cover import get_image_size, crop_cell, resolve_binary  # noqa: F401

    cols, rows = 3, body.video_count // 3
    width, height = get_image_size(body.image_path)

    out_dir = tk.BASE_DIR / 'grid_covers' / body.batch_name
    out_dir.mkdir(parents=True, exist_ok=True)

    xs = [round(width * c / cols) for c in range(cols + 1)]
    ys = [round(height * r / rows) for r in range(rows + 1)]

    pieces = [None] * body.video_count
    for row in range(rows):
        for col in range(cols):
            piece_no = row * cols + col + 1  # 1 = trên-trái, theo thứ tự đọc ảnh
            x, cell_w = xs[col], xs[col + 1] - xs[col]
            y, cell_h = ys[row], ys[row + 1] - ys[row]
            out_path = out_dir / f"piece_{piece_no:02d}.jpg"
            crop_cell(body.image_path, out_path, x, y, cell_w, cell_h)
            pieces[piece_no - 1] = str(out_path)

    return {"pieces": pieces, "cols": cols, "rows": rows}


@app.get("/files/raw")
def files_raw(path: str):
    """Trả về nội dung 1 file local theo đường dẫn tuyệt đối - dùng để preview
    ảnh (source image, cover đã cắt) trên UI qua thẻ <img>."""
    p = Path(path)
    if not p.is_file():
        raise HTTPException(404, "File không tồn tại")
    return FileResponse(p)


# ==================== BATCH RUN ====================

class JobIn(BaseModel):
    video_path: str
    caption: str = ""
    hashtags: list[str] = []
    schedule_date: Optional[str] = None
    schedule_time: Optional[str] = None
    cover_image_path: Optional[str] = None
    cover_second: int = 7
    product_id: Optional[str] = None
    product_display_name: Optional[str] = None
    add_music: bool = True
    music_pick_range: tuple[int, int] = (1, 8)
    music_volume_db: int = -20


class BatchRunBody(BaseModel):
    mode: str = "schedule"  # 'schedule' | 'draft' | 'dry_run'
    delay_between_posts: int = 12
    jobs: list[JobIn]


# batch_id -> Queue chứa các event tiến độ (dict) do worker thread đẩy vào
_batches: dict[str, "queue.Queue"] = {}


def _run_batch_worker(batch_id: str, body: BatchRunBody):
    q = _batches[batch_id]

    def on_progress(event: dict):
        q.put(event)

    jobs = [
        VideoJob(
            video_path=j.video_path,
            caption=j.caption,
            hashtags=j.hashtags,
            schedule_date=j.schedule_date,
            schedule_time=j.schedule_time,
            cover_image_path=j.cover_image_path,
            cover_second=j.cover_second,
            product_id=j.product_id,
            product_display_name=j.product_display_name,
            add_music=j.add_music,
            music_pick_range=j.music_pick_range,
            music_volume_db=j.music_volume_db,
            mode=body.mode,
        )
        for j in body.jobs
    ]

    try:
        run_batch(jobs, on_progress=on_progress, delay_between_posts=body.delay_between_posts)
    except Exception as e:  # noqa: BLE001 - báo lỗi bất kỳ về cho UI thay vì làm chết thread âm thầm
        q.put({"type": "fatal", "message": str(e)})
    finally:
        q.put({"type": "__end__"})


@app.post("/batch/run")
def batch_run(body: BatchRunBody):
    if not body.jobs:
        raise HTTPException(400, "Danh sách video rỗng")

    # Trỏ đúng cookie/session của tài khoản đang active TRƯỚC khi spawn thread
    # chạy Playwright - phải làm ở request thread (đồng bộ) để chắc chắn xong
    # trước khi worker thread bắt đầu đọc tk.CONFIG.
    if not _apply_active_account():
        raise HTTPException(400, "Chưa có tài khoản nào được lưu - vào bước Đăng nhập thêm tài khoản trước.")

    batch_id = str(uuid.uuid4())
    _batches[batch_id] = queue.Queue()

    # Playwright (sync API) cần chạy trong thread riêng - không thể chạy trực
    # tiếp trong event loop async của FastAPI (sẽ block toàn bộ server).
    thread = threading.Thread(target=_run_batch_worker, args=(batch_id, body), daemon=True)
    thread.start()

    return {"batch_id": batch_id}


@app.websocket("/ws/batch/{batch_id}")
async def ws_batch_progress(websocket: WebSocket, batch_id: str):
    await websocket.accept()
    q = _batches.get(batch_id)
    if q is None:
        await websocket.send_json({"type": "fatal", "message": "batch_id không tồn tại"})
        await websocket.close()
        return

    try:
        import asyncio
        while True:
            event = await asyncio.to_thread(q.get)
            if event.get("type") == "__end__":
                break
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        _batches.pop(batch_id, None)
        try:
            await websocket.close()
        except Exception:
            pass


# ==================== SHOPEE (song song với TikTok ở trên, KHÔNG dùng chung
# account/registry để tránh đụng vào code TikTok đã test - xem
# TIKTOK_UPLOAD_PLAN.md mục "Shopee" để biết toàn bộ khác biệt so với TikTok) ====================

SHOPEE_ACCOUNTS_DIR = sp.BASE_DIR / 'shopee_accounts'
SHOPEE_ACCOUNTS_REGISTRY = SHOPEE_ACCOUNTS_DIR / 'registry.json'


def _shopee_load_registry() -> dict:
    if not SHOPEE_ACCOUNTS_REGISTRY.exists():
        return {"accounts": [], "active_id": None}
    try:
        return json.loads(SHOPEE_ACCOUNTS_REGISTRY.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, ValueError):
        # Cùng lý do như _load_registry() (TikTok) ở trên - file registry hỏng
        # không nên làm mất cookie/session thật của từng account (vẫn còn
        # nguyên trong shopee_accounts/<id>/).
        return {"accounts": [], "active_id": None}


def _shopee_save_registry(reg: dict):
    SHOPEE_ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
    SHOPEE_ACCOUNTS_REGISTRY.write_text(json.dumps(reg, ensure_ascii=False, indent=2), encoding='utf-8')


def _shopee_apply_active_account() -> Optional[str]:
    reg = _shopee_load_registry()
    active_id = reg.get('active_id')
    if not active_id:
        return None
    acc_dir = SHOPEE_ACCOUNTS_DIR / active_id
    sp.CONFIG['cookie_file'] = acc_dir / 'cookie.txt'
    sp.CONFIG['session_state_file'] = acc_dir / 'session.json'
    sp.CONFIG['account_id'] = active_id
    sp.CONFIG['account_label'] = next(
        (a['label'] for a in reg['accounts'] if a['id'] == active_id), None
    )
    return active_id


@app.get("/shopee/config/defaults")
def shopee_config_defaults():
    return {
        "caption": sp.CONFIG["caption"],
        "hashtags": sp.CONFIG["hashtags"],
        "product_query": sp.CONFIG["product_query"],
        "cover_ratio": sp.CONFIG["cover_ratio"],
        "delay_between_posts": _extra_defaults['shopee_delay_between_posts'],
    }


class ShopeeDefaultsUpdate(BaseModel):
    caption: Optional[str] = None
    hashtags: Optional[list[str]] = None
    product_query: Optional[str] = None
    cover_ratio: Optional[float] = None
    delay_between_posts: Optional[int] = None


@app.post("/shopee/config/defaults")
def update_shopee_config_defaults(body: ShopeeDefaultsUpdate):
    saved = _load_settings_file(SHOPEE_SETTINGS_FILE)
    saved.update(body.model_dump(exclude_none=True))
    SHOPEE_SETTINGS_FILE.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding='utf-8')
    _apply_saved_settings()
    return shopee_config_defaults()


@app.get("/shopee/accounts")
def shopee_list_accounts():
    return _shopee_load_registry()


@app.post("/shopee/accounts")
def shopee_save_account(body: AccountSaveBody):
    cookie = body.cookie.strip()
    if not cookie or '=' not in cookie:
        raise HTTPException(400, "Chuỗi cookie không hợp lệ (thiếu dấu '=')")

    reg = _shopee_load_registry()

    acc_id = uuid.uuid4().hex[:8]
    acc_dir = SHOPEE_ACCOUNTS_DIR / acc_id
    acc_dir.mkdir(parents=True, exist_ok=True)
    (acc_dir / 'cookie.txt').write_text(cookie, encoding='utf-8')

    label = body.label.strip() or f"Tài khoản {len(reg['accounts']) + 1}"
    reg['accounts'].append({
        'id': acc_id,
        'label': label,
        'saved_at': datetime.now().isoformat(timespec='seconds'),
    })

    if len(reg['accounts']) > MAX_ACCOUNTS:
        reg['accounts'].sort(key=lambda a: a['saved_at'])
        oldest = reg['accounts'].pop(0)
        shutil.rmtree(SHOPEE_ACCOUNTS_DIR / oldest['id'], ignore_errors=True)

    reg['active_id'] = acc_id
    _shopee_save_registry(reg)
    return {"status": "saved", "id": acc_id}


@app.post("/shopee/accounts/activate")
def shopee_activate_account(body: AccountActivateBody):
    reg = _shopee_load_registry()
    if not any(a['id'] == body.id for a in reg['accounts']):
        raise HTTPException(404, "Không tìm thấy tài khoản")
    reg['active_id'] = body.id
    _shopee_save_registry(reg)
    return {"status": "ok"}


@app.get("/shopee/session/status")
def shopee_session_status():
    _shopee_apply_active_account()
    has_session = Path(sp.CONFIG['session_state_file']).exists()
    has_cookie = Path(sp.CONFIG['cookie_file']).exists()
    return {"has_session": has_session, "has_cookie": has_cookie}


@app.get("/shopee/state")
def shopee_state():
    """Trả về nội dung shopee_upload_state.json (video_path -> {status,...}) -
    dùng để UI biết video nào ĐÃ đăng thành công thật (ghi ra đĩa, sống sót qua
    lần restart app) khi cần khôi phục lại 1 batch dở dang sau khi app phải
    restart để nhận code backend mới (vd sau khi sửa lỗi giữa chừng batch)."""
    state_file = Path(sp.CONFIG['state_json'])
    if not state_file.exists():
        return {}
    try:
        return json.loads(state_file.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, ValueError):
        # File rỗng/hỏng (vd app từng bị đóng đột ngột đúng lúc đang ghi) -
        # trả về rỗng thay vì lỗi 500, không có gì để đối chiếu là hợp lý.
        return {}


# ==================== SHOPEE BATCH DRAFT (lưu tạm batch đang chỉnh) ====================
# Lưu ra FILE trên đĩa thay vì localStorage của trình duyệt - localStorage
# từng được thử trước nhưng không đáng tin cậy để khôi phục sau khi restart
# nguyên cụm Electron+Vite dev (StrictMode double-effect, session/origin của
# Electron dev có thể không ổn định giữa các lần mở app). File trên đĩa không
# phụ thuộc gì vào trình duyệt/Electron, giống hệt cách accounts/state đã lưu.

SHOPEE_DRAFT_FILE = sp.BASE_DIR / 'shopee_batch_draft.json'


@app.get("/shopee/draft")
def shopee_get_draft():
    if not SHOPEE_DRAFT_FILE.exists():
        return None
    return json.loads(SHOPEE_DRAFT_FILE.read_text(encoding='utf-8'))


@app.post("/shopee/draft")
def shopee_save_draft(body: dict):
    SHOPEE_DRAFT_FILE.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding='utf-8')
    return {"status": "saved"}


@app.delete("/shopee/draft")
def shopee_clear_draft():
    if SHOPEE_DRAFT_FILE.exists():
        SHOPEE_DRAFT_FILE.unlink()
    return {"status": "cleared"}


class ShopeeJobIn(BaseModel):
    video_path: str
    caption: str = ""
    hashtags: list[str] = []
    schedule_date: Optional[str] = None
    schedule_time: Optional[str] = None
    cover_ratio: float = 0.1
    product_query: str = ""
    product_id: Optional[str] = None


class ShopeeBatchRunBody(BaseModel):
    mode: str = "schedule"  # 'schedule' | 'draft' | 'dry_run'
    delay_between_posts: int = 12
    jobs: list[ShopeeJobIn]


def _run_shopee_batch_worker(batch_id: str, body: ShopeeBatchRunBody):
    q = _batches[batch_id]

    def on_progress(event: dict):
        q.put(event)

    jobs = [
        ShopeeVideoJob(
            video_path=j.video_path,
            caption=j.caption,
            hashtags=j.hashtags,
            schedule_date=j.schedule_date,
            schedule_time=j.schedule_time,
            cover_ratio=j.cover_ratio,
            product_query=j.product_query,
            product_id=j.product_id,
            mode=body.mode,
        )
        for j in body.jobs
    ]

    try:
        run_shopee_batch(jobs, on_progress=on_progress, delay_between_posts=body.delay_between_posts)
    except Exception as e:  # noqa: BLE001
        q.put({"type": "fatal", "message": str(e)})
    finally:
        q.put({"type": "__end__"})


@app.post("/shopee/batch/run")
def shopee_batch_run(body: ShopeeBatchRunBody):
    if not body.jobs:
        raise HTTPException(400, "Danh sách video rỗng")

    if not _shopee_apply_active_account():
        raise HTTPException(400, "Chưa có tài khoản Shopee nào được lưu - vào bước Đăng nhập thêm tài khoản trước.")

    # Dùng chung "_batches" + "/ws/batch/{batch_id}" với TikTok (chỉ là 1 Queue
    # theo batch_id, không phụ thuộc nền tảng nào) - khỏi phải viết lại WebSocket.
    batch_id = str(uuid.uuid4())
    _batches[batch_id] = queue.Queue()

    thread = threading.Thread(target=_run_shopee_batch_worker, args=(batch_id, body), daemon=True)
    thread.start()

    return {"batch_id": batch_id}


if __name__ == "__main__":
    import os
    import uvicorn

    # frontend/electron/main.cjs truyền qua biến môi trường LUNO_BACKEND_PORT
    # khi spawn tiến trình này - đọc lại ở đây để 2 bên luôn khớp cổng, thay vì
    # cứng 8756 ở cả hai nơi rồi dễ lệch nhau khi có ai đổi 1 chỗ mà quên chỗ kia.
    port = int(os.environ.get("LUNO_BACKEND_PORT", "8756"))
    uvicorn.run(app, host="127.0.0.1", port=port)
