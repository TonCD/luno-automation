export type PostMode = 'schedule' | 'draft'

export interface VideoInfo {
  number: number | null
  filename: string
  path: string
  duration_sec?: number | null
}

export interface VideoEntry extends VideoInfo {
  caption: string
  useDefaultHashtags: boolean
  customHashtags: string
  scheduleDate: string
  scheduleTime: string
  coverSecond: number
  musicVolumeDb: number
  addProductLink: boolean
  // Tên sản phẩm hiển thị trên video, ở popup xác nhận cuối khi gắn link -
  // mặc định TikTok tự điền sẵn tên đã cấu hình trên Seller Center. Bật
  // useDefaultProductName=false để ghi đè bằng customProductName (tối đa 30
  // ký tự - giới hạn thật của TikTok, có đếm "x/30" ngay trên UI TikTok).
  useDefaultProductName: boolean
  customProductName: string
  addMusic: boolean
  // Chỉ set khi khôi phục lại 1 batch dở dang sau restart app - đối chiếu
  // với tiktok_upload_state.json (video này ĐÃ đăng thành công thật trước
  // đó) để tự loại khỏi lượt chạy tiếp theo, tránh đăng trùng.
  alreadyDone?: boolean
}

export interface TodayInfo {
  today: string
  max_schedule_date: string
  max_scheduled_allowed: number
  estimated_currently_scheduled: number
  estimated_remaining_slots: number
  estimate_source: string
  estimate_note: string
}

export interface SessionStatus {
  has_session: boolean
  has_cookie: boolean
}

export interface AccountInfo {
  id: string
  label: string
  saved_at: string
}

export interface AccountsResponse {
  accounts: AccountInfo[]
  active_id: string | null
}

export interface DefaultsInfo {
  caption: string
  hashtags: string[]
  product_id: string
  cover_second: number
  music_volume_db: number
  delay_between_posts: number
}

export interface ShopeeDefaultsInfo {
  caption: string
  hashtags: string[]
  product_query: string
  cover_ratio: number
  delay_between_posts: number
}

export interface ShopeeVideoEntry extends VideoInfo {
  caption: string
  useDefaultHashtags: boolean
  customHashtags: string
  scheduleDate: string
  scheduleTime: string
  coverSecond: number
  addProductLink: boolean
  // Chỉ set khi khôi phục lại 1 batch dở dang sau restart app - đối chiếu
  // với shopee_upload_state.json (video này ĐÃ đăng thành công thật trước
  // đó) để tự loại khỏi lượt chạy tiếp theo, tránh đăng trùng.
  alreadyDone?: boolean
}

export interface ProgressEvent {
  type: 'video_start' | 'step' | 'video_done' | 'batch_done' | 'fatal'
  index?: number
  total?: number
  video?: string
  step?: string
  status?: 'success' | 'failed'
  error?: string
  // 'moderation' = TikTok chặn đăng vì nội dung có thể vi phạm/bị hạn chế
  // kiểm duyệt (khác lỗi kỹ thuật thường) - thử lại y hệt video đó nhiều khả
  // năng vẫn bị chặn, UI dùng cờ này để gợi ý "chọn video thay thế".
  error_type?: 'moderation' | string | null
  message?: string
}
