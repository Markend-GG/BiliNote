import { memo, useId, useState } from 'react'
import { Folder as FolderGlyph, MoreHorizontal } from 'lucide-react'
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

/**
 * 手绘的双色文件夹插画（内联 SVG，不引依赖：Dockerfile.patch 用 --frozen-lockfile，
 * 加图标库要连带改 lockfile）。
 *
 * lucide 的 Folder 是 24px 线性图标，放到封面那么大就只剩一圈细线、又空又小；
 * 这里用「后片 + 露出的纸 + 前片 + 高光」四层做出厚度，放大到封面尺寸也耐看。
 * open=true 时纸往上抽出来一点，配合拖拽悬停给一个"张开等着接收"的反馈。
 */
function FolderArt({
  open = false,
  muted = false,
  className,
}: {
  open?: boolean
  muted?: boolean
  className?: string
}) {
  // 同页会有多张文件夹卡，渐变 id 必须唯一，否则后渲染的会覆盖前面的
  const uid = useId().replace(/:/g, '')
  const back = `folder-back-${uid}`
  const front = `folder-front-${uid}`
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={back} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={muted ? '#e4e4e7' : '#fcd34d'} />
          <stop offset="100%" stopColor={muted ? '#d4d4d8' : '#f59e0b'} />
        </linearGradient>
        <linearGradient id={front} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={muted ? '#d4d4d8' : '#fbbf24'} />
          <stop offset="100%" stopColor={muted ? '#a1a1aa' : '#d97706'} />
        </linearGradient>
      </defs>

      <ellipse cx="60" cy="90" rx="40" ry="4.5" fill="#000" opacity="0.10" />

      {/* 后片：左上角带标签凸起 */}
      <path
        d="M10 16h29l9 11h54a8 8 0 0 1 8 8v45a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8z"
        fill={`url(#${back})`}
      />

      {/* 露出的纸（拖拽悬停时往上抽） */}
      <g className={cn('transition-transform duration-300', open && '-translate-y-2.5')}>
        <rect x="24" y="24" width="64" height="48" rx="4" fill="#ffffff" opacity="0.96" />
        <rect x="32" y="33" width="40" height="4" rx="2" fill="#e4e4e7" />
        <rect x="32" y="42" width="48" height="4" rx="2" fill="#e4e4e7" />
        <rect x="32" y="51" width="28" height="4" rx="2" fill="#e4e4e7" />
      </g>

      {/* 前片 + 上沿高光 */}
      <path d="M2 46h116v34a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V46z" fill={`url(#${front})`} />
      <rect x="2" y="46" width="116" height="3" fill="#ffffff" opacity="0.30" />
    </svg>
  )
}

/** 文件夹卡片，同时是拖拽归档的落点。版式与笔记卡一致：16:9 封面 + 下方标题/元信息 */
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
        'group bg-card flex cursor-pointer flex-col overflow-hidden rounded-lg border shadow-sm transition',
        'hover:-translate-y-0.5 hover:shadow-md',
        active && 'border-primary',
        dragOver && 'border-primary ring-primary/40 scale-[1.02] ring-2',
      )}
    >
      <div
        className={cn(
          'relative flex aspect-video w-full items-center justify-center overflow-hidden transition-colors',
          dragOver
            ? 'bg-primary/15'
            : active
              ? 'bg-primary/10'
              : virtual
                ? 'bg-neutral-100'
                : 'from-amber-50 to-neutral-100 bg-gradient-to-br',
        )}
      >
        <FolderArt
          open={dragOver}
          muted={virtual}
          className={cn(
            'h-[68%] w-auto drop-shadow-sm transition-transform duration-300',
            !dragOver && 'group-hover:scale-[1.05]',
          )}
        />

        {/* 篇数角标：与笔记卡右下角的时长角标同一个位置，视觉语言统一 */}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {count} 篇
        </span>

        {dragOver && (
          <span className="bg-primary absolute inset-x-0 top-0 py-1 text-center text-[11px] font-medium text-white">
            松手归档到这里
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start gap-1">
          <FolderGlyph
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0',
              virtual ? 'text-neutral-400' : 'text-amber-500',
            )}
          />
          <h3 className="line-clamp-2 flex-1 text-sm leading-5 font-medium" title={name}>
            {name}
          </h3>
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
        <div className="text-muted-foreground text-xs">
          {virtual ? '未归入任何文件夹的笔记' : '文件夹'}
        </div>
      </div>
    </div>
  )
})
