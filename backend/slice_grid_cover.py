"""
=============================================================================
SLICE GRID COVER - cắt 1 ảnh lớn thành lưới NxM ảnh bìa cho trend "grid layout"
trên trang hồ sơ TikTok (mỗi video 1 mảnh, đăng đúng thứ tự thì ghép lại thành
ảnh hoàn chỉnh khi xem trang hồ sơ).

QUAN TRỌNG: TikTok hiển thị video MỚI NHẤT ở ô ĐẦU TIÊN (trên-trái) của grid,
nên phải đăng NGƯỢC thứ tự đọc ảnh - mảnh dưới-phải (piece cuối) đăng SỚM NHẤT,
mảnh trên-trái (piece 1) đăng SAU CÙNG. Script này tự tính & đặt tên file theo
đúng ngày/slot sẽ đăng - không cần tính tay, không cần đảo thứ tự thủ công.

Output: mỗi ảnh 1 file, tên dạng "{ngày đăng}_slot{số thứ tự trong ngày}_piece{số
thứ tự đọc ảnh gốc}.jpg" trong folder riêng theo khoảng ngày của batch, ví dụ:
    grid_covers/2026-08-01_2026-08-03/2026-08-01_slot1_piece12.jpg
Sắp xếp theo tên file (alphabet) = đúng thứ tự thời gian sẽ đăng.
=============================================================================
"""

import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path

# Đường dẫn tương đối tính từ vị trí file này, không phụ thuộc cwd lúc chạy lệnh.
BASE_DIR = Path(__file__).resolve().parent

# ==================== CONFIG ====================
CONFIG = {
    'source_image': BASE_DIR / 'grid_source' / 'Img_test.jpg',  # ảnh lớn gốc (khuyến nghị 1080x1920 hoặc bội số cho lưới 3x4)
    'cols': 3,
    'rows': 4,
    'start_date': '2026-08-03',   # ngày đăng video ĐẦU TIÊN của batch (sớm nhất - ứng với piece cuối ảnh)
    'videos_per_day': 4,
    'output_root': BASE_DIR / 'grid_covers',
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
FFPROBE_BIN = resolve_binary("ffprobe")


def get_image_size(path):
    cmd = [
        FFPROBE_BIN, "-v", "quiet", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0", str(path),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    w, h = r.stdout.strip().split('x')
    return int(w), int(h)


def crop_cell(source, out_path, x, y, w, h):
    cmd = [
        FFMPEG_BIN, "-y", "-i", str(source),
        "-filter:v", f"crop={w}:{h}:{x}:{y}",
        "-q:v", "2", str(out_path),
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg crop thất bại: {r.stderr.decode(errors='ignore')[:300]}")


def build_schedule_slots(start_date_str, total_pieces, videos_per_day):
    """Danh sách (ngày, số thứ tự trong ngày) theo đúng thứ tự ĐĂNG - thời gian
    tăng dần, bắt đầu từ start_date."""
    start = date.fromisoformat(start_date_str)
    slots = []
    for i in range(total_pieces):
        day_offset, slot = divmod(i, videos_per_day)
        slots.append((start + timedelta(days=day_offset), slot + 1))
    return slots


def slice_grid_cover():
    source = Path(CONFIG['source_image'])
    if not source.exists():
        raise FileNotFoundError(f"Không tìm thấy ảnh gốc: {source}")

    cols, rows = CONFIG['cols'], CONFIG['rows']
    total = cols * rows
    width, height = get_image_size(source)
    print(f"Ảnh gốc: {width}x{height} -> cắt lưới {cols} cột x {rows} hàng ({total} mảnh)")

    slots = build_schedule_slots(CONFIG['start_date'], total, CONFIG['videos_per_day'])
    batch_start, batch_end = slots[0][0], slots[-1][0]
    out_dir = Path(CONFIG['output_root']) / f"{batch_start}_{batch_end}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Chia biên theo tỉ lệ tích luỹ (round) thay vì chia đều rồi cộng phần dư -
    # đảm bảo phủ kín ảnh gốc, không hở/dư pixel dù width/height không chia hết.
    xs = [round(width * c / cols) for c in range(cols + 1)]
    ys = [round(height * r / rows) for r in range(rows + 1)]

    for row in range(rows):
        for col in range(cols):
            piece_no = row * cols + col + 1  # 1 = trên-trái, theo đúng thứ tự đọc ảnh

            # Đăng NGƯỢC: piece_no càng lớn (càng về cuối ảnh) thì đăng càng SỚM
            slot_index = total - piece_no
            slot_date, slot_num = slots[slot_index]

            x, cell_w = xs[col], xs[col + 1] - xs[col]
            y, cell_h = ys[row], ys[row + 1] - ys[row]

            filename = f"{slot_date}_slot{slot_num}_piece{piece_no:02d}.jpg"
            out_path = out_dir / filename
            crop_cell(source, out_path, x, y, cell_w, cell_h)
            print(f"  ✓ Piece {piece_no:2d} (hàng {row + 1} cột {col + 1}) "
                  f"-> đăng {slot_date} slot {slot_num} -> {filename}")

    print(f"\n✅ Xong! {total} ảnh bìa trong: {out_dir}")
    print("   Tên file đã sort theo alphabet = đúng thứ tự thời gian sẽ đăng.")


if __name__ == '__main__':
    slice_grid_cover()
