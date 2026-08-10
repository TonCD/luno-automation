# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec đóng gói backend (server.py + tiktok_uploader.py +
# batch_engine.py + shopee_uploader.py + shopee_batch_engine.py +
# slice_grid_cover.py) thành 1 folder độc lập chứa .exe, KHÔNG cần máy đích
# cài Python/pip. Electron (frontend/electron/main.cjs) spawn thẳng file .exe
# này khi chạy bản đã đóng gói (không dùng .venv/python.exe như lúc dev).
#
# Dùng chế độ "onedir" (không phải "onefile" 1 file duy nhất) có chủ đích:
# Playwright tự spawn 1 tiến trình con (driver Node.js) khi chạy - onefile
# phải tự giải nén ra thư mục tạm mỗi lần khởi động (chậm hơn, và từng có
# trường hợp lỗi khi spawn subprocess từ bên trong bundle tự giải nén),
# onedir tránh hẳn rủi ro đó.
#
# Cách build: cd backend && pyinstaller server.spec
# Kết quả: backend/dist/luno-backend/luno-backend.exe (+ các file phụ trợ
# cùng thư mục) - đúng thư mục mà frontend/package.json (mục
# build.extraResources) copy vào gói cài đặt cuối cùng.

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

# collect_all thay vì tự liệt kê hidden-imports/data files thủ công - Playwright
# đặc biệt cần cả thư mục "driver" (driver Node.js đóng gói sẵn bên trong gói
# pip playwright) mới chạy được, dễ thiếu nếu tự liệt kê tay.
for pkg in ('playwright', 'fastapi', 'uvicorn', 'starlette', 'pydantic', 'pydantic_core', 'websockets'):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='luno-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='luno-backend',
)
