import type {
  AccountsResponse,
  DefaultsInfo,
  ShopeeDefaultsInfo,
  SessionStatus,
  TodayInfo,
  VideoInfo,
} from './types'

const BASE = () => window.luno?.backendUrl ?? 'http://127.0.0.1:8756'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Lỗi ${res.status}`)
  }
  return res.json()
}

export const api = {
  health: () => req<{ status: string }>('/health'),

  today: () => req<TodayInfo>('/today'),

  sessionStatus: () => req<SessionStatus>('/session/status'),

  defaults: () => req<DefaultsInfo>('/config/defaults'),

  // Cho user tự đổi giá trị mặc định (caption, hashtag, ID sản phẩm, dB
  // nhạc,...) qua màn hình "Cài đặt" thay vì sửa CONFIG trong code Python -
  // lưu ra file riêng ở backend, còn nguyên sau khi restart app.
  updateDefaults: (patch: Partial<DefaultsInfo>) =>
    req<DefaultsInfo>('/config/defaults', {
      method: 'POST',
      body: JSON.stringify(patch),
    }),

  listAccounts: () => req<AccountsResponse>('/accounts'),

  saveAccount: (cookie: string, label: string) =>
    req<{ status: string; id: string }>('/accounts', {
      method: 'POST',
      body: JSON.stringify({ cookie, label }),
    }),

  activateAccount: (id: string) =>
    req<{ status: string }>('/accounts/activate', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  listVideos: (dir: string, start?: number, end?: number, includeDuration?: boolean) => {
    const params = new URLSearchParams({ dir })
    if (start != null) params.set('start', String(start))
    if (end != null) params.set('end', String(end))
    if (includeDuration) params.set('include_duration', 'true')
    return req<{ videos: VideoInfo[]; count: number; missing_numbers: number[] }>(
      `/videos?${params.toString()}`,
    )
  },

  // Cách chọn video thứ 2: user tự duyệt & chọn tuỳ ý qua dialog hệ thống
  // (window.luno.pickVideos()) thay vì gõ dải số - gửi thẳng đường dẫn đã
  // chọn lên để lấy lại đúng shape VideoInfo (number/duration nếu cần).
  videosByPaths: (paths: string[], includeDuration?: boolean) =>
    req<{ videos: VideoInfo[]; count: number }>('/videos/by-paths', {
      method: 'POST',
      body: JSON.stringify({ paths, include_duration: !!includeDuration }),
    }),

  sliceGrid: (imagePath: string, videoCount: number, batchName: string) =>
    req<{ pieces: string[]; cols: number; rows: number }>('/grid/slice', {
      method: 'POST',
      body: JSON.stringify({ image_path: imagePath, video_count: videoCount, batch_name: batchName }),
    }),

  fileUrl: (path: string) => `${BASE()}/files/raw?path=${encodeURIComponent(path)}`,

  runBatch: (payload: unknown) =>
    req<{ batch_id: string }>('/batch/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  wsUrl: (batchId: string) => `${BASE().replace('http', 'ws')}/ws/batch/${batchId}`,

  // video_path -> {status: 'success'|'failed'|'draft'|'dry_run', ...} - đọc từ
  // tiktok_upload_state.json, sống sót qua restart app (khác React state
  // trong bộ nhớ) - dùng để biết video nào ĐÃ đăng thành công thật khi cần
  // khôi phục 1 batch dở dang.
  state: () => req<Record<string, { status: string }>>('/state'),

  // Batch TikTok đang chỉnh dở (chưa chạy xong hẳn) - lưu ra FILE trên đĩa
  // qua backend, KHÔNG dùng localStorage của trình duyệt (không đáng tin cậy
  // để khôi phục qua lần restart nguyên cụm Electron+Vite dev - xem
  // TIKTOK_UPLOAD_PLAN.md mục Shopee để biết lý do đầy đủ).
  getDraft: () => req<unknown | null>('/draft'),

  saveDraft: (draft: unknown) =>
    req<{ status: string }>('/draft', {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  clearDraft: () => req<{ status: string }>('/draft', { method: 'DELETE' }),

  // ==================== SHOPEE (song song TikTok ở trên, route riêng
  // "/shopee/..." - "/videos", "/files/raw", "/ws/batch/{id}" dùng CHUNG vì
  // không phụ thuộc nền tảng nào) ====================
  shopee: {
    defaults: () => req<ShopeeDefaultsInfo>('/shopee/config/defaults'),

    updateDefaults: (patch: Partial<ShopeeDefaultsInfo>) =>
      req<ShopeeDefaultsInfo>('/shopee/config/defaults', {
        method: 'POST',
        body: JSON.stringify(patch),
      }),

    sessionStatus: () => req<SessionStatus>('/shopee/session/status'),

    // video_path -> {status: 'success'|'failed'|'draft'|'dry_run', ...} - đọc
    // từ shopee_upload_state.json, sống sót qua restart app (khác React state
    // trong bộ nhớ) - dùng để biết video nào ĐÃ đăng thành công thật khi cần
    // khôi phục 1 batch dở dang.
    state: () => req<Record<string, { status: string }>>('/shopee/state'),

    listAccounts: () => req<AccountsResponse>('/shopee/accounts'),

    saveAccount: (cookie: string, label: string) =>
      req<{ status: string; id: string }>('/shopee/accounts', {
        method: 'POST',
        body: JSON.stringify({ cookie, label }),
      }),

    activateAccount: (id: string) =>
      req<{ status: string }>('/shopee/accounts/activate', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),

    runBatch: (payload: unknown) =>
      req<{ batch_id: string }>('/shopee/batch/run', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    // Batch đang chỉnh dở (chưa chạy xong hẳn) - lưu ra FILE trên đĩa qua
    // backend, KHÔNG dùng localStorage của trình duyệt (không đáng tin cậy để
    // khôi phục qua lần restart nguyên cụm Electron+Vite dev).
    getDraft: () => req<unknown | null>('/shopee/draft'),

    saveDraft: (draft: unknown) =>
      req<{ status: string }>('/shopee/draft', {
        method: 'POST',
        body: JSON.stringify(draft),
      }),

    clearDraft: () => req<{ status: string }>('/shopee/draft', { method: 'DELETE' }),
  },
}
