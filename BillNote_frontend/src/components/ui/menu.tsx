import * as React from 'react'
import { cn } from '@/lib/utils'

export interface MenuEntry {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export type MenuEntryOrSeparator = MenuEntry | '---'

interface MenuProps {
  entries: MenuEntryOrSeparator[]
  /** 触发按钮里的内容，通常就是一个图标 */
  trigger: React.ReactNode
  /** 菜单顶部的只读信息块。模型名、风格、创建时间这些从工具栏挪进来，不再常驻占宽度 */
  info?: React.ReactNode
  align?: 'start' | 'end'
  className?: string
  triggerClassName?: string
  ariaLabel?: string
}

/**
 * 轻量下拉菜单。

 * 项目里没有 @radix-ui/react-dropdown-menu，而 Dockerfile.patch 用 pnpm install --frozen-lockfile，
 * 加依赖要连带改 lockfile、有构建风险，所以这里手写：外点关闭 + Esc + 上下键移动焦点。
 */
export function Menu({
  entries,
  trigger,
  info,
  align = 'end',
  className,
  triggerClassName,
  ariaLabel = '更多操作',
}: MenuProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      if (!items.length) return
      e.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        e.key === 'ArrowDown'
          ? items[(index + 1) % items.length]
          : items[(index - 1 + items.length) % items.length]
      next?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // 打开后把焦点移进菜单，键盘用户才不会丢失位置
    listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // 不在这里写死 shrink-0：顶栏里这个菜单要能占满剩余宽度并截断标题，由调用方决定
  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={e => {
          // 菜单常挂在卡片上，卡片本身也能点开笔记，这里必须拦住冒泡
          e.stopPropagation()
          setOpen(v => !v)
        }}
        className={cn(
          'text-muted-foreground hover:bg-accent cursor-pointer rounded p-1',
          open && 'bg-accent',
          triggerClassName,
        )}
      >
        {trigger}
      </button>

      {open && (
        <div
          ref={listRef}
          role="menu"
          className={cn(
            'bg-popover text-popover-foreground absolute top-full z-50 mt-1 min-w-[184px] overflow-hidden rounded-md border py-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {info && (
            <div className="text-muted-foreground border-b px-3 py-2 text-xs leading-5">{info}</div>
          )}
          {entries.map((entry, i) =>
            entry === '---' ? (
              <div key={`sep-${i}`} className="bg-border my-1 h-px" />
            ) : (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={e => {
                  e.stopPropagation()
                  setOpen(false)
                  entry.onSelect()
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm outline-none',
                  'focus-visible:bg-accent hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
                  entry.danger ? 'text-destructive' : 'text-foreground',
                )}
              >
                {entry.icon}
                <span className="flex-1">{entry.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
