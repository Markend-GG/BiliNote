import request from '@/utils/request'

export interface LibraryFolder {
  id: string
  name: string
  sort_order: number
  created_at: number | null
  note_count?: number
}

export interface LibraryNote {
  task_id: string
  title: string | null
  video_title: string | null
  folder_id: string | null
  status: string | null
  video_id: string | null
  platform: string | null
  cover_url: string | null
  duration: number | null
  created_at: number | null
  updated_at: number | null
  last_opened_at: number | null
  /** 生成时的表单参数，浏览器本地记录丢了以后靠它恢复「重新生成」 */
  form_data: Record<string, any> | null
}

export interface LibraryPayload {
  folders: LibraryFolder[]
  notes: LibraryNote[]
}

export type DeleteFolderMode = 'move' | 'delete'

export interface NoteVersion {
  ver_id: string
  content: string
  style: string | null
  model_name: string | null
  /** epoch 毫秒 */
  created_at: number | null
}

export interface VersionUpload {
  ver_id: string
  content: string
  style?: string | null
  model_name?: string | null
  created_at?: number | null
}

// 响应拦截器已经把 { code, msg, data } 拆成了 data，所以第二个泛型参数才是真正拿到的类型。
// 所有时间字段是 epoch 毫秒（后端存的是 naive UTC，返回 ISO 字符串会被 new Date() 当本地时间解析）。
export const getLibrary = () => request.get<any, LibraryPayload>('/library')

export const createFolder = (name: string) =>
  request.post<any, LibraryFolder>('/library/folder', { name })

export const renameFolder = (id: string, name: string) =>
  request.patch<any, LibraryFolder>(`/library/folder/${id}`, { name })

export const deleteFolder = (id: string, mode: DeleteFolderMode) =>
  request.delete<any, { deleted_notes: number }>(`/library/folder/${id}`, { params: { mode } })

export const moveNote = (taskId: string, folderId: string | null) =>
  request.post<any, { task_id: string; folder_id: string | null }>('/library/move', {
    task_id: taskId,
    folder_id: folderId,
  })

export const renameNote = (taskId: string, title: string) =>
  request.post<any, { task_id: string; title: string | null }>('/library/rename', {
    task_id: taskId,
    title,
  })

/** 进详情页时打点，书架页的「最近打开」靠它排序。失败不值得打扰用户。 */
export const touchNote = (taskId: string) =>
  request.post<any, null>('/library/touch', { task_id: taskId }, { suppressToast: true })

/** 版本历史（新在前）。后端是权威存储，浏览器本地那份只是缓存。 */
export const getVersions = (taskId: string) =>
  request.get<any, NoteVersion[]>(`/library/versions/${taskId}`)

/** 浏览器存量版本一次性上传，按 ver_id 去重 */
export const syncVersions = (taskId: string, versions: VersionUpload[]) =>
  request.post<any, { added: number }>('/library/versions/sync', { task_id: taskId, versions })

export const deleteServerVersion = (taskId: string, verId: string) =>
  request.delete<any, null>(`/library/versions/${taskId}/${verId}`)

export interface SearchHit {
  task_id: string
  heading: string
  /** 摘要里 \x01/\x02 之间是命中词，前端切分后渲染高亮，不能直接当 HTML 用 */
  snippet: string
  title?: string | null
  folder_id?: string | null
}

/** 正文全文搜索（FTS5 trigram，中文子串可命中） */
export const searchNotes = (q: string) =>
  request.get<any, SearchHit[]>('/search', { params: { q } })
