const { contextBridge, ipcRenderer } = require('electron');

// API lộ ra cho renderer (React) - mọi thao tác cần quyền hệ thống (mở dialog
// chọn file/folder,...) đều phải đi qua đây, React không được truy cập trực
// tiếp Node.js/hệ thống vì contextIsolation đang bật (an toàn hơn).
contextBridge.exposeInMainWorld('luno', {
  backendUrl: 'http://127.0.0.1:8756',
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  pickVideos: () => ipcRenderer.invoke('pick-videos'),
});
