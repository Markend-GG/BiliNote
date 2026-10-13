import { useEffect, useRef, useState } from 'react'
import { ListTree, PanelRightClose } from 'lucide-react'
import { cn } from '@/lib/utils'
import { scrollToHeading } from '@/utils/heading'

interface OutlineEntry {
  id: string
  text: string
  level: number
}

interface OutlineNavProps {
  /** 指向 .markdown-body 的 ref，章节表与滚动监听都从它出发 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 正文内容标识，变了就重建章节表 */
  contentKey: string
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

/**
 * 详情页右侧常驻章节导航。
 *
 * 章节树从渲染后的 DOM 抓（rehypeFold 已经把标题包成 .md-section[data-level] > .md-section-head > hN），
 * 所以和折叠状态天然同步；折叠章节里的标题照样列出——点进去会自动展开，这正是导航的价值。
 * scroll-spy 的滚动事件要绑 radix ScrollArea 的 viewport（window 上没有），
 * 且折叠会改变坐标，所以元素引用建表时缓存、rect 每次实时读，绝不缓存位置。
 */
export function OutlineNav({ containerRef, contentKey, collapsed, onCollapsedChange }: OutlineNavProps) {
  const [entries, setEntries] = useState<OutlineEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const scrollTimer = useRef<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      setEntries([])
      return
    }

    const rebuild = () => {
      const next: OutlineEntry[] = []
      container.querySelectorAll('.md-section').forEach(section => {
        const heading = section.querySelector(
          ':scope > .md-section-head > h1, :scope > .md-section-head > h2, :scope > .md-section-head > h3, :scope > .md-section-head > h4',
        )
        if (!heading?.id) return
        next.push({
          id: heading.id,
          text: (heading.textContent || '').trim(),
          level: Number(section.getAttribute('data-level') || 1),
        })
      })
      // 内容没变就别换数组引用，否则 scroll-spy 的 effect 会跟着白跑
      setEntries(prev =>
        prev.length === next.length && prev.every((p, i) => p.id === next[i].id) ? prev : next,
      )
    }

    // 先同步建一次表：后台标签页会暂停 requestAnimationFrame，只靠 rAF 的话
    // 切回前台之前章节栏一直是空的（实测踩过）。rAF 与 MutationObserver 兜后续：
    // 正文分帧提交、懒加载图片、KaTeX 注入节点等结构变化
    rebuild()
    const raf = requestAnimationFrame(rebuild)
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      // 观察回调里不用 rAF（后台页同样会停），用微任务之后的同步重建
      queueMicrotask(rebuild)
    })
    observer.observe(container, { childList: true, subtree: true })

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [contentKey, containerRef])

  useEffect(() => {
    const update = () => {
      // 每次现找滚动容器：正文节点可能在重渲染中被替换，闭包里攥着旧节点就再也收不到 scroll
      const viewport = containerRef.current?.closest('[data-radix-scroll-area-viewport]')
      if (!viewport) return
      const threshold = viewport.getBoundingClientRect().top + 96
      // 滚在顶部时还没有任何标题越过阈值，高亮第一条而不是谁都不亮
      let current: string | null = entries.length ? entries[0].id : null
      for (const entry of entries) {
        // 按 id 现取元素：正文重渲染后旧的节点引用可能已失效，攥着它 rect 全是 0
        const el = document.getElementById(entry.id)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        // 藏在折叠章节里的标题 rect 全 0，位置无意义，跳过
        if (rect.height === 0) continue
        if (rect.top <= threshold) current = entry.id
      }
      setActiveId(current)
    }
    // 节流用 setTimeout 而不是 rAF：后台标签页会暂停 rAF，高亮会冻住
    const onScroll = () => {
      if (scrollTimer.current !== null) return
      scrollTimer.current = window.setTimeout(() => {
        scrollTimer.current = null
        update()
      }, 80)
    }

    // 用 window 捕获阶段听 scroll：scroll 事件不冒泡，但捕获阶段能收到任意后代滚动容器的；
    // 这样不必依赖"找到正确的那个 viewport 节点"
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    update()
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
    }
  }, [entries, containerRef])

  if (collapsed) {
    return (
      <div className="flex w-7 shrink-0 flex-col items-center border-l bg-white py-2 print:hidden">
        <button
          type="button"
          aria-label="展开章节导航"
          title="展开章节导航"
          onClick={() => onCollapsedChange(false)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer rounded p-1"
        >
          <ListTree className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-l bg-white print:hidden">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="text-sm font-medium text-neutral-700">章节</span>
        <button
          type="button"
          aria-label="收起章节导航"
          title="收起章节导航"
          onClick={() => onCollapsedChange(true)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer rounded p-1"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {entries.length === 0 ? (
          <p className="px-3 text-xs text-neutral-400">暂无章节</p>
        ) : (
          entries.map(entry => (
            <button
              key={entry.id}
              type="button"
              title={entry.text}
              aria-current={activeId === entry.id ? 'location' : undefined}
              onClick={() => {
                if (scrollToHeading(entry.id)) setActiveId(entry.id)
              }}
              style={{ paddingLeft: (entry.level - 1) * 12 + 10 }}
              className={cn(
                'block w-full cursor-pointer truncate border-l-2 py-1 pr-2 text-left text-xs leading-4',
                activeId === entry.id
                  ? 'border-primary bg-blue-50 font-medium text-primary'
                  : 'border-transparent text-neutral-600 hover:bg-neutral-100',
              )}
            >
              {entry.text}
            </button>
          ))
        )}
      </div>
    </aside>
  )
}

export default OutlineNav
