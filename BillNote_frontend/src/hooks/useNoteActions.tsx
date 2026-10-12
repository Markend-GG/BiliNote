import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderInput, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { MenuEntryOrSeparator } from '@/components/ui/menu'
import { PromptDialog } from '@/components/PromptDialog'
import { useLibraryStore } from '@/store/libraryStore'
import { useTaskStore } from '@/store/taskStore'

const UNCATEGORIZED = '未分类'

/**
 * 详情页顶栏「⋯」菜单里那批笔记级操作：重命名、移动到文件夹、删除、去设置。
 *
 * 抽成 hook 是因为这些操作各自还要带一个对话框，全塞进 MarkdownHeader 会让它更长；
 * 这里返回菜单项 + 需要一并渲染的 dialogs，调用方两行就能接上。
 */
export function useNoteActions(taskId: string | undefined, fallbackTitle: string) {
  const navigate = useNavigate()
  const folders = useLibraryStore(state => state.folders)
  const notes = useLibraryStore(state => state.notes)
  const { renameNote, moveNote, fetchLibrary } = useLibraryStore()
  const removeTask = useTaskStore(state => state.removeTask)

  const indexed = taskId ? notes.find(note => note.task_id === taskId) : undefined
  const folderId = indexed?.folder_id ?? null
  const folderName = folderId
    ? (folders.find(folder => folder.id === folderId)?.name ?? UNCATEGORIZED)
    : UNCATEGORIZED
  const title = indexed?.title || indexed?.video_title || fallbackTitle

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleDelete = async () => {
    if (!taskId) return
    setBusy(true)
    try {
      await removeTask(taskId)
      setDeleteOpen(false)
      await fetchLibrary()
      navigate('/')
    } catch {
      // 请求拦截器已经弹过提示
    } finally {
      setBusy(false)
    }
  }

  const entries: MenuEntryOrSeparator[] = [
    {
      key: 'rename',
      label: '重命名笔记',
      icon: <Pencil className="h-4 w-4" />,
      onSelect: () => setRenameOpen(true),
    },
    {
      key: 'move-none',
      label: `移到${UNCATEGORIZED}`,
      icon: <FolderInput className="h-4 w-4" />,
      disabled: !folderId,
      onSelect: async () => {
        if (await moveNote(taskId!, null)) toast.success(`已移到${UNCATEGORIZED}`)
      },
    },
    ...folders
      .filter(folder => folder.id !== folderId)
      .map(folder => ({
        key: `move-${folder.id}`,
        label: `移到「${folder.name}」`,
        icon: <FolderInput className="h-4 w-4" />,
        onSelect: async () => {
          if (await moveNote(taskId!, folder.id)) toast.success(`已移到「${folder.name}」`)
        },
      })),
    '---',
    {
      key: 'delete',
      label: '删除笔记',
      danger: true,
      icon: <Trash2 className="h-4 w-4" />,
      onSelect: () => setDeleteOpen(true),
    },
    '---',
    {
      key: 'settings',
      label: '全局配置',
      icon: <SlidersHorizontal className="h-4 w-4" />,
      onSelect: () => navigate('/settings'),
    },
  ]

  const dialogs = (
    <>
      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="重命名笔记"
        description="只有你自己看得到这个别名，视频原标题会保留。清空则恢复用视频标题。"
        label="别名"
        initialValue={indexed?.title ?? ''}
        placeholder={indexed?.video_title || '例如：数量关系专项'}
        confirmLabel="保存"
        allowEmpty
        onConfirm={value => (taskId ? renameNote(taskId, value) : false)}
      />

      <Dialog open={deleteOpen} onOpenChange={open => !busy && setDeleteOpen(open)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>删除这篇笔记？</DialogTitle>
            <DialogDescription>
              「{title}」将被永久删除：后端保存的笔记文件、这篇引用的截图、AI 问答索引，
              以及浏览器里的版本历史都会一起清掉，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={busy}>
              {busy ? '删除中…' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return { title, folderId, folderName, entries, dialogs }
}
