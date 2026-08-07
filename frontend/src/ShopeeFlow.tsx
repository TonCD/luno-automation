import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { Button } from './components/ui/Button'
import { Card, CardDescription, CardTitle } from './components/ui/Card'
import { Callout } from './components/ui/Callout'
import { Tabs } from './components/ui/Tabs'
import { Label, inputClass } from './components/ui/Field'
import { StepList } from './components/ui/StepList'
import { ShopeeIcon } from './components/ui/ShopeeIcon'
import { Modal } from './components/ui/Modal'
import type {
  AccountInfo,
  PostMode,
  ProgressEvent,
  SessionStatus,
  ShopeeDefaultsInfo,
  ShopeeVideoEntry,
  VideoInfo,
} from './types'

type Step = 'backend' | 'cookie' | 'mode' | 'videos' | 'details' | 'run'

const STEP_ORDER: Step[] = ['cookie', 'mode', 'videos', 'details', 'run']
const STEP_LABEL: Record<Step, string> = {
  backend: 'Kết nối',
  cookie: 'Đăng nhập',
  mode: 'Chế độ đăng',
  videos: 'Chọn video',
  details: 'Nội dung & Lịch đăng',
  run: 'Chạy hàng loạt',
}

const QUICK_TIME_SLOTS = ['08:00', '12:00', '16:00', '20:00']

// Lưu tạm toàn bộ dữ liệu batch đang chỉnh (entries, mode, sản phẩm) ra FILE
// trên đĩa qua backend (`/shopee/draft` -> shopee_batch_draft.json) - KHÔNG
// mất khi phải đóng/mở lại app (vd để nhận code backend mới sau khi sửa lỗi
// giữa chừng 1 batch dài). Từng thử localStorage của trình duyệt trước đó
// nhưng không đáng tin cậy để khôi phục qua lần restart nguyên cụm
// Electron+Vite dev - file trên đĩa không phụ thuộc gì vào trình duyệt/
// Electron, giống hệt cách accounts/state đã lưu.
interface ShopeeDraft {
  mode: PostMode
  productQuery: string
  productId: string
  entries: ShopeeVideoEntry[]
}

// Video có thể chọn từ NHIỀU folder khác nhau (nhiều lần "Tìm video" + "Thêm
// vào danh sách") - giống hệt cơ chế bên TiktokFlow.tsx.
interface VideoBatch {
  folder: string
  videos: VideoInfo[]
}

export function ShopeeFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>('backend')
  const [backendOk, setBackendOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [cookie, setCookie] = useState('')
  const [newAccountLabel, setNewAccountLabel] = useState('')
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  const [defaults, setDefaults] = useState<ShopeeDefaultsInfo | null>(null)

  const [showSettings, setShowSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    caption: '',
    hashtagsText: '',
    productQuery: '',
    coverRatioPct: 10,
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

  const [entries, setEntries] = useState<ShopeeVideoEntry[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [productId, setProductId] = useState('')

  const [batchId, setBatchId] = useState<string | null>(null)
  const [progressLog, setProgressLog] = useState<ProgressEvent[]>([])
  const [running, setRunning] = useState(false)
  const [batchDone, setBatchDone] = useState(false)

  const [restoredDraft, setRestoredDraft] = useState(false)
  // State (KHÔNG phải ref) có chủ đích: effect autosave bên dưới đọc giá trị
  // này TỪ CHÍNH LẦN RENDER của nó - nếu dùng ref, effect restore mutate ref
  // xong NGAY trong cùng 1 lượt effect-flush, khiến effect autosave (chạy sau
  // effect restore trong CÙNG lượt mount) đọc phải ref đã true nhưng entries
  // vẫn là [] (state rỗng ban đầu, chưa kịp áp dụng setEntries của effect
  // restore) -> tưởng "hydrate xong mà rỗng" rồi tự xoá mất draft vừa đọc
  // được. Dùng state thì effect autosave chỉ thấy hydrated=true ở lượt render
  // MỚI (sau khi setEntries từ restore đã áp dụng xong), tránh race này.
  const [hydrated, setHydrated] = useState(false)

  // Khôi phục batch dở dang (nếu có) từ backend NGAY khi kết nối được (cần
  // backendOk vì giờ đọc qua API, không phải localStorage đồng bộ nữa). Đối
  // chiếu thêm với shopee_upload_state.json để tự đánh dấu video nào ĐÃ đăng
  // thành công thật, tránh đăng trùng khi chạy lại (xem effect ngay bên dưới).
  useEffect(() => {
    if (!backendOk) return
    api.shopee
      .getDraft()
      .then((raw) => {
        const draft = raw as ShopeeDraft | null
        if (draft && draft.entries && draft.entries.length > 0) {
          setMode(draft.mode)
          setProductQuery(draft.productQuery)
          setProductId(draft.productId)
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
    api.shopee
      .state()
      .then((state) => {
        setEntries((prev) =>
          prev.map((e) => ({ ...e, alreadyDone: state[e.path]?.status === 'success' })),
        )
      })
      .catch(() => {})
  }, [restoredDraft, backendOk])

  // Tự lưu lại mỗi khi entries/mode/sản phẩm đổi - CHỈ sau khi đã hydrate xong
  // (tránh ghi đè dữ liệu cũ bằng state rỗng lúc mới mount/trước khi restore
  // xong) và chỉ khi có video (không lưu batch rỗng). Debounce 800ms để không
  // gọi API liên tục khi đang gõ caption từng ký tự.
  useEffect(() => {
    if (!hydrated) return
    const timer = setTimeout(() => {
      if (entries.length === 0) {
        api.shopee.clearDraft().catch(() => {})
        return
      }
      api.shopee.saveDraft({ mode, productQuery, productId, entries }).catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [hydrated, entries, mode, productQuery, productId])

  function handleClearDraft() {
    api.shopee.clearDraft().catch(() => {})
    setRestoredDraft(false)
    setEntries([])
    setVideoBatches([])
    setFoundVideos([])
    setStep('cookie')
  }

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
    const res = await api.shopee.listAccounts()
    setAccounts(res.accounts)
    setActiveAccountId(res.active_id)
  }

  useEffect(() => {
    if (!backendOk) return
    api.shopee.sessionStatus().then(setSessionStatus).catch(() => {})
    api.shopee.defaults().then((d) => {
      setDefaults(d)
      setProductQuery(d.product_query)
    }).catch(() => {})
    loadAccounts().catch(() => {})
  }, [backendOk])

  function openSettings() {
    if (!defaults) return
    setSettingsForm({
      caption: defaults.caption,
      hashtagsText: defaults.hashtags.join(' '),
      productQuery: defaults.product_query,
      coverRatioPct: Math.round(defaults.cover_ratio * 100),
      delayBetweenPosts: defaults.delay_between_posts,
    })
    setShowSettings(true)
  }

  async function handleSaveSettings() {
    setSettingsSaving(true)
    setError(null)
    try {
      const updated = await api.shopee.updateDefaults({
        caption: settingsForm.caption,
        hashtags: settingsForm.hashtagsText.split(/\s+/).filter(Boolean),
        product_query: settingsForm.productQuery,
        cover_ratio: Math.min(Math.max(settingsForm.coverRatioPct / 100, 0), 1),
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

  const reachableSteps = useMemo(() => {
    const s = new Set<string>(['cookie'])
    if (backendOk) s.add('mode')
    if (mode) s.add('videos')
    if (entries.length > 0) {
      s.add('details')
      s.add('run')
    }
    return s
  }, [backendOk, mode, entries])

  // ==================== BƯỚC: TÀI KHOẢN ====================
  async function handleActivateAccount(id: string) {
    setError(null)
    try {
      await api.shopee.activateAccount(id)
      setActiveAccountId(id)
      const s = await api.shopee.sessionStatus()
      setSessionStatus(s)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleSaveNewAccount() {
    if (!cookie.trim()) return
    setError(null)
    try {
      await api.shopee.saveAccount(cookie, newAccountLabel)
      setCookie('')
      setNewAccountLabel('')
      setShowAddAccount(false)
      await loadAccounts()
      const s = await api.shopee.sessionStatus()
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
      // include_duration=true - cần thời lượng từng video để đổi "chọn cover
      // tại giây thứ N" (ô nhập quen thuộc) sang % vị trí mà Shopee cần, thay
      // vì bắt user tự tính % bằng tay.
      const res = await api.listVideos(videoFolder, start, end, true)
      setFoundVideos(res.videos)
      setMissingNumbers(res.missing_numbers)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Thêm kết quả vừa tìm (1 folder) vào danh sách tổng - lặp lại để gộp video
  // từ nhiều folder khác nhau vào cùng 1 batch (giống hệt TiktokFlow.tsx).
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
  // sách với cách chọn theo dải số ở trên. include_duration=true (giống
  // handleListVideos) - Shopee cần thời lượng để đổi "giây thứ N" sang % vị
  // trí cover.
  async function handlePickIndividualVideos() {
    const paths = await window.luno.pickVideos()
    if (!paths || paths.length === 0) return
    setError(null)
    try {
      const res = await api.videosByPaths(paths, true)
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
    const nowDate = new Date().toISOString().slice(0, 10)
    const built: ShopeeVideoEntry[] = selectedVideos.map((v) => ({
      ...v,
      caption: defaults.caption,
      useDefaultHashtags: true,
      customHashtags: '',
      scheduleDate: nowDate,
      scheduleTime: '08:00',
      // Gợi ý ban đầu: vị trí mặc định (defaults.cover_ratio) quy đổi ra giây
      // theo thời lượng THẬT của từng video - nếu chưa lấy được thời lượng
      // (ffprobe lỗi), tạm dùng 2s làm mặc định an toàn.
      coverSecond: v.duration_sec ? Math.round(v.duration_sec * defaults.cover_ratio) : 2,
      addProductLink: true,
    }))
    setEntries(built)
    setStep('details')
  }

  // ==================== BƯỚC: CHI TIẾT TỪNG VIDEO ====================
  function updateEntry(path: string, patch: Partial<ShopeeVideoEntry>) {
    setEntries((prev) => prev.map((e) => (e.path === path ? { ...e, ...patch } : e)))
  }

  function applyDefaultHashtagsToAll() {
    setEntries((prev) => prev.map((e) => ({ ...e, useDefaultHashtags: true })))
  }

  // ==================== BƯỚC: CHẠY BATCH ====================
  // Shopee chỉ nhận vị trí cover theo % (0.0-1.0) trên thanh kéo, không có ô
  // nhập giây - nên đổi "giây thứ N" (UX quen thuộc, không cần tự tính %)
  // sang tỉ lệ ngay tại đây, dùng thời lượng THẬT của từng video (lấy kèm lúc
  // liệt kê video). Không biết thời lượng (ffprobe lỗi) -> fallback về vị trí
  // mặc định (defaults.cover_ratio) thay vì chặn chạy batch.
  function coverSecondToRatio(e: ShopeeVideoEntry) {
    if (!e.duration_sec) return defaults?.cover_ratio ?? 0.1
    return Math.min(Math.max(e.coverSecond / e.duration_sec, 0), 1)
  }

  function buildJobPayload(list: ShopeeVideoEntry[]) {
    if (!defaults) return []
    return list.map((e) => ({
      video_path: e.path,
      caption: e.caption,
      hashtags: e.useDefaultHashtags
        ? defaults.hashtags
        : e.customHashtags.split(/\s+/).filter(Boolean),
      schedule_date: e.scheduleDate,
      schedule_time: e.scheduleTime,
      cover_ratio: coverSecondToRatio(e),
      // Bỏ tích "Gắn link sản phẩm" cho video này -> gửi product_query rỗng,
      // shopee_batch_engine.py chỉ gọi add_product_link() khi job.product_query
      // có giá trị (if job.product_query:) nên tự động bỏ qua bước đó.
      product_query: e.addProductLink ? productQuery || '' : '',
      product_id: e.addProductLink ? productId || null : null,
    }))
  }

  async function runJobs(list: ShopeeVideoEntry[]) {
    if (!defaults || list.length === 0) return
    setError(null)
    setBatchDone(false)
    try {
      const { batch_id } = await api.shopee.runBatch({
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

  // Video đã đánh dấu alreadyDone (khôi phục từ shopee_upload_state.json sau
  // restart app) - loại khỏi lượt chạy mặc định để tránh đăng trùng.
  const pendingEntries = useMemo(() => entries.filter((e) => !e.alreadyDone), [entries])
  const skippedCount = entries.length - pendingEntries.length

  function handleRunBatch() {
    runJobs(pendingEntries)
  }

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

  // Batch xong và KHÔNG còn video nào lỗi -> không còn gì để khôi phục, xoá
  // draft đã lưu (tránh lần mở app sau bị "khôi phục" nhầm 1 batch đã xong).
  useEffect(() => {
    if (batchDone && failedEntries.length === 0) {
      api.shopee.clearDraft().catch(() => {})
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
              <ShopeeIcon size={34} />
              <h1 className="text-xl font-bold text-neutral-900 dark:text-white tracking-tight">
                Shopee Automation
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
              <Label>Tiêu đề mặc định</Label>
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
              <Label>Tên sản phẩm mặc định (tìm kiếm)</Label>
              <input
                type="text"
                className={inputClass}
                value={settingsForm.productQuery}
                onChange={(e) => setSettingsForm((f) => ({ ...f, productQuery: e.target.value }))}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <Label>Vị trí cover mặc định (%)</Label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={`${inputClass} w-28`}
                  value={settingsForm.coverRatioPct}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, coverRatioPct: parseInt(e.target.value, 10) || 0 }))
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
            <CardTitle>Đăng nhập Shopee</CardTitle>
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
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30'
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
                      <>Mở Chrome, đăng nhập sẵn tài khoản Shopee (kênh người bán) muốn dùng.</>,
                      <>
                        Bấm <b>F12</b> để mở DevTools → chọn tab <b>Network</b>.
                      </>,
                      <>
                        Nhấn <b>F5</b> để tải lại trang.
                      </>,
                      <>
                        Trong danh sách request, click vào 1 request bất kỳ tới{' '}
                        <code>banhang.shopee.vn</code>.
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
                    placeholder="vd: LUNO Shopee chính"
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
          </Card>
        )}

        {step === 'mode' && (
          <Card>
            <CardTitle>Muốn lên lịch đăng hay lưu bản nháp?</CardTitle>
            <CardDescription>Áp dụng cho toàn bộ video trong batch này.</CardDescription>

            <div className="grid grid-cols-2 gap-4 mt-2">
              {(
                [
                  ['schedule', 'Lên lịch đăng thật', 'Video sẽ được Shopee lên lịch đăng đúng ngày giờ chọn'],
                  ['draft', 'Lưu bản nháp', 'Lưu vào Shopee Creator Center, tự đăng tay sau'],
                ] as const
              ).map(([value, title, desc]) => (
                <label
                  key={value}
                  className={[
                    'cursor-pointer rounded-xl border-2 p-4 transition-colors duration-150',
                    mode === value
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30'
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
                  <code>video_051</code>). Shopee chỉ nhận <code>.mp4</code>.
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

        {step === 'details' && defaults && (
          <Card>
            <CardTitle>Nội dung & lịch đăng</CardTitle>
            <CardDescription>
              Tiêu đề, hashtag, lịch đăng, sản phẩm và ảnh bìa (chọn khung hình video) cho từng video.
            </CardDescription>

            <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-4 py-4 mb-5">
              <StepList
                items={[
                  <>Nhập tên sản phẩm muốn gắn (Shopee chỉ tìm được theo TÊN, không phải ID).</>,
                  <>
                    (Tuỳ chọn) Nếu biết đúng ID sản phẩm, điền thêm vào ô ID để chọn đúng dòng khi
                    tìm ra nhiều sản phẩm giống tên.
                  </>,
                  <>
                    Áp dụng cho TẤT CẢ video trong batch (cùng 1 sản phẩm quảng cáo) - mặc định
                    BẬT cho mọi video, có thể tắt riêng từng video ở ô "Gắn link sản phẩm cho video
                    này" bên dưới nếu video đó không muốn gắn link.
                  </>,
                ]}
              />
            </div>

            <div className="flex flex-wrap gap-4 mb-5">
              <div>
                <Label htmlFor="product-query">Tên sản phẩm (tìm kiếm)</Label>
                <input
                  id="product-query"
                  type="text"
                  className={`${inputClass} max-w-xs`}
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="vd Máy Sấy Tóc LUNO"
                />
              </div>
              <div>
                <Label htmlFor="product-id">ID sản phẩm (tuỳ chọn)</Label>
                <input
                  id="product-id"
                  type="text"
                  className={`${inputClass} max-w-xs`}
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  placeholder="vd 54112300974"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <Button variant="secondary" onClick={applyDefaultHashtagsToAll}>
                Dùng hashtag mặc định cho tất cả
              </Button>
            </div>

            <div className="flex flex-col gap-4 max-h-[55vh] overflow-y-auto pr-1">
              {entries.map((e) => (
                <div
                  key={e.path}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      #{e.number ?? '?'} {e.filename}
                    </span>
                  </div>

                  <textarea
                    rows={2}
                    className={inputClass}
                    value={e.caption}
                    onChange={(ev) => updateEntry(e.path, { caption: ev.target.value })}
                  />

                  <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded accent-orange-600"
                      checked={e.useDefaultHashtags}
                      onChange={(ev) => updateEntry(e.path, { useDefaultHashtags: ev.target.checked })}
                    />
                    Hashtag mặc định: {defaults.hashtags.join(' ')}
                  </label>
                  {!e.useDefaultHashtags && (
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="#hashtag1 #hashtag2 ..."
                      value={e.customHashtags}
                      onChange={(ev) => updateEntry(e.path, { customHashtags: ev.target.value })}
                    />
                  )}

                  <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded accent-orange-600"
                      checked={e.addProductLink}
                      onChange={(ev) => updateEntry(e.path, { addProductLink: ev.target.checked })}
                    />
                    Gắn link sản phẩm cho video này{!e.addProductLink && ' (đã tắt - bỏ qua bước gắn link)'}
                  </label>

                  <div className="flex flex-wrap gap-4 mt-3">
                    <div>
                      <Label>Ngày đăng</Label>
                      <input
                        type="date"
                        className={`${inputClass} w-40`}
                        value={e.scheduleDate}
                        onChange={(ev) => updateEntry(e.path, { scheduleDate: ev.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Giờ đăng</Label>
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
                                ? 'bg-orange-600 text-white'
                                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
                            ].join(' ')}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label>
                        Cover - giây thứ
                        {e.duration_sec ? ` (video dài ${Math.round(e.duration_sec)}s)` : ''}
                      </Label>
                      <input
                        type="number"
                        min={0}
                        max={e.duration_sec ? Math.floor(e.duration_sec) : undefined}
                        className={`${inputClass} w-24`}
                        value={e.coverSecond}
                        onChange={(ev) =>
                          updateEntry(e.path, { coverSecond: parseInt(ev.target.value, 10) || 0 })
                        }
                      />
                      {!e.duration_sec && (
                        <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                          Không xác định được thời lượng video - sẽ dùng vị trí mặc định (~
                          {Math.round((defaults?.cover_ratio ?? 0.1) * 100)}% đầu video) khi chạy.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Callout tone="warning" className="mt-5">
              Ảnh bìa Shopee chỉ chọn được 1 KHUNG HÌNH trong chính video (không upload ảnh tuỳ ý
              được như TikTok) - app tự đổi "giây thứ N" sang % vị trí theo đúng thời lượng từng
              video, không cần tự tính tay.
            </Callout>

            <div className="flex items-center gap-3 mt-6">
              <Button variant="secondary" onClick={() => setStep('videos')}>
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

            {restoredDraft && (
              <Callout tone="info" className="mb-4">
                Đã khôi phục {entries.length} video từ batch dở dang trước đó (lưu tự động, không
                mất khi đóng/mở lại app).
                {skippedCount > 0 &&
                  ` ${skippedCount} video đã đăng thành công thật trước đó sẽ tự động BỎ QUA, không đăng trùng.`}
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
