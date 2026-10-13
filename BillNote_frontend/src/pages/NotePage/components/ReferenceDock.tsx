import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import ChatPanel from './ChatPanel'
import TranscriptViewer from './transcriptViewer'

export type DockTab = 'transcript' | 'chat'

interface ReferenceDockProps {
  tab: DockTab
  onTab: (tab: DockTab) => void
  taskId: string
  /** ChatPanel 的放大/缩小按钮当前该显示哪个图标（由 dock 宽度状态决定） */
  wide: boolean
  /** ChatPanel 的放大/缩小按钮：语义是调 dock 宽度，不再是"全屏替换正文" */
  onResize: (mode: 'half' | 'full') => void
  /** 窄屏浮层模式下给一个关闭按钮 */
  onClose?: () => void
  /** 转写联动：点转写行抛时间、正文章节变化时把列表带过去 */
  onPickTime?: (seconds: number) => void
  focusTime?: number | null
}

/**
 * 原文参照 / AI 问答合并后的参照 dock。
 *
 * 两个面板都挂载、用 hidden 切换：保留各自的滚动位置与聊天历史，
 * 切 tab 不会把问了一半的对话弄丢。以前是两个并列 state + 硬编码宽度，
 * 而且 AI 切"全屏"会把原文参照整个替换掉、再也打不开。
 */
export function ReferenceDock({
  tab,
  onTab,
  taskId,
  wide,
  onResize,
  onClose,
  onPickTime,
  focusTime = null,
}: ReferenceDockProps) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-white print:hidden">
      <div role="tablist" aria-label="参照面板" className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        {(['transcript', 'chat'] as const).map(key => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => onTab(key)}
            className={cn(
              'cursor-pointer rounded px-2.5 py-1 text-sm',
              tab === key ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-neutral-100',
            )}
          >
            {key === 'transcript' ? '原文参照' : 'AI 问答'}
          </button>
        ))}
        {onClose && (
          <button
            type="button"
            aria-label="关闭参照面板"
            title="关闭参照面板"
            onClick={onClose}
            className="text-muted-foreground hover:bg-accent hover:text-foreground ml-auto cursor-pointer rounded p-1"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* TranscriptViewer 自带卡片边框，垫一点内边距让它在 dock 里看着是故意的 */}
      <div role="tabpanel" hidden={tab !== 'transcript'} className="h-full min-h-0 flex-1 overflow-hidden p-2">
        <TranscriptViewer onPickTime={onPickTime} focusTime={focusTime} />
      </div>
      <div role="tabpanel" hidden={tab !== 'chat'} className="h-full min-h-0 flex-1 overflow-hidden">
        <ChatPanel
          taskId={taskId}
          wide={wide}
          onWideChange={w => onResize(w ? 'full' : 'half')}
          embedded
        />
      </div>
    </div>
  )
}

export default ReferenceDock
