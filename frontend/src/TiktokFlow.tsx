import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { Button } from './components/ui/Button'
import { Card, CardDescription, CardTitle } from './components/ui/Card'
import { Callout } from './components/ui/Callout'
import { Tabs } from './components/ui/Tabs'
import { Label, inputClass } from './components/ui/Field'
import { StepList } from './components/ui/StepList'
import { TikTokIcon } from './components/ui/TikTokIcon'
import { Modal, GuideButton } from './components/ui/Modal'
import type {
  AccountInfo,
  DefaultsInfo,
  PostMode,
  ProgressEvent,
  SessionStatus,
  TodayInfo,
  VideoEntry,
  VideoInfo,
} from './types'

type Step = 'backend' | 'cookie' | 'mode' | 'videos' | 'grid' | 'details' | 'run'

const STEP_ORDER: Step[] = ['cookie', 'mode', 'videos', 'grid', 'details', 'run']
const STEP_LABEL: Record<Step, string> = {
  backend: 'Kết nối',
  cookie: 'Đăng nhập',
  mode: 'Chế độ đăng',
  videos: 'Chọn video',
  grid: 'Ảnh bìa Grid',
  details: 'Nội dung & Lịch đăng',
  run: 'Chạy hàng loạt',
}

// 4 khung giờ chính hay dùng (khớp nhịp 4 video/ngày đã thống nhất) - bấm nhanh
// thay vì phải mở time picker mỗi lần.
const QUICK_TIME_SLOTS = ['08:00', '12:00', '16:00', '20:00']

type GridStyle = 9 | 12

// Mã batch dùng để đặt tên folder grid_covers/batch_{token}_g{N}/ - dạng
// YYYYMMDD_HHmmss (đọc được, dễ tìm lại) thay vì số mili-giây Date.now() khó
// đọc. Tính 1 LẦN duy nhất khi xác nhận xong danh sách video (confirmVideos)
// và giữ nguyên suốt phiên chỉnh sửa batch đó - nhờ vậy bấm "Cắt ảnh" lại
// (chọn lại ảnh khác, hoặc cắt lại) cho CÙNG 1 nhóm sẽ ghi đè lên đúng folder
// cũ thay vì tạo folder rác mới mỗi lần bấm (trước đây gọi Date.now() ngay
// trong handleSliceChunk nên mỗi lần bấm ra 1 timestamp khác nhau).
function formatBatchToken(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// Video có thể chọn từ NHIỀU folder khác nhau (nhiều lần "Tìm video" + "Thêm vào
// danh sách") - mỗi lần thêm ghi lại thành 1 batch riêng để hiện tổng quan +
// cho phép xoá lại đúng batch đó nếu chọn nhầm.
interface VideoBatch {
  folder: string
  videos: VideoInfo[]
}

// Lưu tạm toàn bộ dữ liệu batch đang chỉnh (entries, mode, grid,...) ra FILE
// trên đĩa qua backend (`/draft`) - mirror hệt ShopeeFlow.tsx (KHÔNG dùng
// localStorage của trình duyệt - không đáng tin cậy để khôi phục qua lần
// restart nguyên cụm Electron+Vite dev, xem TIKTOK_UPLOAD_PLAN.md mục Shopee).
interface TiktokDraft {
  mode: PostMode
  productId: string
  useGrid: boolean
  gridStyle: GridStyle
  chunkImagePaths: Record<number, string>
  chunkPieces: Record<number, string[]>
  entries: VideoEntry[]
}

// 1 ảnh grid chỉ phủ ĐÚNG 1 nhóm cố định video (9 hoặc 12, theo gridStyle) -
// KHÔNG phải cắt 1 ảnh cho cả batch dài (vd 24 video thì phải là 2 ảnh riêng,
// mỗi ảnh 12 video, không phải 1 ảnh chia 3x8). Nhóm được chia theo đúng THỨ TỰ
// THỜI GIAN ĐĂNG (scheduleDate/scheduleTime), KHÔNG theo thứ tự chọn/folder -
// quan trọng khi video đến từ nhiều folder khác nhau và không nhất thiết được
// chọn theo đúng thứ tự sẽ đăng. Video đăng SỚM NHẤT rơi vào nhóm 1 (ảnh 1),
// tiếp theo rơi vào nhóm 2 (ảnh 2), v.v. Phần dư cuối (không đủ 1 nhóm) sẽ
// không có ảnh grid, tự fallback về cover thường (cắt frame theo giây).
function splitIntoGridChunks(entries: VideoEntry[], size: number) {
  const sorted = [...entries].sort((a, b) => {
    const da = `${a.scheduleDate} ${a.scheduleTime}`
    const db = `${b.scheduleDate} ${b.scheduleTime}`
    return da.localeCompare(db)
  })
  const fullChunks = Math.floor(sorted.length / size)
  const chunks: VideoEntry[][] = []
  for (let i = 0; i < fullChunks; i++) {
    chunks.push(sorted.slice(i * size, (i + 1) * size))
  }
  const leftover = sorted.slice(fullChunks * size)
  return { chunks, leftover }
}

// Trong PHẠM VI 1 NHÓM: sắp theo đúng thứ tự thời gian sẽ đăng, rồi gán ngược
// ảnh - video đăng SỚM NHẤT nhận mảnh CUỐI ảnh (piece N), video đăng MUỘN NHẤT
// nhận mảnh ĐẦU ảnh (piece 1) - vì TikTok hiển thị video mới nhất ở ô đầu grid.
function assignChunkCovers(chunkEntries: VideoEntry[], pieces: string[]): Record<string, string> {
  if (pieces.length === 0) return {}
  const sorted = [...chunkEntries].sort((a, b) => {
    const da = `${a.scheduleDate} ${a.scheduleTime}`
    const db = `${b.scheduleDate} ${b.scheduleTime}`
    return da.localeCompare(db)
  })
  const reversedPieces = [...pieces].reverse()
  const map: Record<string, string> = {}
  sorted.forEach((entry, i) => {
    if (i < reversedPieces.length) map[entry.path] = reversedPieces[i]
  })
  return map
}

export function TiktokFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>('backend')
  const [backendOk, setBackendOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [cookie, setCookie] = useState('')
  const [newAccountLabel, setNewAccountLabel] = useState('')
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  const [today, setToday] = useState<TodayInfo | null>(null)
  const [defaults, setDefaults] = useState<DefaultsInfo | null>(null)

  // Cài đặt giá trị mặc định (caption/hashtag/ID sản phẩm/cover/dB nhạc) -
  // form riêng (hashtags dạng text gõ tay, đổi qua lại với mảng lúc lưu) mở
  // trong popup, KHÔNG ảnh hưởng entries đã có sẵn trong batch đang chỉnh -
  // chỉ áp dụng cho batch MỚI xác nhận sau khi lưu.
  const [showSettings, setShowSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    caption: '',
    hashtagsText: '',
    productId: '',
    coverSecond: 7,
    musicVolumeDb: -20,
    delayBetweenPosts: 12,
  })
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [mode, setMode] = useState<PostMode>('schedule')

  const [videoFolder, setVideoFolder] = useState<string | null>(null)
  const [numStart, setNumStart] = useState<string>('')
  const [numEnd, setNumEnd] = useState<string>('')
  const [foundVideos, setFoundVideos] = useState<VideoInfo[]>([])
  const [missingNumbers, setMissingNumbers] = useState<number[]>([])
  const [videoBatches, setVideoBatches] = useState<VideoBatch[]>([])

  const [useGrid, setUseGrid] = useState(false)
  const [gridStyle, setGridStyle] = useState<GridStyle>(12)
  const [chunkImagePaths, setChunkImagePaths] = useState<Record<number, string>>({})
  const [chunkPieces, setChunkPieces] = useState<Record<number, string[]>>({})
  const [gridBatchToken, setGridBatchToken] = useState('')

  const [entries, setEntries] = useState<VideoEntry[]>([])
  const [productId, setProductId] = useState('')
  const [showProductGuide, setShowProductGuide] = useState(false)
  const [showMusicGuide, setShowMusicGuide] = useState(false)

  const [batchId, setBatchId] = useState<string | null>(null)
  const [progressLog, setProgressLog] = useState<ProgressEvent[]>([])
  const [running, setRunning] = useState(false)
  const [batchDone, setBatchDone] = useState(false)

  const [restoredDraft, setRestoredDraft] = useState(false)
  // State (không phải ref) có chủ đích - xem giải thích chi tiết ở
  // ShopeeFlow.tsx (cùng cơ chế), tránh race khiến effect tự lưu xoá nhầm
  // draft vừa khôi phục xong.
  const [hydrated, setHydrated] = useState(false)

  // Khôi phục batch dở dang (nếu có) từ backend ngay khi kết nối được. Đối
  // chiếu thêm với tiktok_upload_state.json để tự đánh dấu video nào ĐÃ đăng
  // thành công thật, tránh đăng trùng khi chạy lại (xem effect ngay bên dưới).
  useEffect(() => {
    if (!backendOk) return
    api
      .getDraft()
      .then((raw) => {
        const draft = raw as TiktokDraft | null
        if (draft && draft.entries && draft.entries.length > 0) {
          setMode(draft.mode)
          setProductId(draft.productId)
          setUseGrid(draft.useGrid)
          setGridStyle(draft.gridStyle)
          setChunkImagePaths(draft.chunkImagePaths)
          setChunkPieces(draft.chunkPieces)
          setEntries(draft.entries)
          setRestoredDraft(true)
          setStep('run')
        }
        setHydrated(true)
      })
      .catch(() => setHydrated(true))
  }, [backendOk])

  useEffect(() => {
    if (!restoredDraft || !backendOk) return
    api
      .state()
      .then((state) => {
        setEntries((prev) =>
          prev.map((e) => ({ ...e, alreadyDone: state[e.path]?.status === 'success' })),
        )
      })
      .catch(() => {})
  }, [restoredDraft, backendOk])

  // Tự lưu (debounce 800ms) mỗi khi entries/mode/grid/sản phẩm đổi - CHỈ sau
  // khi đã hydrate xong và chỉ khi có video (không lưu batch rỗng).
  useEffect(() => {
    if (!hydrated) return
    const timer = setTimeout(() => {
      if (entries.length === 0) {
        api.clearDraft().catch(() => {})
        return
      }
      api
        .saveDraft({ mode, productId, useGrid, gridStyle, chunkImagePaths, chunkPieces, entries })
        .catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [hydrated, entries, mode, productId, useGrid, gridStyle, chunkImagePaths, chunkPieces])

  function handleClearDraft() {
    api.clearDraft().catch(() => {})
    setRestoredDraft(false)
    setEntries([])
    setVideoBatches([])
    setFoundVideos([])
    setChunkImagePaths({})
    setChunkPieces({})
    setStep('cookie')
  }

  // ---- Kiểm tra kết nối backend lúc khởi động - poll mỗi 2s CHO TỚI KHI kết
  // nối được thì dừng hẳn (không tiếp tục gọi /health suốt vòng đời app).
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const check = () => {
      api
        .health()
        .then(() => {
          if (!alive) return
          setBackendOk(true)
          setStep((s) => (s === 'backend' ? 'cookie' : s))
        })
        .catch(() => {
          if (alive) timer = setTimeout(check, 2000)
        })
    }
    check()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  async function loadAccounts() {
    const res = await api.listAccounts()
    setAccounts(res.accounts)
    setActiveAccountId(res.active_id)
  }

  useEffect(() => {
    if (!backendOk) return
    api.sessionStatus().then(setSessionStatus).catch(() => {})
    api.today().then(setToday).catch(() => {})
    api.defaults().then((d) => {
      setDefaults(d)
      setProductId(d.product_id)
    }).catch(() => {})
    loadAccounts().catch(() => {})
  }, [backendOk])

  function openSettings() {
    if (!defaults) return
    setSettingsForm({
      caption: defaults.caption,
      hashtagsText: defaults.hashtags.join(' '),
      productId: defaults.product_id,
      coverSecond: defaults.cover_second,
      musicVolumeDb: defaults.music_volume_db,
      delayBetweenPosts: defaults.delay_between_posts,
    })
    setShowSettings(true)
  }

  async function handleSaveSettings() {
    setSettingsSaving(true)
    setError(null)
    try {
      const updated = await api.updateDefaults({
        caption: settingsForm.caption,
        hashtags: settingsForm.hashtagsText.split(/\s+/).filter(Boolean),
        product_id: settingsForm.productId,
        cover_second: settingsForm.coverSecond,
        music_volume_db: settingsForm.musicVolumeDb,
        delay_between_posts: settingsForm.delayBetweenPosts,
      })
      setDefaults(updated)
      setShowSettings(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSettingsSaving(false)
    }
  }

  const selectedVideos = useMemo(() => videoBatches.flatMap((b) => b.videos), [videoBatches])

  const gridChunks = useMemo(() => splitIntoGridChunks(entries, gridStyle), [entries, gridStyle])

  const gridAssignment = useMemo(() => {
    const map: Record<string, string> = {}
    gridChunks.chunks.forEach((chunkEntries, idx) => {
      const pieces = chunkPieces[idx]
      if (!pieces) return
      Object.assign(map, assignChunkCovers(chunkEntries, pieces))
    })
    return map
  }, [gridChunks, chunkPieces])

  const reachableSteps = useMemo(() => {
    const s = new Set<string>(['cookie'])
    if (backendOk) s.add('mode')
    if (mode) s.add('videos')
    if (selectedVideos.length > 0 || entries.length > 0) s.add('grid')
    if (entries.length > 0) {
      s.add('details')
      s.add('run')
    }
    return s
  }, [backendOk, mode, selectedVideos, entries])

  // ==================== BƯỚC: TÀI KHOẢN ====================
  async function handleActivateAccount(id: string) {
    setError(null)
    try {
      await api.activateAccount(id)
      setActiveAccountId(id)
      const s = await api.sessionStatus()
      setSessionStatus(s)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleSaveNewAccount() {
    if (!cookie.trim()) return
    setError(null)
    try {
      await api.saveAccount(cookie, newAccountLabel)
      setCookie('')
      setNewAccountLabel('')
      setShowAddAccount(false)
      await loadAccounts()
      const s = await api.sessionStatus()
      setSessionStatus(s)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ==================== BƯỚC: CHỌN VIDEO ====================
  async function handlePickFolder() {
    const folder = await window.luno.pickFolder()
    if (folder) setVideoFolder(folder)
  }

  async function handleListVideos() {
    if (!videoFolder) return
    setError(null)
    try {
      const start = numStart ? parseInt(numStart, 10) : undefined
      const end = numEnd ? parseInt(numEnd, 10) : undefined
      const res = await api.listVideos(videoFolder, start, end)
      setFoundVideos(res.videos)
      setMissingNumbers(res.missing_numbers)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Thêm kết quả vừa tìm (1 folder) vào danh sách tổng - cho phép lặp lại việc
  // chọn folder + dải số nhiều lần để gộp video từ nhiều folder khác nhau vào
  // cùng 1 batch (vẫn ghi nhận/phân biệt theo tên file + đường dẫn như cũ).
  function handleAddFoundVideos() {
    if (!videoFolder || foundVideos.length === 0) return
    setVideoBatches((prev) => {
      const existingPaths = new Set(prev.flatMap((b) => b.videos).map((v) => v.path))
      const toAdd = foundVideos.filter((v) => !existingPaths.has(v.path))
      return [...prev, { folder: videoFolder, videos: toAdd }]
    })
    setVideoFolder(null)
    setNumStart('')
    setNumEnd('')
    setFoundVideos([])
    setMissingNumbers([])
  }

  function handleRemoveBatch(idx: number) {
    setVideoBatches((prev) => prev.filter((_, i) => i !== idx))
  }

  // Cách chọn video thứ 2: mở dialog hệ thống, tự tay chọn tuỳ ý từng video
  // (không cần đúng thứ tự số/nằm cùng 1 folder) - kết quả gộp vào CÙNG danh
  // sách với cách chọn theo dải số ở trên.
  async function handlePickIndividualVideos() {
    const paths = await window.luno.pickVideos()
    if (!paths || paths.length === 0) return
    setError(null)
    try {
      const res = await api.videosByPaths(paths)
      setVideoBatches((prev) => {
        const existingPaths = new Set(prev.flatMap((b) => b.videos).map((v) => v.path))
        const toAdd = res.videos.filter((v) => !existingPaths.has(v.path))
        if (toAdd.length === 0) return prev
        return [...prev, { folder: `🎯 Tự chọn (${toAdd.length} video)`, videos: toAdd }]
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function confirmVideos() {
    if (!defaults) return
    const nowDate = today?.today ?? new Date().toISOString().slice(0, 10)
    const built: VideoEntry[] = selectedVideos.map((v) => ({
      ...v,
      caption: defaults.caption,
      useDefaultHashtags: true,
      customHashtags: '',
      scheduleDate: nowDate,
      scheduleTime: '08:00',
      coverSecond: defaults.cover_second,
      musicVolumeDb: defaults.music_volume_db,
      addProductLink: true,
      useDefaultProductName: true,
      customProductName: '',
      addMusic: true,
    }))
    setEntries(built)
    // 1 token duy nhất cho cả phiên chỉnh batch này - xem giải thích ở
    // formatBatchToken() phía trên.
    setGridBatchToken(formatBatchToken())
    setStep('grid')
  }

  // ==================== BƯỚC: GRID COVER ====================
  // Mỗi nhóm (chunk) video chọn ảnh + cắt RIÊNG - không dùng chung 1 ảnh cho cả batch.
  async function handlePickChunkImage(chunkIndex: number) {
    const img = await window.luno.pickImage()
    if (img) setChunkImagePaths((prev) => ({ ...prev, [chunkIndex]: img }))
  }

  async function handleSliceChunk(chunkIndex: number) {
    const img = chunkImagePaths[chunkIndex]
    if (!img) return
    setError(null)
    try {
      const res = await api.sliceGrid(img, gridStyle, `batch_${gridBatchToken}_g${chunkIndex}`)
      setChunkPieces((prev) => ({ ...prev, [chunkIndex]: res.pieces }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ==================== BƯỚC: CHI TIẾT TỪNG VIDEO ====================
  function updateEntry(path: string, patch: Partial<VideoEntry>) {
    setEntries((prev) => prev.map((e) => (e.path === path ? { ...e, ...patch } : e)))
  }

  function applyDefaultHashtagsToAll() {
    setEntries((prev) => prev.map((e) => ({ ...e, useDefaultHashtags: true })))
  }

  // ==================== BƯỚC: CHẠY BATCH ====================
  function buildJobPayload(list: VideoEntry[]) {
    if (!defaults) return []
    return list.map((e) => ({
      video_path: e.path,
      caption: e.caption,
      hashtags: e.useDefaultHashtags
        ? defaults.hashtags
        : e.customHashtags.split(/\s+/).filter(Boolean),
      schedule_date: e.scheduleDate,
      schedule_time: e.scheduleTime,
      cover_image_path: useGrid ? gridAssignment[e.path] ?? null : null,
      cover_second: e.coverSecond,
      // Bỏ tích "Gắn link sản phẩm" cho video này -> gửi product_id = null,
      // batch_engine.py chỉ gọi add_product_link() khi job.product_id có giá
      // trị (if job.product_id:) nên tự động bỏ qua bước đó, không cần sửa
      // gì thêm ở backend.
      product_id: e.addProductLink ? productId || null : null,
      // null = giữ tên mặc định TikTok đã tự điền sẵn (không đụng vào ô đó);
      // có giá trị = ghi đè bằng fill() trước khi bấm "Thêm" (xem
      // add_product_link() trong tiktok_uploader.py). Cắt tối đa 30 ký tự
      // ngay ở đây cho khớp giới hạn thật của TikTok, không đợi backend cắt.
      product_display_name:
        e.addProductLink && !e.useDefaultProductName
          ? e.customProductName.trim().slice(0, 30) || null
          : null,
      // Bỏ tích "Thêm nhạc nền" -> add_music: false, batch_engine.py bọc
      // tk.add_music() trong `if job.add_music:` nên tự bỏ qua bước đó.
      add_music: e.addMusic,
      music_pick_range: [1, 8] as [number, number],
      music_volume_db: e.musicVolumeDb,
    }))
  }

  async function runJobs(list: VideoEntry[]) {
    if (!defaults || list.length === 0) return
    setError(null)
    setBatchDone(false)
    try {
      const { batch_id } = await api.runBatch({
        mode,
        delay_between_posts: defaults.delay_between_posts,
        jobs: buildJobPayload(list),
      })
      setBatchId(batch_id)
      setProgressLog([])
      setRunning(true)

      const ws = new WebSocket(api.wsUrl(batch_id))
      ws.onmessage = (msg) => {
        const event: ProgressEvent = JSON.parse(msg.data)
        setProgressLog((prev) => [...prev, event])
        if (event.type === 'batch_done' || event.type === 'fatal') {
          setRunning(false)
          setBatchDone(true)
        }
      }
      ws.onerror = () => setRunning(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Video đã đánh dấu alreadyDone (khôi phục từ tiktok_upload_state.json sau
  // restart app) - loại khỏi lượt chạy mặc định để tránh đăng trùng.
  const pendingEntries = useMemo(() => entries.filter((e) => !e.alreadyDone), [entries])

  function handleRunBatch() {
    runJobs(pendingEntries)
  }

  // Danh sách video bị lỗi ở lượt chạy vừa rồi, dựa theo path đã báo trong log
  const failedPaths = useMemo(
    () =>
      new Set(
        progressLog
          .filter((e) => e.type === 'video_done' && e.status === 'failed')
          .map((e) => e.video)
          .filter((v): v is string => Boolean(v)),
      ),
    [progressLog],
  )
  const failedEntries = useMemo(
    () => entries.filter((e) => failedPaths.has(e.path)),
    [entries, failedPaths],
  )

  function handleRetryFailed() {
    runJobs(failedEntries)
  }

  // Video bị TikTok CHẶN vì kiểm duyệt nội dung (error_type='moderation') -
  // khác lỗi kỹ thuật thường, thử lại y hệt file đó nhiều khả năng vẫn bị
  // chặn giống hệt nên cần gợi ý đổi sang video khác thay vì chỉ "chạy lại".
  const moderationFailedPaths = useMemo(
    () =>
      new Set(
        progressLog
          .filter((e) => e.type === 'video_done' && e.status === 'failed' && e.error_type === 'moderation')
          .map((e) => e.video)
          .filter((v): v is string => Boolean(v)),
      ),
    [progressLog],
  )
  const moderationFailedEntries = useMemo(
    () => entries.filter((e) => moderationFailedPaths.has(e.path)),
    [entries, moderationFailedPaths],
  )

  // Chọn video KHÁC thay cho 1 video bị chặn kiểm duyệt - giữ nguyên toàn bộ
  // thông tin đã điền (mô tả, hashtag, lịch đăng, ảnh bìa, dB nhạc, có/không
  // gắn sản phẩm,...) của entry cũ, chỉ đổi path/filename/number sang video
  // mới. Đồng thời viết lại progressLog (đổi field "video" từ path cũ sang
  // path mới) để failedPaths/failedEntries ở trên tự nhận diện đúng video đã
  // thay - bấm "Chạy lại video lỗi" sau đó sẽ tự chạy đúng file mới, không
  // cần thêm nút retry riêng cho trường hợp này.
  async function handleReplaceVideo(oldPath: string) {
    const paths = await window.luno.pickVideos()
    if (!paths || paths.length === 0) return
    setError(null)
    try {
      const res = await api.videosByPaths([paths[0]])
      const info = res.videos[0]
      if (!info) return
      setEntries((prev) =>
        prev.map((e) =>
          e.path === oldPath
            ? { ...e, path: info.path, filename: info.filename, number: info.number, alreadyDone: false }
            : e,
        ),
      )
      setProgressLog((prev) => prev.map((ev) => (ev.video === oldPath ? { ...ev, video: info.path } : ev)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Batch xong và KHÔNG còn video nào lỗi -> không còn gì để khôi phục, xoá
  // draft đã lưu (tránh lần mở app sau bị "khôi phục" nhầm 1 batch đã xong).
  useEffect(() => {
    if (batchDone && failedEntries.length === 0) {
      api.clearDraft().catch(() => {})
    }
  }, [batchDone, failedEntries.length])

  // ==================== RENDER ====================
  return (
    <div className="min-h-svh bg-neutral-50 dark:bg-neutral-950">
      <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col items-center">
        <header className="mb-6 flex flex-col items-center text-center w-full">
          <div className="w-full flex items-center justify-center relative mb-5">
            <button
              type="button"
              onClick={onBack}
              className="absolute left-0 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer"
            >
              ← Đổi kênh
            </button>
            <div className="flex items-center gap-2.5">
              <TikTokIcon size={34} />
              <h1 className="text-xl font-bold text-neutral-900 dark:text-white tracking-tight">
                TikTok Automation
              </h1>
            </div>
            <button
              type="button"
              onClick={openSettings}
              disabled={!defaults}
              className="absolute right-0 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >
              ⚙ Cài đặt mặc định
            </button>
          </div>
          {step !== 'backend' && (
            <Tabs
              items={STEP_ORDER.map((s) => ({ key: s, label: STEP_LABEL[s] }))}
              active={step}
              reachable={reachableSteps}
              onChange={(k) => setStep(k as Step)}
            />
          )}
        </header>

        <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Cài đặt giá trị mặc định">
          <div className="space-y-4">
            <Callout tone="info">
              Áp dụng cho batch MỚI xác nhận sau khi lưu (không đổi video đã có sẵn trong batch
              đang chỉnh). Dự án đang để mặc định theo brand máy sấy tóc LUNO - đổi lại theo sản
              phẩm/kênh của bạn ở đây.
            </Callout>
            <div>
              <Label>Mô tả mặc định</Label>
              <textarea
                rows={2}
                className={inputClass}
                value={settingsForm.caption}
                onChange={(e) => setSettingsForm((f) => ({ ...f, caption: e.target.value }))}
              />
            </div>
            <div>
              <Label>Hashtag mặc định (cách nhau bằng dấu cách)</Label>
              <input
                type="text"
                className={inputClass}
                value={settingsForm.hashtagsText}
                onChange={(e) => setSettingsForm((f) => ({ ...f, hashtagsText: e.target.value }))}
              />
            </div>
            <div>
              <Label>ID sản phẩm mặc định</Label>
              <input
                type="text"
                className={inputClass}
                value={settingsForm.productId}
                onChange={(e) => setSettingsForm((f) => ({ ...f, productId: e.target.value }))}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <Label>Cover - giây thứ (mặc định)</Label>
                <input
                  type="number"
                  className={`${inputClass} w-28`}
                  value={settingsForm.coverSecond}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, coverSecond: parseInt(e.target.value, 10) || 0 }))
                  }
                />
              </div>
              <div>
                <Label>Nhạc nền (dB) mặc định</Label>
                <input
                  type="number"
                  className={`${inputClass} w-28`}
                  value={settingsForm.musicVolumeDb}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, musicVolumeDb: parseInt(e.target.value, 10) || 0 }))
                  }
                />
              </div>
              <div>
                <Label>Nghỉ giữa các video (giây)</Label>
                <input
                  type="number"
                  className={`${inputClass} w-28`}
                  value={settingsForm.delayBetweenPosts}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, delayBetweenPosts: parseInt(e.target.value, 10) || 0 }))
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSaveSettings} disabled={settingsSaving}>
                {settingsSaving ? 'Đang lưu...' : 'Lưu cài đặt'}
              </Button>
              <Button variant="ghost" onClick={() => setShowSettings(false)}>
                Huỷ
              </Button>
            </div>
          </div>
        </Modal>

        <div className="w-full">

        {error && (
          <div className="mb-5">
            <Callout tone="danger">{error}</Callout>
          </div>
        )}

        {step === 'backend' && (
          <Card>
            <p className="text-neutral-500 text-sm">⏳ Đang kết nối backend...</p>
          </Card>
        )}

        {step === 'cookie' && (
          <Card>
            <CardTitle>Đăng nhập TikTok</CardTitle>
            <CardDescription>
              Lưu tối đa 3 tài khoản - thêm tài khoản thứ 4 sẽ tự xoá tài khoản cũ nhất.
            </CardDescription>

            {accounts.length > 0 && (
              <div className="space-y-2 mb-5">
                <Label>Chọn tài khoản đang dùng</Label>
                {accounts.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => handleActivateAccount(acc.id)}
                    className={[
                      'w-full flex items-center justify-between rounded-lg border-2 px-4 py-2.5 text-left transition-colors cursor-pointer',
                      activeAccountId === acc.id
                        ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30'
                        : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700',
                    ].join(' ')}
                  >
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {activeAccountId === acc.id && '✓ '}
                      {acc.label}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {new Date(acc.saved_at).toLocaleString('vi-VN')}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {sessionStatus?.has_session && !showAddAccount && (
              <Callout tone="success" className="mb-4">
                Tài khoản đang chọn đã có session lưu sẵn - có thể bỏ qua, bấm "Tiếp tục".
              </Callout>
            )}

            {accounts.length === 0 || showAddAccount ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-4 py-4">
                  <StepList
                    items={[
                      <>Mở Chrome, đăng nhập sẵn tài khoản TikTok muốn dùng.</>,
                      <>
                        Bấm <b>F12</b> để mở DevTools → chọn tab <b>Network</b>.
                      </>,
                      <>
                        Nhấn <b>F5</b> để tải lại trang.
                      </>,
                      <>
                        Trong danh sách request, click vào 1 request bất kỳ tới{' '}
                        <code>www.tiktok.com</code>.
                      </>,
                      <>
                        Ở panel bên phải, chọn tab <b>Headers</b> → cuộn tới mục{' '}
                        <b>Request Headers</b>.
                      </>,
                      <>
                        Copy toàn bộ giá trị của dòng <code>cookie:</code> dán vào ô bên dưới.
                      </>,
                    ]}
                  />
                </div>

                <div>
                  <Label htmlFor="account-label">Tên gợi nhớ (tuỳ chọn)</Label>
                  <input
                    id="account-label"
                    type="text"
                    className={`${inputClass} max-w-xs`}
                    placeholder="vd: LUNO chính"
                    value={newAccountLabel}
                    onChange={(e) => setNewAccountLabel(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="cookie-input">Chuỗi cookie</Label>
                  <textarea
                    id="cookie-input"
                    rows={4}
                    className={inputClass}
                    placeholder="Dán chuỗi cookie vào đây..."
                    value={cookie}
                    onChange={(e) => setCookie(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button onClick={handleSaveNewAccount} disabled={!cookie.trim()}>
                    Lưu tài khoản {accounts.length >= 3 ? '(sẽ xoá tài khoản cũ nhất)' : 'mới'}
                  </Button>
                  {accounts.length > 0 && (
                    <Button variant="ghost" onClick={() => setShowAddAccount(false)}>
                      Huỷ
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setShowAddAccount(true)}>
                + Thêm tài khoản khác
              </Button>
            )}

            <div className="flex items-center gap-3 mt-6">
              <Button onClick={() => setStep('mode')} disabled={!activeAccountId}>
                Tiếp tục →
              </Button>
            </div>

            {today && (
              <Callout tone="info" className="mt-5">
                <div>
                  Hôm nay: <b>{today.today}</b> — chỉ lên lịch được tới{' '}
                  <b>{today.max_schedule_date}</b> · Ước tính đang có{' '}
                  <b>{today.estimated_currently_scheduled}</b>/{today.max_scheduled_allowed} video đã
                  lên lịch (~{today.estimated_remaining_slots} chỗ trống)
                </div>
                <div className="text-xs opacity-70 mt-1.5">{today.estimate_note}</div>
              </Callout>
            )}
          </Card>
        )}

        {step === 'mode' && (
          <Card>
            <CardTitle>Muốn lên lịch đăng hay lưu bản nháp?</CardTitle>
            <CardDescription>Áp dụng cho toàn bộ video trong batch này.</CardDescription>

            <div className="grid grid-cols-2 gap-4 mt-2">
              {(
                [
                  ['schedule', 'Lên lịch đăng thật', 'Video sẽ được TikTok lên lịch đăng đúng ngày giờ chọn'],
                  ['draft', 'Lưu bản nháp', 'Lưu vào TikTok Studio, tự đăng tay sau'],
                ] as const
              ).map(([value, title, desc]) => (
                <label
                  key={value}
                  className={[
                    'cursor-pointer rounded-xl border-2 p-4 transition-colors duration-150',
                    mode === value
                      ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30'
                      : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <div className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                    {title}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">{desc}</div>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-6">
              <Button variant="secondary" onClick={() => setStep('cookie')}>
                ← Quay lại
              </Button>
              <Button onClick={() => setStep('videos')}>Tiếp tục →</Button>
            </div>
          </Card>
        )}

        {step === 'videos' && (
          <Card>
            <CardTitle>Chọn video</CardTitle>
            <CardDescription>
              Dùng 1 trong 2 cách bên dưới (hoặc cả 2) - kết quả gộp chung vào 1 danh sách.
            </CardDescription>

            <div className="grid sm:grid-cols-2 gap-4 mt-2">
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🔢</span>
                  <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                    Theo dải số thứ tự
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mb-3">
                  Chọn 1 folder, lọc theo số trong tên file (vd <code>video_040</code> →{' '}
                  <code>video_051</code>). Có thể lặp lại với nhiều folder khác nhau.
                </p>

                <div className="flex items-center gap-3">
                  <Button variant="secondary" onClick={handlePickFolder}>
                    📁 Chọn folder
                  </Button>
                </div>
                <div className="text-xs text-neutral-500 break-all mt-1.5 min-h-[1em]">
                  {videoFolder ?? ''}
                </div>

                <div className="flex flex-wrap items-end gap-3 mt-3">
                  <div>
                    <Label htmlFor="num-start">Từ số</Label>
                    <input
                      id="num-start"
                      type="number"
                      className={`${inputClass} w-24`}
                      value={numStart}
                      onChange={(e) => setNumStart(e.target.value)}
                      placeholder="vd 40"
                    />
                  </div>
                  <div>
                    <Label htmlFor="num-end">Đến số</Label>
                    <input
                      id="num-end"
                      type="number"
                      className={`${inputClass} w-24`}
                      value={numEnd}
                      onChange={(e) => setNumEnd(e.target.value)}
                      placeholder="vd 51"
                    />
                  </div>
                  <Button variant="secondary" onClick={handleListVideos} disabled={!videoFolder}>
                    Tìm
                  </Button>
                </div>

                <div className="mt-3 space-y-2">
                  {missingNumbers.length > 0 && (
                    <Callout tone="warning">Thiếu video số: {missingNumbers.join(', ')}</Callout>
                  )}
                  {foundVideos.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Callout tone="success" className="flex-1">
                        Tìm thấy {foundVideos.length} video
                      </Callout>
                      <Button onClick={handleAddFoundVideos}>+ Thêm</Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🎯</span>
                  <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                    Tự chọn video
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mb-3">
                  Mở cửa sổ duyệt file, tự tay chọn từng video tuỳ ý (giữ <b>Ctrl</b>/<b>Shift</b>{' '}
                  để chọn nhiều cùng lúc) - không cần đúng thứ tự số, không cần cùng 1 folder.
                </p>
                <Button variant="secondary" onClick={handlePickIndividualVideos} className="mt-auto">
                  🎬 Duyệt &amp; chọn video
                </Button>
              </div>
            </div>

            {videoBatches.length > 0 && (
              <div className="mt-6 space-y-2">
                <Label>Danh sách đã chọn ({selectedVideos.length} video)</Label>
                {videoBatches.map((b, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2"
                  >
                    <span className="text-xs text-neutral-600 dark:text-neutral-400 break-all">
                      {b.folder} — {b.videos.length} video
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveBatch(idx)}
                      className="text-xs text-rose-600 hover:underline cursor-pointer shrink-0 ml-3"
                    >
                      Xoá
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 mt-6">
              <Button variant="secondary" onClick={() => setStep('mode')}>
                ← Quay lại
              </Button>
              <Button onClick={confirmVideos} disabled={selectedVideos.length === 0}>
                Tiếp tục →
              </Button>
            </div>
          </Card>
        )}

        {step === 'grid' && (
          <Card>
            <CardTitle>Ảnh bìa Grid Layout</CardTitle>
            <CardDescription>
              Tuỳ chọn - mỗi nhóm {gridStyle} video dùng 1 ảnh riêng cắt thành lưới ghép hình trên
              trang hồ sơ TikTok.
            </CardDescription>

            <label className="flex items-center gap-2.5 text-sm font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer mb-4">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-rose-600"
                checked={useGrid}
                onChange={(e) => setUseGrid(e.target.checked)}
              />
              Dùng ảnh bìa Grid Layout cho batch này
            </label>

            {useGrid && (
              <div className="space-y-5">
                <div>
                  <Label>Kiểu lưới</Label>
                  <div className="flex gap-3 mt-1.5">
                    {(
                      [
                        [12, '3x4 - 12 video / ảnh'],
                        [9, '3x3 - 9 video / ảnh'],
                      ] as const
                    ).map(([size, label]) => (
                      <label
                        key={size}
                        className={[
                          'cursor-pointer rounded-lg border-2 px-4 py-2 text-sm font-medium transition-colors',
                          gridStyle === size
                            ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                            : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          checked={gridStyle === size}
                          onChange={() => setGridStyle(size)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <Callout tone="info">
                  {entries.length} video đã chọn → chia thành{' '}
                  <b>{gridChunks.chunks.length} nhóm</b> ({gridStyle} video/nhóm, mỗi nhóm 1 ảnh
                  riêng)
                  {gridChunks.leftover.length > 0 && (
                    <>
                      , còn dư <b>{gridChunks.leftover.length}</b> video sẽ dùng ảnh bìa thường
                      (không phải Grid)
                    </>
                  )}
                  .
                </Callout>

                <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-4 py-4">
                  <StepList
                    items={[
                      <>
                        Với mỗi nhóm bên dưới: chọn 1 ảnh dọc (khuyến nghị tỉ lệ 9:16, vd
                        1080x1920) riêng cho nhóm đó.
                      </>,
                      <>Bấm "Cắt ảnh" và đợi xử lý xong (vài giây).</>,
                      <>
                        Xem lại {gridStyle} mảnh hiện ra đúng thứ tự chưa - mảnh sẽ tự gán vào video
                        trong nhóm theo đúng lịch đăng ở bước sau.
                      </>,
                    ]}
                  />
                </div>

                <div className="space-y-4">
                  {gridChunks.chunks.map((chunk, idx) => {
                    const img = chunkImagePaths[idx]
                    const pieces = chunkPieces[idx] ?? []
                    const first = chunk[0]
                    const last = chunk[chunk.length - 1]
                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4"
                      >
                        <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
                          Nhóm {idx + 1} — {chunk.length} video (#{first.number ?? '?'} →{' '}
                          #{last.number ?? '?'})
                          {pieces.length > 0 && <span className="text-emerald-600 ml-2">✓ đã cắt</span>}
                        </div>

                        <div className="flex items-center gap-3">
                          <Button variant="secondary" onClick={() => handlePickChunkImage(idx)}>
                            🖼 Chọn ảnh nguồn
                          </Button>
                          <span className="text-xs text-neutral-500 break-all">
                            {img ?? 'Chưa chọn ảnh'}
                          </span>
                        </div>

                        {img && (
                          <div className="flex items-start gap-4 mt-3">
                            <img
                              className="max-w-[140px] rounded-lg border border-neutral-200 dark:border-neutral-800"
                              src={api.fileUrl(img)}
                              alt="Ảnh nguồn"
                            />
                            <div className="flex flex-col gap-3">
                              <Button variant="secondary" onClick={() => handleSliceChunk(idx)}>
                                Cắt ảnh
                              </Button>
                              {pieces.length > 0 && (
                                <div className="grid grid-cols-3 gap-1 max-w-[220px]">
                                  {pieces.map((p, i) => (
                                    <img
                                      key={p}
                                      src={api.fileUrl(p)}
                                      alt={`piece ${i + 1}`}
                                      className="w-full aspect-[3/4] object-cover rounded"
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 mt-6">
              <Button variant="secondary" onClick={() => setStep('videos')}>
                ← Quay lại
              </Button>
              <Button onClick={() => setStep('details')}>Tiếp tục →</Button>
            </div>
          </Card>
        )}

        {step === 'details' && defaults && (
          <Card>
            <CardTitle>Nội dung & lịch đăng</CardTitle>
            <CardDescription>
              Mô tả, hashtag, lịch đăng, link sản phẩm và nhạc nền cho từng video.
            </CardDescription>

            <div className="mb-5">
              <div className="flex items-center gap-2">
                <Label htmlFor="product-id" className="mb-0">
                  ID sản phẩm gắn link affiliate
                </Label>
                <GuideButton onClick={() => setShowProductGuide(true)} label="Cách lấy ID?" />
              </div>
              <input
                id="product-id"
                type="text"
                className={`${inputClass} max-w-xs`}
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                placeholder="vd 1736094128168862925"
              />
            </div>

            <div className="flex items-center gap-4 mb-4">
              <Button variant="secondary" onClick={applyDefaultHashtagsToAll}>
                Dùng hashtag mặc định cho tất cả
              </Button>
              <GuideButton onClick={() => setShowMusicGuide(true)} label="Về nhạc nền" />
            </div>

            <Modal
              open={showProductGuide}
              onClose={() => setShowProductGuide(false)}
              title="Cách lấy ID sản phẩm"
            >
              <StepList
                items={[
                  <>
                    Mở TikTok Studio trên trình duyệt (không qua app) → mở 1 video bất kỳ → bấm
                    "Thêm liên kết" → chọn "Sản phẩm".
                  </>,
                  <>
                    Ở khung tìm kiếm, để trống hoặc gõ tên sản phẩm - danh sách hiện ra sẽ có cột{' '}
                    <b>ID sản phẩm</b>.
                  </>,
                  <>Copy đúng ID sản phẩm muốn gắn link affiliate, dán vào ô bên trên.</>,
                  <>
                    ID này áp dụng cho TẤT CẢ video trong batch (cùng 1 sản phẩm quảng cáo) - mặc
                    định BẬT cho mọi video, có thể tắt riêng từng video ở ô "Gắn link sản phẩm cho
                    video này" nếu video đó không muốn gắn link.
                  </>,
                  <>
                    TikTok tự điền sẵn <b>tên sản phẩm hiển thị trên video</b> theo tên đã cấu hình
                    trên Seller Center - có thể để mặc định, hoặc chọn "Tuỳ chỉnh" để tự gõ tên
                    khác riêng cho từng video (tối đa 30 ký tự, đúng giới hạn thật của TikTok).
                  </>,
                ]}
              />
            </Modal>

            <Modal open={showMusicGuide} onClose={() => setShowMusicGuide(false)} title="Về nhạc nền">
              <p>
                Nhạc nền mặc định <b>BẬT</b> cho mọi video, có thể tắt riêng từng video ở ô "Thêm
                nhạc nền cho video này" nếu không muốn gắn nhạc.
              </p>
              <p className="mt-2">
                Khi bật, nhạc chỉ chọn được bài đã có trong mục "Yêu thích" trên TikTok - thêm bài
                muốn dùng vào Yêu thích trước khi chạy batch.
              </p>
            </Modal>

            <div className="flex flex-col gap-4 max-h-[55vh] overflow-y-auto pr-1">
              {entries.map((e) => {
                const cover = useGrid ? gridAssignment[e.path] : null
                return (
                  <div
                    key={e.path}
                    className="rounded-xl border border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
                  >
                    {/* Header: số thứ tự + tên file + ảnh bìa (nếu có) */}
                    <div className="flex items-center gap-3 px-4 py-3 rounded-t-xl bg-neutral-50 dark:bg-neutral-900/60">
                      {cover ? (
                        <img
                          src={api.fileUrl(cover)}
                          alt="cover"
                          className="w-9 h-12 object-cover rounded shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-12 rounded bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-300 dark:text-neutral-600 text-base shrink-0">
                          🎬
                        </div>
                      )}
                      <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded bg-neutral-200 dark:bg-neutral-700 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 shrink-0">
                        {e.number ?? '?'}
                      </span>
                      <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                        {e.filename}
                      </span>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Nội dung: mô tả + hashtag */}
                      <div>
                        <Label className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-1.5">
                          📝 Nội dung
                        </Label>
                        <textarea
                          rows={2}
                          className={inputClass}
                          value={e.caption}
                          onChange={(ev) => updateEntry(e.path, { caption: ev.target.value })}
                        />
                        <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 mt-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded accent-rose-600"
                            checked={e.useDefaultHashtags}
                            onChange={(ev) => updateEntry(e.path, { useDefaultHashtags: ev.target.checked })}
                          />
                          Hashtag mặc định: {defaults.hashtags.join(' ')}
                        </label>
                        {!e.useDefaultHashtags && (
                          <input
                            type="text"
                            className={`${inputClass} mt-2`}
                            placeholder="#hashtag1 #hashtag2 ..."
                            value={e.customHashtags}
                            onChange={(ev) => updateEntry(e.path, { customHashtags: ev.target.value })}
                          />
                        )}
                      </div>

                      {/* Lịch đăng + ảnh bìa */}
                      <div className="border-t border-neutral-100 dark:border-neutral-800 pt-4">
                        <Label className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-1.5">
                          📅 Lịch đăng{!cover && ' & ảnh bìa'}
                        </Label>
                        <div className="flex flex-wrap gap-4">
                          <div>
                            <Label className="text-xs">Ngày</Label>
                            <input
                              type="date"
                              className={`${inputClass} w-40`}
                              value={e.scheduleDate}
                              onChange={(ev) => updateEntry(e.path, { scheduleDate: ev.target.value })}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Giờ</Label>
                            <input
                              type="time"
                              className={`${inputClass} w-32`}
                              value={e.scheduleTime}
                              onChange={(ev) => updateEntry(e.path, { scheduleTime: ev.target.value })}
                            />
                            <div className="flex gap-1 mt-1.5">
                              {QUICK_TIME_SLOTS.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => updateEntry(e.path, { scheduleTime: t })}
                                  className={[
                                    'px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer',
                                    e.scheduleTime === t
                                      ? 'bg-rose-600 text-white'
                                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
                                  ].join(' ')}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>
                          {!cover && (
                            <div>
                              <Label className="text-xs">Cover - giây thứ</Label>
                              <input
                                type="number"
                                className={`${inputClass} w-24`}
                                value={e.coverSecond}
                                onChange={(ev) =>
                                  updateEntry(e.path, { coverSecond: parseInt(ev.target.value, 10) || 0 })
                                }
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sản phẩm + nhạc nền */}
                      <div className="border-t border-neutral-100 dark:border-neutral-800 pt-4 flex flex-wrap gap-6">
                        <div className="min-w-[220px]">
                          <Label className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-1.5">
                            🔗 Sản phẩm
                          </Label>
                          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded accent-rose-600"
                              checked={e.addProductLink}
                              onChange={(ev) => updateEntry(e.path, { addProductLink: ev.target.checked })}
                            />
                            Gắn link sản phẩm{!e.addProductLink && ' (đã tắt)'}
                          </label>

                          {e.addProductLink && (
                            <div className="mt-2 space-y-2">
                              <div className="flex gap-2">
                                {(
                                  [
                                    [true, 'Tên mặc định'],
                                    [false, 'Tuỳ chỉnh'],
                                  ] as const
                                ).map(([val, label]) => (
                                  <button
                                    key={label}
                                    type="button"
                                    onClick={() => updateEntry(e.path, { useDefaultProductName: val })}
                                    className={[
                                      'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer',
                                      e.useDefaultProductName === val
                                        ? 'bg-rose-600 text-white'
                                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
                                    ].join(' ')}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                              {!e.useDefaultProductName && (
                                <div>
                                  <input
                                    type="text"
                                    maxLength={30}
                                    className={`${inputClass} max-w-xs`}
                                    placeholder="Tên sản phẩm hiển thị trên video"
                                    value={e.customProductName}
                                    onChange={(ev) =>
                                      updateEntry(e.path, { customProductName: ev.target.value.slice(0, 30) })
                                    }
                                  />
                                  <div className="text-[11px] text-neutral-400 mt-0.5">
                                    {e.customProductName.length}/30
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="min-w-[160px]">
                          <Label className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-1.5">
                            🎵 Nhạc nền
                          </Label>
                          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded accent-rose-600"
                              checked={e.addMusic}
                              onChange={(ev) => updateEntry(e.path, { addMusic: ev.target.checked })}
                            />
                            Thêm nhạc nền{!e.addMusic && ' (đã tắt)'}
                          </label>
                          {e.addMusic && (
                            <div className="mt-2">
                              <Label className="text-xs">Âm lượng (dB)</Label>
                              <input
                                type="number"
                                className={`${inputClass} w-24`}
                                value={e.musicVolumeDb}
                                onChange={(ev) =>
                                  updateEntry(e.path, { musicVolumeDb: parseInt(ev.target.value, 10) || 0 })
                                }
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3 mt-6">
              <Button variant="secondary" onClick={() => setStep('grid')}>
                ← Quay lại
              </Button>
              <Button onClick={() => setStep('run')}>Tiếp tục →</Button>
            </div>
          </Card>
        )}

        {step === 'run' && (
          <Card>
            <CardTitle>Chạy hàng loạt</CardTitle>
            <CardDescription>
              {entries.length} video · chế độ:{' '}
              <b>{mode === 'schedule' ? 'Lên lịch đăng' : 'Lưu bản nháp'}</b>
            </CardDescription>

            {mode === 'schedule' && today && entries.length > today.estimated_remaining_slots && (
              <Callout tone="warning" className="mb-4">
                Ước tính chỉ còn ~{today.estimated_remaining_slots} chỗ trống trong hàng đợi 30 video
                của TikTok - batch này có {entries.length} video, có thể vượt giới hạn.
              </Callout>
            )}

            {restoredDraft && (
              <Callout tone="info" className="mb-4">
                Đã khôi phục {entries.length} video từ batch dở dang trước đó (lưu tự động, không
                mất khi đóng/mở lại app).
                {entries.length - pendingEntries.length > 0 &&
                  ` ${entries.length - pendingEntries.length} video đã đăng thành công thật trước đó sẽ tự động BỎ QUA, không đăng trùng.`}
                {' '}
                <button
                  type="button"
                  onClick={handleClearDraft}
                  className="underline hover:no-underline cursor-pointer"
                >
                  Xoá dữ liệu đã lưu, làm lại từ đầu
                </button>
                .
              </Callout>
            )}

            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={() => setStep('details')} disabled={running}>
                ← Quay lại
              </Button>
              <Button
                onClick={handleRunBatch}
                disabled={running || pendingEntries.length === 0 || batchDone}
                className={batchDone ? '!bg-emerald-600 hover:!bg-emerald-600' : ''}
              >
                {running
                  ? 'Đang chạy...'
                  : batchDone
                    ? `✓ Đã ${mode === 'schedule' ? 'lên lịch' : 'lưu nháp'} xong`
                    : `Bắt đầu ${mode === 'schedule' ? 'lên lịch' : 'lưu nháp'} ${pendingEntries.length} video`}
              </Button>
              {batchDone && failedEntries.length > 0 && (
                <Button variant="secondary" onClick={handleRetryFailed} disabled={running}>
                  🔁 Chạy lại {failedEntries.length} video lỗi
                </Button>
              )}
            </div>

            {batchDone && moderationFailedEntries.length > 0 && (
              <Callout tone="warning" className="mt-5">
                <div className="mb-2">
                  {moderationFailedEntries.length} video bị TikTok <b>chặn vì kiểm duyệt nội dung</b>{' '}
                  - thử lại y hệt file cũ nhiều khả năng vẫn bị chặn giống vậy. Chọn video khác thay
                  thế cho từng video bên dưới (mô tả/hashtag/lịch/ảnh bìa/nhạc/sản phẩm đã điền vẫn
                  giữ nguyên), rồi bấm "🔁 Chạy lại video lỗi" ở trên để đăng video mới.
                </div>
                <div className="space-y-2">
                  {moderationFailedEntries.map((e) => (
                    <div
                      key={e.path}
                      className="flex items-center justify-between gap-3 rounded-lg bg-white/60 dark:bg-black/20 px-3 py-2"
                    >
                      <span className="text-xs text-neutral-700 dark:text-neutral-300 truncate">
                        #{e.number ?? '?'} {e.filename}
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() => handleReplaceVideo(e.path)}
                        disabled={running}
                        className="shrink-0"
                      >
                        🎬 Chọn video thay thế
                      </Button>
                    </div>
                  ))}
                </div>
              </Callout>
            )}

            {batchId && (
              <div className="mt-5 rounded-xl bg-neutral-950 text-neutral-200 font-mono text-xs p-4 max-h-80 overflow-y-auto">
                {progressLog.map((ev, i) => (
                  <div
                    key={i}
                    className={
                      ev.type === 'fatal' || (ev.type === 'video_done' && ev.status !== 'success')
                        ? 'text-rose-400'
                        : ev.type === 'batch_done'
                          ? 'text-emerald-400'
                          : ''
                    }
                  >
                    {ev.type === 'video_start' && `▶ [${(ev.index ?? 0) + 1}/${ev.total}] ${ev.video}`}
                    {ev.type === 'step' && `   ✓ ${ev.step}`}
                    {ev.type === 'video_done' &&
                      (ev.status === 'success'
                        ? `✅ Xong video ${(ev.index ?? 0) + 1}/${ev.total}`
                        : `❌ Lỗi video ${(ev.index ?? 0) + 1}/${ev.total}: ${ev.error}`)}
                    {ev.type === 'batch_done' && '✅ HOÀN TẤT BATCH'}
                    {ev.type === 'fatal' && `❌ ${ev.message}`}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
        </div>
      </div>
    </div>
  )
}
