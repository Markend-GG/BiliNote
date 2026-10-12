import type { ShelfItem } from '@/hooks/useShelfItems'
import { taskStatusLabels, videoPlatforms } from '@/constant/note'

/** 拖拽归档用的自定义 MIME。用 text/plain 会和"拖文字"混淆 */
export const NOTE_DRAG_MIME = 'text/bilinote-note'

// 纯 web 构建下 VITE_API_BASE_URL 是空的（只有 .env.tauri 里有）。兜底必须是【绝对】的 /api：
// 详情页在 /note/:taskId 这一层，写成相对的 'api' 会被解析成 /note/api/...
const baseURL = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

/**
 * 封面要走后端代理：B 站等站点的图片有防盗链，浏览器直接拉会 403。
 * 本地视频存的是文件路径，直连即可。
 */
export const coverSrc = (item: ShelfItem) => {
  const url = item.coverUrl
  if (!url) return '/placeholder.png'
  if (item.platform === 'local') return url
  return `${baseURL}/image_proxy?url=${encodeURIComponent(url)}`
}

export const platformLogo = (platform?: string | null) =>
  videoPlatforms.find(p => p.value === platform)?.logo ?? null

export const platformLabel = (platform?: string | null) =>
  videoPlatforms.find(p => p.value === platform)?.label ?? ''

export const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 一律按浏览器本地时区显示。容器里是 UTC，直接把后端时间戳当本地时间会差 8 小时 */
export const formatDate = (ms?: number | null) => {
  if (!ms) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export interface StatusMeta {
  label: string
  className: string
  running: boolean
}

export const statusMeta = (status: string): StatusMeta => {
  if (status === 'SUCCESS') {
    return { label: '已完成', className: 'bg-emerald-50 text-emerald-700', running: false }
  }
  if (status === 'FAILED') {
    return { label: '生成失败', className: 'bg-red-50 text-red-700', running: false }
  }
  return {
    label: taskStatusLabels[status] || '生成中',
    className: 'bg-blue-50 text-blue-700',
    running: true,
  }
}
