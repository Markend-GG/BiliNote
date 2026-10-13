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
