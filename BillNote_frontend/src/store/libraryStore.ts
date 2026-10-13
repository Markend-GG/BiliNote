import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import * as api from '@/services/library'
import type {
  DeleteFolderMode,
  LibraryFolder,
  LibraryNote,
  NoteVersion,
  VersionUpload,
} from '@/services/library'

export type ShelfViewMode = 'card' | 'list'

export type ShelfSortMode = 'created' | 'opened' | 'duration' | 'title'

interface LibraryState {
  folders: LibraryFolder[]
  notes: LibraryNote[]
  /** 版本历史缓存（权威在后端），key = task_id，新在前 */
  versionsByTask: Record<string, NoteVersion[]>
  viewMode: ShelfViewMode
  sortMode: ShelfSortMode
  setSortMode: (mode: ShelfSortMode) => void
  loaded: boolean
  loading: boolean
  fetchVersions: (taskId: string) => Promise<void>
  uploadLocalVersions: (taskId: string, versions: VersionUpload[]) => Promise<boolean>
  removeServerVersion: (taskId: string, verId: string) => Promise<boolean>
  fetchLibrary: () => Promise<void>
  setViewMode: (mode: ShelfViewMode) => void
  addFolder: (name: string) => Promise<boolean>
  renameFolder: (id: string, name: string) => Promise<boolean>
  removeFolder: (id: string, mode: DeleteFolderMode) => Promise<boolean>
  moveNote: (taskId: string, folderId: string | null) => Promise<boolean>
  renameNote: (taskId: string, title: string) => Promise<boolean>
  touchNote: (taskId: string) => Promise<void>
  folderName: (folderId: string | null | undefined) => string
}

/**
 * 书架页的数据源。文件夹与笔记索引以后端 SQLite 为准——历史列表以前只存在浏览器
 * IndexedDB 里，清一次缓存就再也找不回来（盘上的 json 没有任何接口能列出来）。
 * 写操作一律先调后端再改本地 state；失败时请求拦截器已经弹过 toast，这里只返回 false。
 */
export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      folders: [],
      notes: [],
      versionsByTask: {},
      viewMode: 'card',
      sortMode: 'created',
      setSortMode: sortMode => set({ sortMode }),
      loaded: false,
      loading: false,

      fetchVersions: async taskId => {
        try {
          const list = await api.getVersions(taskId)
          set(state => ({ versionsByTask: { ...state.versionsByTask, [taskId]: list ?? [] } }))
        } catch {
          // 版本拉不到不阻断阅读：正文还有最新一份兜底
        }
      },

      uploadLocalVersions: async (taskId, versions) => {
        try {
          await api.syncVersions(taskId, versions)
          await get().fetchVersions(taskId)
          return true
        } catch {
          return false
        }
      },

      removeServerVersion: async (taskId, verId) => {
        try {
          await api.deleteServerVersion(taskId, verId)
          await get().fetchVersions(taskId)
          return true
        } catch {
          return false
        }
      },

      fetchLibrary: async () => {
        if (get().loading) return
        set({ loading: true })
        try {
          const data = await api.getLibrary()
          set({
            folders: data?.folders ?? [],
            notes: data?.notes ?? [],
            loaded: true,
          })
        } catch {
          // 后端不可用时保留上一次的数据，界面不至于变成空白书架
        } finally {
          set({ loading: false })
        }
      },

      setViewMode: mode => set({ viewMode: mode }),

      addFolder: async name => {
        try {
          const folder = await api.createFolder(name)
          set(state => ({ folders: [...state.folders, { ...folder, note_count: 0 }] }))
          return true
        } catch {
          return false
        }
      },

      renameFolder: async (id, name) => {
        try {
          const folder = await api.renameFolder(id, name)
          set(state => ({
            folders: state.folders.map(f => (f.id === id ? { ...f, ...folder } : f)),
          }))
          return true
        } catch {
          return false
        }
      },

      removeFolder: async (id, mode) => {
        try {
          await api.deleteFolder(id, mode)
          set(state => ({
            folders: state.folders.filter(f => f.id !== id),
            notes:
              mode === 'delete'
                ? state.notes.filter(n => n.folder_id !== id)
                : state.notes.map(n => (n.folder_id === id ? { ...n, folder_id: null } : n)),
          }))
          return true
        } catch {
          return false
        }
      },

      moveNote: async (taskId, folderId) => {
        const before = get().notes
        // 先本地改一遍，拖拽松手要立刻看到卡片落到新文件夹里，不等网络往返
        set(state => ({
          notes: state.notes.map(n => (n.task_id === taskId ? { ...n, folder_id: folderId } : n)),
        }))
        try {
          await api.moveNote(taskId, folderId)
          return true
        } catch {
          set({ notes: before })
          return false
        }
      },

      renameNote: async (taskId, title) => {
        try {
          const data = await api.renameNote(taskId, title)
          set(state => ({
            notes: state.notes.map(n =>
              n.task_id === taskId ? { ...n, title: data?.title ?? null } : n,
            ),
          }))
          return true
        } catch {
          return false
        }
      },

      touchNote: async taskId => {
        const now = Date.now()
        set(state => ({
          notes: state.notes.map(n => (n.task_id === taskId ? { ...n, last_opened_at: now } : n)),
        }))
        try {
          await api.touchNote(taskId)
        } catch {
          // 打点失败无所谓，不值得提示
        }
      },

      folderName: folderId => {
        if (!folderId) return '未分类'
        return get().folders.find(f => f.id === folderId)?.name ?? '未分类'
      },
    }),
    {
      name: 'library-storage',
      // 只持久化视图偏好；文件夹和笔记每次都从后端拉，避免两边不一致
      partialize: state =>
        ({ viewMode: state.viewMode, sortMode: state.sortMode }) as LibraryState,
      storage: createJSONStorage(() => ({
        getItem: async (name: string): Promise<string | null> => (await get(name)) ?? null,
        setItem: async (name: string, value: string): Promise<void> => {
          await set(name, value)
        },
        removeItem: async (name: string): Promise<void> => {
          await del(name)
        },
      })),
    },
  ),
)

export type { LibraryFolder, LibraryNote }
