import { useMemo } from 'react'
import { useLibraryStore } from '@/store/libraryStore'
import { useTaskStore } from '@/store/taskStore'

export interface ShelfItem {
  taskId: string
  title: string
  folderId: string | null
  status: string
  platform: string | null
  coverUrl: string | null
  duration: number | null
  createdAt: number | null
  lastOpenedAt: number | null
  /** 本地 IndexedDB 里有没有这篇的完整内容；没有的话进详情页要从后端 hydrate */
  hasLocal: boolean
}

/**
 * 书架上的一行/一张卡片。
 *
 * 后端 notes 表是权威来源（标题、文件夹、封面），但生成中的实时状态只有本地 taskStore 知道
 * ——轮询在更新它，后端索引只在提交/成功/失败三个节点写。所以两边按 task_id 合并，
 * 状态优先取本地，其余优先取后端。刚提交、后端还没落库的任务也要补进来，否则卡片会闪一下才出现。
 */
export function useShelfItems(): ShelfItem[] {
  const notes = useLibraryStore(state => state.notes)
  const tasks = useTaskStore(state => state.tasks)

  return useMemo(() => {
    const localById = new Map(tasks.map(task => [task.id, task]))

    const fromIndex = notes.map(note => {
      const local = localById.get(note.task_id)
      return {
        taskId: note.task_id,
        title: note.title || note.video_title || local?.audioMeta?.title || '未命名笔记',
        folderId: note.folder_id,
        status: local?.status || note.status || 'PENDING',
        platform: note.platform || local?.platform || null,
        coverUrl: note.cover_url || local?.audioMeta?.cover_url || null,
        duration: note.duration ?? local?.audioMeta?.duration ?? null,
        createdAt: note.created_at ?? (local?.createdAt ? new Date(local.createdAt).getTime() : null),
        lastOpenedAt: note.last_opened_at,
        hasLocal: !!local,
      }
    })

    const indexed = new Set(notes.map(note => note.task_id))
    const localOnly = tasks
      .filter(task => !indexed.has(task.id))
      .map(task => ({
        taskId: task.id,
        title: task.audioMeta?.title || '未命名笔记',
        folderId: task.folderId ?? null,
        status: task.status,
        platform: task.platform || task.audioMeta?.platform || null,
        coverUrl: task.audioMeta?.cover_url || null,
        duration: task.audioMeta?.duration || null,
        createdAt: task.createdAt ? new Date(task.createdAt).getTime() : null,
        lastOpenedAt: null,
        hasLocal: true,
      }))

    return [...fromIndex, ...localOnly]
  }, [notes, tasks])
}
