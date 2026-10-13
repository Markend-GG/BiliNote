import { useMemo } from 'react'
import { useLibraryStore } from '@/store/libraryStore'
import { useTaskStore } from '@/store/taskStore'
import { mergeShelfItems } from '@/store/selectors'

export type { ShelfItem } from '@/store/selectors'

/** 书架/切换下拉共用的合并视图；合并规则集中在 store/selectors.ts（有单测） */
export function useShelfItems() {
  const notes = useLibraryStore(state => state.notes)
  const tasks = useTaskStore(state => state.tasks)
  return useMemo(() => mergeShelfItems(notes, tasks), [notes, tasks])
}
