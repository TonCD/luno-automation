const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
const BACKEND_PORT = 8756;

let backendProcess = null;
let mainWindow = null;

// DEV: chạy thẳng server.py bằng Python trong venv riêng của backend/ (tự tạo
// theo README - "python -m venv backend/.venv" - KHÔNG dùng chung venv nào
// khác, để backend/ là 1 project Python độc lập, tự chứa). Hỗ trợ cả
// Windows (Scripts/python.exe) lẫn macOS/Linux (bin/python) vì repo là mã
// nguồn mở, không giả định chỉ chạy trên Windows.
function resolveDevPython() {
  const venvDir = path.join(__dirname, '..', '..', 'backend', '.venv');
  const winPython = path.join(venvDir, 'Scripts', 'python.exe');
  const unixPython = path.join(venvDir, 'bin', 'python');
  return fs.existsSync(winPython) ? winPython : unixPython;
}

// PACKAGED (.exe đã đóng gói): dùng bản backend đã build sẵn bằng PyInstaller
// (xem backend/server.spec) - electron-builder copy vào resources/backend/
// qua "extraResources" (xem package.json). Không cần Python cài trên máy user.
function resolvePackagedBackend() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(process.resourcesPath, 'backend', `luno-backend${ext}`);
}

function startBackend() {
  const env = { ...process.env, LUNO_BACKEND_PORT: String(BACKEND_PORT) };

  if (isDev) {
    const pythonPath = resolveDevPython();
    const serverScript = path.join(__dirname, '..', '..', 'backend', 'server.py');
    backendProcess = spawn(pythonPath, [serverScript], { stdio: 'inherit', env });
  } else {
    const backendExe = resolvePackagedBackend();
    backendProcess = spawn(backendExe, [], { stdio: 'inherit', env });
  }

  backendProcess.on('error', (err) => {
    console.error('Không khởi động được backend:', err);
  });
  backendProcess.on('exit', (code) => {
    console.log(`Backend thoát với mã: ${code}`);
  });
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'LUNO Automation',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Tự mở DevTools trong lúc phát triển (chưa đóng gói .exe) - tắt lại khi
    // build bản đóng gói phân phối thật (chỉ chạy trong nhánh isDev này thôi).
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// Dialog chọn folder video (dùng cho bước "chọn video từ folder nào") - trả về
// đường dẫn folder hoặc null nếu user bấm Hủy. Phải làm ở main process vì
// renderer (React) chạy sandbox, không có quyền mở dialog hệ thống trực tiếp.
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Dialog chọn 1 ảnh nguồn để cắt grid layout
ipcMain.handle('pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Ảnh', extensions: ['jpg', 'jpeg', 'png'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Dialog chọn NHIỀU video cụ thể (không theo dải số/folder) - dùng cho cách
// chọn video thứ 2 "duyệt & chọn tuỳ ý" bên cạnh cách cũ "theo dải số".
ipcMain.handle('pick-videos', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v', 'mpeg', 'mpg', 'flv'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopBackend);
