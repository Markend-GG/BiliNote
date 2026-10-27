import { Fragment, memo, useState } from 'react'
import { ChevronRight, Folder as FolderGlyph, FolderOpen, Library, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Menu, type MenuEntryOrSeparator } from '@/components/ui/menu'
import type { LibraryFolder } from '@/services/library'
import type { ShelfItem } from '@/store/selectors'
import { NOTE_DRAG_MIME, statusMeta } from '../utils'
import { startDrag } from './NoteCard'

/** 文件夹节点自己的拖拽 MIME：和笔记的 MIME 分开，两种拖拽互不响应 */
export const FOLDER_DRAG_MIME = 'text/bilinote-folder'

const EXPAND_KEY = 'shelf-tree-expanded'

/** 与书架页的 FolderFilter 同义：null=全部，'none'=未分类，其余是文件夹 id */
export type TreeNode = string | 'none' | null

interface FolderTreeProps {
  folders: LibraryFolder[]
  /** 某个范围（文件夹 / 未分类）里的笔记，已按当前排序档排好 */
  itemsOf: (folderId: string | null) => ShelfItem[]
  counts: { byFolder: Map<string, number>; none: number; total: number }
  selected: TreeNode
  onSelect: (node: TreeNode) => void
  onOpenNote: (taskId: string) => void
  /** 搜索命中所在的文件夹，节点上打个小圆点（不自动展开） */
  hitFolderIds: Set<string>
  onDropNote: (taskId: string, folderId: string | null) => void
  onReorderFolders: (orderedIds: string[]) => void
  folderMenu: (folder: LibraryFolder) => MenuEntryOrSeparator[]
}

const readExpanded = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(EXPAND_KEY) || '{}')
  } catch {
    return {}
  }
}

/** 插入线：独立的一条 2px div，不给行加 border，避免拖拽时布局抖动 */
const InsertLine = () => <div className="bg-primary my-0.5 h-0.5 rounded-full" />

/**
 * 书架的目录树侧栏：全部 → 各文件夹（展开后笔记作叶子）→ 未分类。
 *
 * 一个节点同时承担两种拖拽语义，靠 MIME 区分：
 * 拖着【笔记】过来 = 归档落点（高亮 + "松手归档"提示）；
 * 拖着【文件夹】过来 = 插入线排序（启用 folders 表里一直闲置的 sort_order）。
 */
export const FolderTree = memo(function FolderTree({
  folders,
  itemsOf,
  counts,
  selected,
  onSelect,
  onOpenNote,
  hitFolderIds,
  onDropNote,
  onReorderFolders,
  folderMenu,
}: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readExpanded)
  // 笔记拖到文件夹节点上的高亮
  const [archiveTarget, setArchiveTarget] = useState<string | 'none' | null>(null)
  // 文件夹插入线的位置（0..folders.length）
  const [folderDropIndex, setFolderDropIndex] = useState<number | null>(null)

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(EXPAND_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleFolderDrop = (e: React.DragEvent, index: number) => {
    const dragged = e.dataTransfer.getData(FOLDER_DRAG_MIME)
    setFolderDropIndex(null)
    if (!dragged) return
    e.preventDefault()
    e.stopPropagation()
    const ids = folders.map(f => f.id)
    const from = ids.indexOf(dragged)
    if (from < 0) return
    ids.splice(from, 1)
    // 插入线位置是"含被拖节点"的坐标系，抽掉它之后要回退一格
    ids.splice(from < index ? index - 1 : index, 0, dragged)
    onReorderFolders(ids)
  }

  const folderDragOver = (e: React.DragEvent, index: number) => {
    if (e.dataTransfer.types.includes(FOLDER_DRAG_MIME)) {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      const idx = e.clientY < r.top + r.height / 2 ? index : index + 1
      if (idx !== folderDropIndex) setFolderDropIndex(idx)
      return
    }
    // 笔记拖过文件夹节点时不要冒插入线，归档高亮由节点自己的 handler 负责
    setFolderDropIndex(null)
  }

  const nodeBase =
    'group/node flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors'

  return (
    <nav
      aria-label="笔记目录树"
      className="flex h-full w-[240px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-neutral-50/70 p-2"
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFolderDropIndex(null)
          setArchiveTarget(null)
        }
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(nodeBase, selected === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-neutral-200/60')}
      >
        <Library className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-left">全部</span>
        <span className="text-muted-foreground text-xs">{counts.total}</span>
      </button>

      {folders.map((folder, i) => {
        const isOpen = !!expanded[folder.id]
        const leaves = isOpen ? itemsOf(folder.id) : []
        return (
          <Fragment key={folder.id}>
            {folderDropIndex === i && <InsertLine />}
            <div
              draggable
              onDragStart={e => {
                e.dataTransfer.setData(FOLDER_DRAG_MIME, folder.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={e => folderDragOver(e, i)}
              onDrop={e => handleFolderDrop(e, i)}
              className={cn(
                nodeBase,
                selected === folder.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-neutral-200/60',
                archiveTarget === folder.id && 'bg-primary/15 ring-primary/40 ring-1',
              )}
            >
              <button
                type="button"
                aria-label={isOpen ? `收起 ${folder.name}` : `展开 ${folder.name}`}
                onClick={e => {
                  e.stopPropagation()
                  toggle(folder.id)
                }}
                className="hover:bg-neutral-300/60 -ml-1 cursor-pointer rounded p-0.5"
              >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
              </button>
              <button
                type="button"
                aria-label={`打开 ${folder.name}`}
                onClick={() => onSelect(folder.id)}
                onDragOver={e => {
                  if (!e.dataTransfer.types.includes(NOTE_DRAG_MIME)) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'move'
                  setArchiveTarget(folder.id)
                }}
                onDragLeave={() => setArchiveTarget(t => (t === folder.id ? null : t))}
                onDrop={e => {
                  const taskId = e.dataTransfer.getData(NOTE_DRAG_MIME)
                  setArchiveTarget(null)
                  if (!taskId) return
                  e.preventDefault()
                  e.stopPropagation()
                  onDropNote(taskId, folder.id)
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
              >
                {isOpen ? (
                  <FolderOpen className="text-amber-500 h-4 w-4 shrink-0" />
                ) : (
                  <FolderGlyph className="text-amber-500 h-4 w-4 shrink-0" />
                )}
                <span className="flex-1 truncate">{folder.name}</span>
                {hitFolderIds.has(folder.id) && (
                  <span className="bg-primary h-1.5 w-1.5 shrink-0 rounded-full" title="搜索命中" />
                )}
                <span className="text-muted-foreground text-xs">{counts.byFolder.get(folder.id) ?? 0}</span>
              </button>
              <Menu
                trigger={<MoreHorizontal className="h-3.5 w-3.5" />}
                entries={folderMenu(folder)}
                ariaLabel={`${folder.name} 的操作`}
                className="shrink-0 opacity-0 transition group-hover/node:opacity-100"
              />
            </div>
            {isOpen &&
              leaves.map(leaf => (
                <TreeLeaf key={leaf.taskId} item={leaf} onOpenNote={onOpenNote} />
              ))}
          </Fragment>
        )
      })}
      {folderDropIndex === folders.length && <InsertLine />}

      {/* 未分类：虚拟节点，没有 ⋯ 菜单、不参与文件夹排序，但同样是归档落点 */}
      <div
        onDragOver={e => {
          if (!e.dataTransfer.types.includes(NOTE_DRAG_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setArchiveTarget('none')
        }}
        onDragLeave={() => setArchiveTarget(t => (t === 'none' ? null : t))}
        onDrop={e => {
          const taskId = e.dataTransfer.getData(NOTE_DRAG_MIME)
          setArchiveTarget(null)
          if (!taskId) return
          e.preventDefault()
          onDropNote(taskId, null)
        }}
        className={cn(
          nodeBase,
          selected === 'none' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-neutral-200/60',
          archiveTarget === 'none' && 'bg-primary/15 ring-primary/40 ring-1',
        )}
      >
        <button
          type="button"
          aria-label={expanded.none ? '收起未分类' : '展开未分类'}
          onClick={e => {
            e.stopPropagation()
            toggle('none')
          }}
          className="hover:bg-neutral-300/60 -ml-1 cursor-pointer rounded p-0.5"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded.none && 'rotate-90')} />
        </button>
        <button type="button" aria-label="打开 未分类" onClick={() => onSelect('none')} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left">
          <FolderGlyph className="text-neutral-400 h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">未分类</span>
          <span className="text-muted-foreground text-xs">{counts.none}</span>
        </button>
      </div>
      {expanded.none && itemsOf(null).map(leaf => <TreeLeaf key={leaf.taskId} item={leaf} onOpenNote={onOpenNote} />)}
    </nav>
  )
})

const TreeLeaf = memo(function TreeLeaf({
  item,
  onOpenNote,
}: {
  item: ShelfItem
  onOpenNote: (taskId: string) => void
}) {
  const status = statusMeta(item.status)
  return (
    <button
      type="button"
      draggable
      onDragStart={e => startDrag(e, item.taskId)}
      onClick={() => onOpenNote(item.taskId)}
      className="hover:bg-neutral-200/60 flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 pl-8 text-left text-[13px] transition-colors"
      title={item.title}
    >
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.running ? 'bg-blue-500 animate-pulse' : item.status === 'FAILED' ? 'bg-red-500' : 'bg-emerald-500')}
        aria-label={status.label}
      />
      <span className="text-muted-foreground min-w-0 flex-1 truncate group-hover:text-foreground">{item.title}</span>
    </button>
  )
})
