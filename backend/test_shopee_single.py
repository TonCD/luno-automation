"""
=============================================================================
TEST NHANH 1 VIDEO SHOPEE (CLI) - chạy thử toàn bộ flow (upload -> caption ->
hashtag -> cover -> sản phẩm -> lịch) rồi DỪNG LẠI chờ Enter TRƯỚC khi bấm
đăng thật, để tự kiểm tra trên browser xem flow đã đúng chưa - trước khi thử
qua app desktop.

KHÔNG viết lại logic - chỉ trỏ CONFIG của shopee_uploader.py vào đúng
cookie/session của 1 account đã lưu qua app (shopee_accounts/<id>/) rồi gọi
lại main() có sẵn (đã có input() chờ xác nhận trước publish()).

Cách dùng:
    python test_shopee_single.py <account_id> <đường_dẫn_video>

Ví dụ (account_id lấy từ tên folder trong shopee_accounts/):
    python test_shopee_single.py a1b2c3d4 "D:\\videos\\sample_001.mp4"
=============================================================================
"""

import sys
from pathlib import Path

import shopee_uploader as sp


def main():
    if len(sys.argv) < 3:
        print("Cách dùng: python test_shopee_single.py <account_id> <đường_dẫn_video>")
        print("account_id lấy từ tên folder trong shopee_accounts/ (vd bc7704d8)")
        sys.exit(1)

    account_id = sys.argv[1]
    video_path = Path(sys.argv[2])

    acc_dir = sp.BASE_DIR / 'shopee_accounts' / account_id
    if not acc_dir.is_dir():
        print(f"❌ Không tìm thấy account: {acc_dir}")
        sys.exit(1)
    if not video_path.exists():
        print(f"❌ Không tìm thấy video: {video_path}")
        sys.exit(1)

    # Trỏ đúng cookie/session của account đã lưu qua app - không cần dán lại
    # cookie riêng cho lần test CLI này (giống cách server.py's
    # _apply_active_account() trỏ CONFIG cho backend).
    sp.CONFIG['cookie_file'] = acc_dir / 'cookie.txt'
    sp.CONFIG['session_state_file'] = acc_dir / 'session.json'
    sp.CONFIG['video_path'] = video_path

    sp.main()


if __name__ == '__main__':
    main()
