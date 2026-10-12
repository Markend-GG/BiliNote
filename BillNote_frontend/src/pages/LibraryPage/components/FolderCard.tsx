import { memo, useState } from 'react'
import { Folder as FolderIcon, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Menu, type MenuEntryOrSeparator } from '@/components/ui/menu'
import { NOTE_DRAG_MIME } from '../utils'

interface FolderCardProps {
  name: string
  count: number
  /** 「未分类」是虚拟文件夹，不能重命名也不能删 */
  virtual?: boolean
  active?: boolean
  onOpen: () => void
  onDropNote: (taskId: string) => void
  menuEntries: MenuEntryOrSeparator[]
}

/** 文件夹卡片，同时是拖拽归档的落点 */
export const FolderCard = memo(function FolderCard({
  name,
  count,
  virtual = false,
  active = false,
  onOpen,
  onDropNote,
  menuEntries,
}: FolderCardProps) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      onClick={onOpen}
      onDragOver={e => {
        // 只有拖着笔记过来时才接管，否则让页面正常滚动/选择
        if (!e.dataTransfer.types.includes(NOTE_DRAG_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        const taskId = e.dataTransfer.getData(NOTE_DRAG_MIME)
        if (!taskId) return
        e.preventDefault()
        setDragOver(false)
        onDropNote(taskId)
      }}
      className={cn(
        'group flex cursor-pointer flex-col justify-between gap-6 rounded-lg border bg-neutral-50 p-3 shadow-sm transition',
        active && 'border-primary bg-primary-light',
        dragOver && 'border-primary ring-primary/40 scale-[1.02] ring-2',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <FolderIcon
          className={cn('h-9 w-9', dragOver ? 'text-primary' : 'text-amber-500')}
          fill="currentColor"
          fillOpacity={0.25}
        />
        {/* 「未分类」是虚拟文件夹，没有可做的操作，不渲染空菜单按钮 */}
        {menuEntries.length > 0 && (
          <Menu
            trigger={<MoreHorizontal className="h-4 w-4" />}
            entries={menuEntries}
            ariaLabel={`${name} 的操作`}
            className="shrink-0 opacity-60 transition group-hover:opacity-100"
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium" title={name}>
          {name}
        </div>
        <div className="text-muted-foreground text-xs">
          {count} 篇{dragOver && ' · 松手归档到这里'}
        </div>
      </div>
    </div>
  )
})
