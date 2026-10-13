import { useState, useEffect, useCallback, useMemo, type ClipboardEvent } from 'react'
import { Bubble, Sender } from '@ant-design/x'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Trash2, ChevronDown, ChevronUp, BookOpen, UserRound, Bot, Maximize2, Minimize2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useChatStore } from '@/store/chatStore'
import { useTaskStore } from '@/store/taskStore'
import { askQuestion, getChatStatus, indexTask, type ChatSource, type IndexStatus } from '@/services/chat'
import { normalizeMathDelimiters } from '@/utils/math'
import { cn } from '@/lib/utils'

const MAX_IMAGES = 4

interface ChatPanelProps {
  taskId: string
  /** 参照 dock 是否处于加宽档；按钮只负责在两档宽度间切换 */
  wide: boolean
  /** 在参照 dock 里时由 dock 提供 tab 标题与左边框，这里不再重复画 */
  embedded?: boolean
  onWideChange: (wide: boolean) => void
}

function SourceBadges({ sources }: { sources: ChatSource[] }) {
  const [expanded, setExpanded] = useState(false)

  if (!sources || sources.length === 0) return null

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600"
      >
        <BookOpen className="h-3 w-3" />
        <span>引用来源 ({sources.length})</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-1 flex flex-wrap gap-1">
          {sources.map((s, i) => (
            <Badge key={i} variant="outline" className="text-xs font-normal">
              {s.source_type === 'markdown'
                ? s.section_title || '笔记'
                : `${(s.start_time ?? 0).toFixed(0)}s ~ ${(s.end_time ?? 0).toFixed(0)}s`}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function UserContent({ content, images }: { content: string; images?: string[] }) {
  if (!images || images.length === 0) {
    return <div className="whitespace-pre-wrap">{content}</div>
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        {images.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`图片${i + 1}`}
            className="max-h-40 max-w-[160px] rounded border border-white/20 object-cover"
          />
        ))}
      </div>
      {content ? <div className="whitespace-pre-wrap">{content}</div> : null}
    </div>
  )
}

export default function ChatPanel({ taskId, wide, embedded = false, onWideChange }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)

  const messages = useChatStore(state => state.chatHistory[taskId]) ?? []
  const addMessage = useChatStore(state => state.addMessage)
  const clearChat = useChatStore(state => state.clearChat)

  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const tasks = useTaskStore(state => state.tasks)
  const currentTask = useMemo(
    () => tasks.find(t => t.id === currentTaskId) ?? null,
    [tasks, currentTaskId],
  )

  // 检查索引状态，未索引时自动触发，indexing 时轮询
  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const res = await getChatStatus(taskId)
        if (cancelled) return
        setIndexStatus(res.status)

        if (res.status === 'idle') {
          // 未索引，触发后台索引
          await indexTask(taskId)
          if (!cancelled) setIndexStatus('indexing')
        }

        // indexing 状态持续轮询
        if (res.status === 'indexing' || res.status === 'idle') {
          timer = setTimeout(poll, 2000)
        }
      } catch {
        if (!cancelled) setIndexStatus('failed')
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [taskId])

  // 支持把剪贴板里的图片直接粘贴进来（Ctrl+V）
  const handlePaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length === 0) return
    e.preventDefault()
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        setImages(prev => {
          const next = [...prev, reader.result as string]
          if (next.length > MAX_IMAGES) {
            toast(`最多支持 ${MAX_IMAGES} 张图片`)
            return next.slice(0, MAX_IMAGES)
          }
          return next
        })
      }
      reader.readAsDataURL(file)
    })
  }, [])

  const handleSend = useCallback(
    async (value: string) => {
      const question = value.trim()
      if ((!question && images.length === 0) || loading) return

      const providerId = currentTask?.formData?.provider_id
      const modelName = currentTask?.formData?.model_name
      if (!providerId || !modelName) {
        toast.error('无法获取模型配置，请确认任务已完成')
        return
      }

      const sentImages = [...images]
      addMessage(taskId, {
        role: 'user',
        content: question,
        images: sentImages.length > 0 ? sentImages : undefined,
      })
      setInput('')
      setImages([])
      setLoading(true)

      try {
        const history = messages.map(m => ({ role: m.role, content: m.content }))
        const res = await askQuestion({
          task_id: taskId,
          question,
          history,
          provider_id: providerId,
          model_name: modelName,
          images: sentImages.length > 0 ? sentImages : undefined,
        })
        addMessage(taskId, {
          role: 'assistant',
          content: res.answer,
          sources: res.sources,
        })
      } catch {
        toast.error('问答请求失败')
      } finally {
        setLoading(false)
      }
    },
    [loading, taskId, currentTask, messages, addMessage, images],
  )

  // 转换为 Bubble.List 的数据格式
  const bubbleItems = useMemo(() => {
    const items = messages.map((msg, i) => ({
      key: `msg-${i}`,
      role: msg.role === 'user' ? ('user' as const) : ('ai' as const),
      content:
        msg.role === 'user' ? (
          <UserContent content={msg.content} images={msg.images} />
        ) : (
          msg.content
        ),
      footer:
        msg.role === 'assistant' && msg.sources ? (
          <SourceBadges sources={msg.sources} />
        ) : undefined,
    }))

    if (loading) {
      items.push({
        key: 'loading',
        role: 'ai' as const,
        content: '思考中...',
        loading: true,
      } as any)
    }

    return items
  }, [messages, loading])

  // Bubble 角色配置
  const roles = useMemo(
    () => ({
      user: {
        placement: 'end' as const,
        avatar: (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-white">
            <UserRound className="h-4 w-4" />
          </div>
        ),
        variant: 'filled' as const,
        styles: { content: { background: '#3b82f6', color: '#fff' } },
      },
      ai: {
        placement: 'start' as const,
        avatar: (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-500 text-white">
            <Bot className="h-4 w-4" />
          </div>
        ),
        variant: 'outlined' as const,
        contentRender: (content: any) => (
          <div className="markdown-body prose prose-sm max-w-none prose-p:my-1 prose-li:my-0.5 prose-headings:my-2">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {typeof content === 'string' ? normalizeMathDelimiters(content) : String(content)}
            </ReactMarkdown>
          </div>
        ),
      },
    }),
    [],
  )

  if (indexStatus === null || indexStatus === 'indexing' || indexStatus === 'idle') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <div className="text-center">
          <p className="text-sm font-medium">正在索引笔记内容...</p>
          <p className="mt-1 text-xs">首次使用需下载 Embedding 模型（约 80MB），请耐心等待</p>
        </div>
      </div>
    )
  }

  if (indexStatus === 'failed') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400">
        <span className="text-sm">索引失败，请重试</span>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            setIndexStatus('indexing')
            try {
              await indexTask(taskId)
            } catch {
              toast.error('索引请求失败')
              setIndexStatus('failed')
            }
          }}
        >
          重新索引
        </Button>
      </div>
    )
  }

  return (
    <div className={cn('flex h-full flex-col', !embedded && 'border-l')}>
      {/* 头部 */}
      <div className={cn('flex items-center border-b px-3 py-2', embedded ? 'justify-end' : 'justify-between')}>
        {!embedded && <span className="text-sm font-medium">AI 问答</span>}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-neutral-400 hover:text-neutral-600"
            onClick={() => onWideChange(!wide)}
            title={wide ? '恢复参照面板默认宽度' : '加宽参照面板'}
          >
            {wide ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-neutral-400 hover:text-red-500"
              onClick={() => clearChat(taskId)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-hidden">
        {messages.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-neutral-400">
            <div>
              <p>针对笔记内容提问</p>
              <p className="mt-1 text-xs">例如：这个视频的核心观点是什么？</p>
              <p className="mt-1 text-xs">也可以直接粘贴题目截图（Ctrl+V）让 AI 读图回答</p>
            </div>
          </div>
        ) : (
          <Bubble.List
            items={bubbleItems}
            role={roles}
            style={{ height: '100%' }}
          />
        )}
      </div>

      {/* 输入区域 */}
      <div className="border-t px-3 py-2" onPaste={handlePaste}>
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={i} className="relative">
                <img src={src} alt={`预览${i + 1}`} className="h-16 w-16 rounded border object-cover" />
                <button
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-600 text-white hover:bg-red-500"
                  onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                  title="移除"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Sender
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          loading={loading}
          placeholder="输入你的问题...（可直接 Ctrl+V 粘贴图片）"
        />
      </div>
    </div>
  )
}