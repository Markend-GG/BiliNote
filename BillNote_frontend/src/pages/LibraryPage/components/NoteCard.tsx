import { memo } from 'react'
import { Folder as FolderIcon, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Menu, type MenuEntryOrSeparator } from '@/components/ui/menu'
import type { ShelfItem } from '@/hooks/useShelfItems'
import {
  NOTE_DRAG_MIME,
  coverSrc,
  formatDate,
  formatDuration,
  platformLabel,
  platformLogo,
  statusMeta,
} from '../utils'

interface NoteItemProps {
  item: ShelfItem
  folderName: string
  onOpen: () => void
  menuEntries: MenuEntryOrSeparator[]
  /** 搜索时跨文件夹展示，需要在卡片上标出所属文件夹；在文件夹里浏览时这行是冗余的 */
  showFolder?: boolean
}

// 平台图标是内联 svg，自带 width/height=200，必须用 [&_svg] 强制收到容器尺寸
const PlatformIcon = ({ platform }: { platform?: string | null }) => {
  const Logo = platformLogo(platform)
  if (!Logo) return null
  return (
    <span className="flex h-3.5 w-3.5 items-center [&_svg]:h-full [&_svg]:w-full">
      <Logo />
    </span>
  )
}

const CoverFallback = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget
  if (!img.src.endsWith('/placeholder.png')) img.src = '/placeholder.png'
}

const startDrag = (e: React.DragEvent, taskId: string) => {
  e.dataTransfer.setData(NOTE_DRAG_MIME, taskId)
  e.dataTransfer.effectAllowed = 'move'
}

/** 卡片视图：封面 16:9 + 标题 + 归属信息 */
export const NoteCard = memo(function NoteCard({
  item,
  folderName,
  onOpen,
  menuEntries,
  showFolder = true,
}: NoteItemProps) {
  const status = statusMeta(item.status)
  const duration = formatDuration(item.duration)

  return (
    <div
      draggable
      onDragStart={e => startDrag(e, item.taskId)}
      onClick={onOpen}
      className="group bg-card flex cursor-pointer flex-col overflow-hidden rounded-lg border shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-neutral-100">
        <img
          src={coverSrc(item)}
          alt=""
          loading="lazy"
          onError={CoverFallback}
          className={cn('h-full w-full object-cover', status.running && 'opacity-50')}
        />
        {status.running && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        )}
        <span
          className={cn(
            'absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium',
            status.className,
          )}
        >
          {status.label}
        </span>
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
            {duration}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start gap-1">
          <h3 className="line-clamp-2 flex-1 text-sm leading-5 font-medium" title={item.title}>
            {item.title}
          </h3>
          <Menu
            trigger={<MoreHorizontal className="h-4 w-4" />}
            entries={menuEntries}
            ariaLabel={`${item.title} 的操作`}
            className="shrink-0 opacity-60 transition group-hover:opacity-100"
          />
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {showFolder && (
            <>
              <FolderIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">{folderName}</span>
            </>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <PlatformIcon platform={item.platform} />
            {platformLabel(item.platform)}
          </span>
        </div>
        <div className="text-muted-foreground text-xs">{formatDate(item.createdAt)}</div>
      </div>
    </div>
  )
})

/** 列表视图：同样字段一行一条，笔记多了以后找起来快 */
export const NoteRow = memo(function NoteRow({
  item,
  folderName,
  onOpen,
  menuEntries,
  showFolder = true,
}: NoteItemProps) {
  const status = statusMeta(item.status)
  const duration = formatDuration(item.duration)

  return (
    <div
      draggable
      onDragStart={e => startDrag(e, item.taskId)}
      onClick={onOpen}
      className="group bg-card hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2"
    >
      <img
        src={coverSrc(item)}
        alt=""
        loading="lazy"
        onError={CoverFallback}
        className={cn('h-12 w-20 shrink-0 rounded object-cover', status.running && 'opacity-50')}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={item.title}>
          {item.title}
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
          <span className={cn('rounded px-1.5 py-0.5 text-[11px]', status.className)}>
            {status.label}
          </span>
          {showFolder && (
            <span className="flex min-w-0 items-center gap-1">
              <FolderIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">{folderName}</span>
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1">
            <PlatformIcon platform={item.platform} />
            {platformLabel(item.platform)}
          </span>
          {duration && <span className="shrink-0">{duration}</span>}
          <span className="shrink-0">{formatDate(item.createdAt)}</span>
        </div>
      </div>
      <Menu
        trigger={<MoreHorizontal className="h-4 w-4" />}
        entries={menuEntries}
        ariaLabel={`${item.title} 的操作`}
        className="shrink-0 opacity-60 transition group-hover:opacity-100"
      />
    </div>
  )
})
