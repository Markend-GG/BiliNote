import request from '@/utils/request'

export interface OrphanFile {
  name: string
  size: number
  mtime: number
  referenced: boolean
}

export interface StorageScan {
  screenshots: {
    count: number
    bytes: number
    orphan_count: number
    orphan_bytes: number
  }
  orphans: OrphanFile[]
  note_results_bytes: number
  vector_db_bytes: number
}

export interface DeleteOrphansResult {
  deleted: string[]
  skipped: string[]
}

export const scanStorage = () => request.get<any, StorageScan>('/storage/scan')

/** 服务端删除前会重算引用集，被任何笔记引用的都会进 skipped */
export const deleteOrphans = (names: string[]) =>
  request.post<any, DeleteOrphansResult>('/storage/delete', { names })

export interface CleanupPolicy {
  enabled: boolean
  /** 孤儿超过多少天自动删；0 = 不按天数清理 */
  keep_days: number
  /** 孤儿总量上限（MB），超了从最旧的开始删；0 = 不按容量清理。只算孤儿，不含被引用的截图 */
  max_orphan_mb: number
}

export interface CleanupRun {
  at: number
  reason: 'schedule' | 'manual' | string
  aged_deleted: number
  over_cap_deleted: number
  deleted: number
  skipped: number
  freed_bytes: number
  remaining_orphans: number
  remaining_orphan_bytes: number
}

export interface CleanupStatus {
  policy: CleanupPolicy
  last_run: CleanupRun | null
}

export const getCleanupStatus = () => request.get<any, CleanupStatus>('/storage/cleanup_policy')

export const saveCleanupPolicy = (patch: Partial<CleanupPolicy>) =>
  request.post<any, CleanupPolicy>('/storage/cleanup_policy', patch)

/** 界面上的「立即清理」：手动触发不受启用开关限制 */
export const runCleanup = () => request.post<any, CleanupRun>('/storage/cleanup_run')
