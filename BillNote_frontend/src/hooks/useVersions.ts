import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLibraryStore } from '@/store/libraryStore'
import type { Task } from '@/store/taskStore'
import type { NoteVersion } from '@/services/library'

/**
 * 版本选择与正文内容。版本历史的权威存储在后端 note_versions 表，
 * 这里只负责"当前看哪一版"以及删版本。
 */
export function useVersions(
  currentTask: Task | null,
  versions: NoteVersion[],
  taskStatus: string,
) {
  const [currentVerId, setCurrentVerId] = useState<string>('')
  const [selectedContent, setSelectedContent] = useState<string>('')
  const [modelName, setModelName] = useState<string>('')
  const [style, setStyle] = useState<string>('')
  const [createTime, setCreateTime] = useState<string>('')
  // 多版本内容处理：versions 已按新在前排好
  useEffect(() => {
    if (!currentTask) return

    if (versions.length === 0) {
      setCurrentVerId('') // 清空旧版本 ID
      setModelName(currentTask.formData.model_name)
      setStyle(currentTask.formData.style)
      setCreateTime(currentTask.createdAt)
      setSelectedContent(typeof currentTask.markdown === 'string' ? currentTask.markdown : '')
      return
    }
    if (!versions.some(v => v.ver_id === currentVerId)) {
      setCurrentVerId(versions[0].ver_id)
    }
  }, [currentTask?.id, taskStatus, versions])
  useEffect(() => {
    const currentVer = versions.find(v => v.ver_id === currentVerId)
    if (!currentVer) return
    setModelName(currentVer.model_name || '')
    setStyle(currentVer.style || '')
    setCreateTime(currentVer.created_at ? new Date(currentVer.created_at).toISOString() : '')
    setSelectedContent(currentVer.content)
  }, [currentVerId, versions])
  const handleDeleteVersion = async () => {
    if (!currentTask || !currentVerId) return
    if (versions.length <= 1) {
      toast.error('只剩一个版本了，不能删')
      return
    }
    const ok = await useLibraryStore.getState().removeServerVersion(currentTask.id, currentVerId)
    if (!ok) return
    const rest = useLibraryStore.getState().versionsByTask[currentTask.id] ?? []
    // 删的正是当前在看的版本时切到剩下的最新版，否则界面会停在已删除的内容上
    if (!rest.some(v => v.ver_id === currentVerId)) {
      setCurrentVerId(rest[0]?.ver_id || '')
    }
    toast.success('已删除该版本')
  }

  return { currentVerId, setCurrentVerId, selectedContent, modelName, style, createTime, handleDeleteVersion }
}
