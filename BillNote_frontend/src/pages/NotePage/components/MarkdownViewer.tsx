import { useState, useEffect, useRef, useMemo, memo, FC } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button.tsx'
import { Copy, ArrowRight, Play, ExternalLink, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import Error from '@/components/Lottie/error.tsx'
import Loading from '@/components/Lottie/Loading.tsx'
import Idle from '@/components/Lottie/Idle.tsx'
import StepBar from '@/pages/NotePage/components/StepBar.tsx'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark as codeStyle } from 'react-syntax-highlighter/dist/esm/styles/prism'
import Zoom from 'react-medium-image-zoom'
import 'react-medium-image-zoom/dist/styles.css'
import gfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import rehypeFold from '@/lib/rehypeFold'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown-light.css'
import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { useTaskStore } from '@/store/taskStore'
import { update_note } from '@/services/note'
import { normalizeMathDelimiters } from '@/utils/math'
import { scrollToHeading } from '@/utils/heading'
import { exportNoteAsHtml } from '@/utils/exportHtml'
import { noteStyles, taskStatusLabels } from '@/constant/note.ts'
import { MarkdownHeader } from '@/pages/NotePage/components/MarkdownHeader.tsx'
import MarkmapEditor from '@/pages/NotePage/components/MarkmapComponent.tsx'
import VideoBanner from '@/pages/NotePage/components/VideoBanner.tsx'
import OutlineNav from '@/pages/NotePage/components/OutlineNav.tsx'
import ReferenceDock, { type DockTab } from '@/pages/NotePage/components/ReferenceDock.tsx'
import { NoteFormDialog } from '@/components/NoteFormDialog'
import { useNoteActions } from '@/hooks/useNoteActions'
import { useShelfItems, type ShelfItem } from '@/hooks/useShelfItems'
import { useLibraryStore } from '@/store/libraryStore'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useSectionTimes, sectionForTime } from '@/hooks/useSectionTimes'
import type { NoteSibling } from '@/pages/NotePage/components/MarkdownHeader.tsx'
import type { Markdown } from '@/store/taskStore'
import type { NoteVersion } from '@/services/library'

const OUTLINE_STORAGE_KEY = 'note-outline-collapsed'
// 模块级空数组：selector 里现造 [] 会让 zustand 每渲染都判定变了，陷入重渲染循环
const EMPTY_VERSIONS: NoteVersion[] = []

interface MarkdownViewerProps {
  status: 'idle' | 'loading' | 'success' | 'failed'
}

const steps = [
  { label: '解析链接', key: 'PARSING' },
  { label: '下载音视频', key: 'DOWNLOADING' },
  { label: '抽取画面', key: 'EXTRACTING' },
  { label: '转写文字', key: 'TRANSCRIBING' },
  { label: '总结内容', key: 'SUMMARIZING' },
  { label: '保存完成', key: 'SUCCESS' },
]

const remarkPlugins = [gfm, remarkMath]
// rehypeFold 必须排在 rehypeSlug 之后：它要复用 slug 已经写到标题上的 id
const rehypePlugins = [rehypeKatex, rehypeSlug, rehypeFold]

/**
 * 构建 ReactMarkdown components 对象，baseURL 用于修正图片路径。
 * 使用函数 + useMemo 避免每次渲染都创建新的函数实例。
 */
function createMarkdownComponents(baseURL: string) {
  return {
    h1: ({ children, ...props }: any) => (
      <h1
        className="text-primary my-6 scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl"
        {...props}
      >
        {children}
      </h1>
    ),
    h2: ({ children, ...props }: any) => (
      <h2
        className="text-primary mt-10 mb-4 scroll-m-20 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0"
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }: any) => (
      <h3
        className="text-primary mt-8 mb-4 scroll-m-20 text-xl font-semibold tracking-tight"
        {...props}
      >
        {children}
      </h3>
    ),
    h4: ({ children, ...props }: any) => (
      <h4
        className="text-primary mt-6 mb-2 scroll-m-20 text-lg font-semibold tracking-tight"
        {...props}
      >
        {children}
      </h4>
    ),
    p: ({ children, ...props }: any) => (
      <p className="leading-7 [&:not(:first-child)]:mt-6" {...props}>
        {children}
      </p>
    ),
    a: ({ href, children, ...props }: any) => {
      const isOriginLink =
        typeof children[0] === 'string' &&
        (children[0] as string).startsWith('原片 @')

      if (isOriginLink) {
        const timeMatch = (children[0] as string).match(/原片 @ (\d{1,3}:\d{2})/)
        const timeText = timeMatch ? timeMatch[1] : '原片'

        return (
          <span className="origin-link my-2 inline-flex">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
              {...props}
            >
              <Play className="h-3.5 w-3.5" />
              <span>原片（{timeText}）</span>
            </a>
          </span>
        )
      }

      // 处理笔记内部锚点链接（如目录跳转）；章节导航也走同一份匹配规则
      if (href?.startsWith('#')) {
        const handleAnchorClick = (e: React.MouseEvent) => {
          e.preventDefault()
          if (!scrollToHeading(decodeURIComponent(href.slice(1)))) {
            toast.error('未找到对应章节')
          }
        }

        return (
          <a
            href={href}
            onClick={handleAnchorClick}
            className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5 font-medium underline underline-offset-4"
            {...props}
          >
            {children}
          </a>
        )
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5 font-medium underline underline-offset-4"
          {...props}
        >
          {children}
          {href?.startsWith('http') && (
            <ExternalLink className="ml-0.5 inline-block h-3 w-3" />
          )}
        </a>
      )
    },
    img: ({ node, ...props }: any) => {
      let src = props.src
      if (src.startsWith('/')) {
        src = baseURL + src
      }
      props.src = src

      return (
        <div className="my-8 flex justify-center">
          <Zoom>
            <img
              {...props}
              className="max-w-full cursor-zoom-in rounded-lg object-cover shadow-md transition-all hover:shadow-lg"
              style={{ maxHeight: '500px' }}
            />
          </Zoom>
        </div>
      )
    },
    strong: ({ children, ...props }: any) => (
      <strong className="text-primary font-bold" {...props}>
        {children}
      </strong>
    ),
    li: ({ children, ...props }: any) => {
      const rawText = String(children)
      const isFakeHeading = /^(\*\*.+\*\*)$/.test(rawText.trim())

      if (isFakeHeading) {
        return (
          <div className="text-primary my-4 text-lg font-bold">{children}</div>
        )
      }

      return (
        <li className="my-1" {...props}>
          {children}
        </li>
      )
    },
    ul: ({ children, ...props }: any) => (
      <ul className="my-6 ml-6 list-disc [&>li]:mt-2" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }: any) => (
      <ol className="my-6 ml-6 list-decimal [&>li]:mt-2" {...props}>
        {children}
      </ol>
    ),
    blockquote: ({ children, ...props }: any) => (
      <blockquote
        className="border-primary/20 text-muted-foreground mt-6 border-l-4 pl-4 italic"
        {...props}
      >
        {children}
      </blockquote>
    ),
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const codeContent = String(children).replace(/\n$/, '')

      if (!inline && match) {
        return (
          <div className="group bg-muted relative my-6 overflow-hidden rounded-lg border shadow-sm">
            <div className="bg-muted text-muted-foreground flex items-center justify-between px-4 py-1.5 text-sm font-medium">
              <div>{match[1].toUpperCase()}</div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(codeContent)
                  toast.success('代码已复制')
                }}
                className="bg-background/80 hover:bg-background flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                复制
              </button>
            </div>
            <SyntaxHighlighter
              style={codeStyle}
              language={match[1]}
              PreTag="div"
              className="!bg-muted !m-0 !p-0"
              customStyle={{
                margin: 0,
                padding: '1rem',
                background: 'transparent',
                fontSize: '0.9rem',
              }}
              {...props}
            >
              {codeContent}
            </SyntaxHighlighter>
          </div>
        )
      }

      return (
        <code
          className="bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm"
          {...props}
        >
          {children}
        </code>
      )
    },
    table: ({ children, ...props }: any) => (
      <div className="my-6 w-full overflow-y-auto">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }: any) => (
      <th
        className="border-muted-foreground/20 border px-4 py-2 text-left font-medium [&[align=center]]:text-center [&[align=right]]:text-right"
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ children, ...props }: any) => (
      <td
        className="border-muted-foreground/20 border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
        {...props}
      >
        {children}
      </td>
    ),
    hr: ({ ...props }: any) => (
      <hr className="border-muted-foreground/20 my-8" {...props} />
    ),
  }
}

const MarkdownViewer: FC<MarkdownViewerProps> = memo(({ status }) => {
  const [currentVerId, setCurrentVerId] = useState<string>('')
  const [selectedContent, setSelectedContent] = useState<string>('')
  const [modelName, setModelName] = useState<string>('')
  const [style, setStyle] = useState<string>('')
  const [createTime, setCreateTime] = useState<string>('')
  // 确保baseURL没有尾部斜杠
  const baseURL = (String(import.meta.env.VITE_API_BASE_URL || '').replace('/api','') || '').replace(/\/$/, '')
  const getCurrentTask = useTaskStore.getState().getCurrentTask
  const currentTask = useTaskStore(state => state.getCurrentTask())
  const taskStatus = currentTask?.status || 'PENDING'
  const retryTask = useTaskStore.getState().retryTask
  // 版本历史的权威存储在后端 note_versions 表；本地 store 里可能还留着升级前的数组格式，
  // 由下面的 effect 一次性上传后降级为最新正文串
  const versionsOrNull = useLibraryStore(state =>
    taskId ? (state.versionsByTask[taskId] ?? null) : null,
  )
  const versions = versionsOrNull ?? EMPTY_VERSIONS
  const isMultiVersion = versions.length > 1
  // 原文参照 / AI 问答合并成一个 dock 的两个 tab，null = 关闭。
  // 以前是两个并列 state + 硬编码宽度，且 AI 切"全屏"会把原文参照整个替换掉再也打不开。
  const [dockTab, setDockTab] = useState<DockTab | null>(null)
  const dockRef = useRef<ImperativePanelHandle>(null)
  const [outlineCollapsed, setOutlineCollapsed] = useState(
    () => localStorage.getItem(OUTLINE_STORAGE_KEY) === '1',
  )
  // 用户自己的折叠偏好。dock 打开时章节栏临时让位，关掉要恢复成这个值而不是写死的 false
  const outlinePrefRef = useRef(outlineCollapsed)
  const isNarrow = useMediaQuery('(max-width: 1100px)')
  const [viewMode, setViewMode] = useState<'map' | 'preview'>('preview')
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // 缓存 ReactMarkdown components，仅在 baseURL 变化时重建
  const markdownComponents = useMemo(() => createMarkdownComponents(baseURL), [baseURL])

  // ---- 两级导航：返回书架 / 同文件夹切换 / 笔记级操作 ----
  const navigate = useNavigate()
  const shelfItems = useShelfItems()
  const taskId = currentTask?.id
  const {
    title: noteTitle,
    folderId,
    folderName,
    entries: noteEntries,
    dialogs: noteDialogs,
  } = useNoteActions(
    taskId,
    currentTask?.audioMeta?.title || '未命名笔记',
    currentTask?.formData?.video_url || currentTask?.audioMeta?.raw_info?.webpage_url || '',
  )
  const [regenerateOpen, setRegenerateOpen] = useState(false)

  // 标题下拉里放同文件夹的笔记 + 最近打开的，去重后截断：
  // 换一篇笔记不该非得退回书架再点一次（两级导航最大的代价就是这个，得补回来）
  const siblings = useMemo<NoteSibling[]>(() => {
    const sameFolder = shelfItems.filter(item => item.folderId === folderId)
    const recent = shelfItems
      .filter(item => item.lastOpenedAt)
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    const merged: ShelfItem[] = []
    const seen = new Set<string>()
    for (const item of [...sameFolder, ...recent]) {
      if (seen.has(item.taskId)) continue
      seen.add(item.taskId)
      merged.push(item)
    }
    return merged.slice(0, 12).map(item => ({
      taskId: item.taskId,
      title: item.title,
      active: item.taskId === taskId,
    }))
  }, [shelfItems, folderId, taskId])

  const goShelf = (folder?: string | null) =>
    navigate('/', folder ? { state: { folder } } : undefined)

  const overlays = (
    <>
      <NoteFormDialog
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
        taskId={taskId ?? null}
        onSubmitted={() => useLibraryStore.getState().fetchLibrary()}
      />
      {noteDialogs}
    </>
  )

  const dockOpen = dockTab !== null

  const setOutlineCollapsedPersist = (value: boolean) => {
    setOutlineCollapsed(value)
    outlinePrefRef.current = value
    localStorage.setItem(OUTLINE_STORAGE_KEY, value ? '1' : '0')
  }

  // 窄屏横向空间本来就不够，章节栏默认让位
  useEffect(() => {
    if (isNarrow) setOutlineCollapsedPersist(true)
  }, [isNarrow])

  // dock 占掉横向空间时章节栏收成竖条；关掉恢复用户之前的偏好
  useEffect(() => {
    if (dockOpen) setOutlineCollapsed(true)
    else setOutlineCollapsed(outlinePrefRef.current)
  }, [dockOpen])

  useEffect(() => {
    if (dockOpen) dockRef.current?.expand()
    else dockRef.current?.collapse()
  }, [dockOpen])

  // ChatPanel 的放大/缩小按钮现在只负责调 dock 宽度，不再有"全屏替换正文"。
  // 宽窄状态必须存在这一层：ChatPanel 自己只认 mode prop，写死 'half' 会让按钮永远朝一个方向切。
  const [dockWide, setDockWide] = useState(false)
  const handleChatResize = (mode: 'half' | 'full') => {
    setDockWide(mode === 'full')
    dockRef.current?.resize(mode === 'full' ? 65 : 38)
  }

  // 进详情页拉一次版本列表；重新生成/编辑保存后会单独再拉
  useEffect(() => {
    if (taskId) useLibraryStore.getState().fetchVersions(taskId)
  }, [taskId])

  // 升级前的本地版本数组一次性上传到后端，之后本地只留最新正文
  useEffect(() => {
    if (!currentTask || currentTask.versionsSynced) return
    if (!Array.isArray(currentTask.markdown)) {
      useTaskStore.getState().markVersionsSynced(currentTask.id)
      return
    }
    const local = currentTask.markdown as Markdown[]
    useLibraryStore
      .getState()
      .uploadLocalVersions(
        currentTask.id,
        local.map(v => ({
          ver_id: v.ver_id,
          content: v.content,
          style: v.style || null,
          model_name: v.model_name || null,
          created_at: v.created_at ? new Date(v.created_at).getTime() : null,
        })),
      )
      .then(ok => {
        if (!ok) return
        const latest = [...local].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]
        useTaskStore.getState().adoptServerVersions(currentTask.id, latest?.content || '')
      })
      .catch(() => {})
  }, [currentTask?.id, currentTask?.versionsSynced])

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
  // ---- 章节折叠 ----
  // 折叠状态用 DOM class 存（不用 React state）：一节一节展开/收起是纯视觉状态，
  // 走事件委托改 class 既不用给每个标题挂状态，也不会和 React 的重渲染打架
  const bodyRef = useRef<HTMLDivElement>(null)
  const [foldAll, setFoldAll] = useState(false)

  // 转写↔正文联动：章节起始时间表 + 当前高亮章节的起始秒（必须在 bodyRef 声明之后）
  const sectionTimes = useSectionTimes(bodyRef, selectedContent)
  const activeSectionStart = sectionTimes.find(t => t.id === activeSectionId)?.start ?? null
  const handlePickTime = (seconds: number) => {
    const section = sectionForTime(sectionTimes, seconds)
    if (section) scrollToHeading(section.id)
  }

  const handleFoldClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const toggle = (e.target as HTMLElement).closest('.md-fold-toggle')
    if (!toggle) return
    e.preventDefault()
    toggle.closest('.md-section')?.classList.toggle('md-collapsed')
  }

  const handleToggleFoldAll = () => {
    const root = bodyRef.current
    if (!root) return
    const sections = [...root.querySelectorAll('.md-section')].filter(
      // 一级标题是笔记总标题，收起来整篇就没了
      section => section.getAttribute('data-level') !== '1',
    )
    // 从 DOM 实际状态推导：目录跳转会自动展开祖先、切换版本会整棵重建，
    // 只靠 foldAll 这个 state 记的话按钮文案会和真实状态脱节
    const collapse = sections.some(section => !section.classList.contains('md-collapsed'))
    sections.forEach(section => section.classList.toggle('md-collapsed', collapse))
    setFoldAll(collapse)
  }

  // 换版本/重新渲染后 DOM 是全新展开的，按钮文案要跟着复位
  useEffect(() => {
    setFoldAll(false)
  }, [selectedContent])

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedContent)
      toast.success('已复制到剪贴板')
    } catch (e) {
      toast.error('复制失败')
    }
  }
  const handleExportHtml = async () => {
    try {
      await exportNoteAsHtml(bodyRef.current, noteTitle)
      toast.success('已导出离线 HTML')
    } catch (e) {
      console.error('导出 HTML 失败：', e)
      toast.error('导出失败')
    }
  }

  const handleDownload = () => {
    const task = getCurrentTask()
    const name = task?.audioMeta.title || 'note'
    const blob = new Blob([selectedContent], { type: 'text/markdown;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${name}.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleStartEdit = () => {
    if (!selectedContent || selectedContent === 'loading' || selectedContent === 'empty') return
    setDraft(selectedContent)
    setViewMode('preview')
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!currentTask) return
    if (!draft.trim()) {
      toast.error('笔记内容不能为空')
      return
    }
    if (draft === selectedContent) {
      toast('内容没有变化，已退出编辑')
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const res = await update_note(currentTask.id, draft)
      // 后端保存时落了一个新版本行，拉回来并切过去
      await useLibraryStore.getState().fetchVersions(currentTask.id)
      if (res?.ver_id) setCurrentVerId(res.ver_id)
      useTaskStore.getState().updateTaskContent(currentTask.id, { markdown: draft })
      setEditing(false)
      toast.success('已保存（旧版本可在版本下拉中查看）')
    } catch (e) {
      // 失败提示由请求拦截器统一处理
    } finally {
      setSaving(false)
    }
  }

  // 编辑模式：解析草稿里的图片引用，生成缩略图列表（便于直观识别重复图片并删除）
  const draftImages = useMemo(() => {
    const out: { alt: string; url: string; line: number; start: number; end: number }[] = []
    const re = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(draft)) !== null) {
      const line = draft.slice(0, m.index).split('\n').length
      out.push({ alt: m[1] || '', url: m[2], line, start: m.index, end: m.index + m[0].length })
    }
    return out
  }, [draft])

  const removeDraftImage = (start: number, end: number) => {
    setDraft(prev => {
      // 若该行去掉所有图片引用后为空，则整行删除；否则只删除这一处引用
      const lineStart = prev.lastIndexOf('\n', start - 1) + 1
      const nl = prev.indexOf('\n', end)
      const lineEnd = nl === -1 ? prev.length : nl
      const lineContent = prev.slice(lineStart, lineEnd)
      const imgRe = /!\[[^\]]*\]\(\s*[^)\s]+(?:\s+"[^"]*")?\s*\)/g
      const remainder = lineContent.replace(imgRe, '').trim()
      if (!remainder) {
        return prev.slice(0, lineStart) + prev.slice(Math.min(lineEnd + 1, prev.length))
      }
      return prev.slice(0, start) + prev.slice(end)
    })
  }

  if (status === 'loading') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center space-y-4 text-neutral-500">
        <StepBar steps={steps} currentStep={taskStatus} />
        <Loading />
        <div className="text-center text-sm">
          <p className="text-lg font-bold">正在{taskStatusLabels[taskStatus] || '生成笔记'}，请稍候…</p>
          <p className="mt-2 text-xs text-neutral-500">
            长视频要抽帧并分批送给模型，可能需要几分钟；按钮已锁定，无需重复点击
          </p>
        </div>
      </div>
    )
  }

  if (status === 'idle') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center space-y-3 text-neutral-500">
        <Idle />
        <div className="text-center">
          <p className="text-lg font-bold">输入视频链接并点击"生成笔记"</p>
          <p className="mt-2 text-xs text-neutral-500">支持哔哩哔哩、YouTube 、抖音等视频平台</p>
        </div>
      </div>
    )
  }

  if (status === 'failed' && !isMultiVersion) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 space-y-3">
        <Error />
        <div className="text-center">
          <p className="text-lg font-bold text-red-500">笔记生成失败</p>
          <p className="mt-2 mb-4 text-xs text-red-400">可以直接重试，也可以先换个模型或笔记风格</p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => currentTask && retryTask(currentTask.id)} size="lg">
              直接重试
            </Button>
            <Button variant="outline" size="lg" onClick={() => setRegenerateOpen(true)}>
              改参数重新生成
            </Button>
            <Button variant="ghost" size="lg" onClick={() => goShelf()}>
              返回书架
            </Button>
          </div>
        </div>
        {overlays}
      </div>
    )
  }

  const noteColumn =
    selectedContent && selectedContent !== 'loading' && selectedContent !== 'empty' ? (
      <ScrollArea className="h-full min-w-0 bg-white py-2">
        {/* 正文限宽居中：2560px 屏上一行横跨全屏根本没法读，
            成熟笔记软件（Notion / 语雀）都是给内容列一个最大宽度 */}
        <div className="mx-auto w-full max-w-[1200px] px-2">
          <VideoBanner
            audioMeta={currentTask?.audioMeta}
            videoUrl={currentTask?.formData?.video_url}
          />
          <div className={'markdown-body w-full'} ref={bodyRef} onClick={handleFoldClick}>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              components={markdownComponents}
            >
              {normalizeMathDelimiters(selectedContent.replace(/^>\s*来源链接：[^\n]*\n*/m, ''))}
            </ReactMarkdown>
          </div>
        </div>
      </ScrollArea>
    ) : (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <div className="w-[300px] flex-col justify-items-center">
          <div className="bg-primary-light mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <ArrowRight className="text-primary h-8 w-8" />
          </div>
          <p className="mb-2 text-neutral-600">输入视频链接并点击"生成笔记"按钮</p>
          <p className="text-xs text-neutral-500">支持哔哩哔哩、YouTube等视频网站</p>
        </div>
      </div>
    )

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <MarkdownHeader
        title={noteTitle}
        onBack={() => goShelf()}
        folderName={folderName}
        onOpenFolder={() => goShelf(folderId)}
        siblings={siblings}
        onSwitchNote={id => navigate(`/note/${id}`)}
        onBackToShelf={() => goShelf()}
        onRegenerate={() => setRegenerateOpen(true)}
        noteEntries={noteEntries}
        versions={versions}
        isMultiVersion={isMultiVersion}
        currentVerId={currentVerId}
        setCurrentVerId={setCurrentVerId}
        modelName={modelName}
        style={style}
        noteStyles={noteStyles}
        onCopy={handleCopy}
        onDownload={handleDownload}
        onExportHtml={handleExportHtml}
        onPrint={() => window.print()}
        createAt={createTime}
        dockTab={dockTab}
        onDockTab={setDockTab}
        viewMode={viewMode}
        setViewMode={setViewMode}
        foldAll={foldAll}
        onFoldAll={handleToggleFoldAll}
        onDeleteVersion={handleDeleteVersion}
        canDeleteVersion={versions.length > 1}
        onEdit={handleStartEdit}
        editing={editing}
      />

      {viewMode === 'map' ? (
        <div className="flex w-full flex-1 overflow-hidden bg-white">
          <div className={'w-full'}>
            <MarkmapEditor
              value={selectedContent}
              onChange={() => {}}
              height="100%" // 根据需求可以设定百分比或固定高度
              title={currentTask?.audioMeta?.title || '思维导图'}
            />
          </div>
        </div>
      ) : editing ? (
        <div className="flex flex-1 flex-col overflow-hidden bg-white px-3 py-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-sm">
              编辑 Markdown：可在下方缩略图里点 × 删除图片，或直接修改文字，保存后生成新版本
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                取消
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
          {draftImages.length > 0 && (
            <div className="mb-2 shrink-0 rounded-md border bg-neutral-50 p-2">
              <div className="text-muted-foreground mb-1.5 text-xs">
                共 {draftImages.length} 张图片 —— 重复的图片缩略图会完全相同，点右上角 × 删除对应那一处（序号·行号见图片角标）
              </div>
              <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {draftImages.map((img, i) => (
                  <div key={`${img.start}-${img.end}`} className="relative">
                    <img
                      src={img.url.startsWith('/') ? baseURL + img.url : img.url}
                      alt={img.alt || `图${i + 1}`}
                      title={`图 ${i + 1} · 第 ${img.line} 行\n${img.url}`}
                      className="h-20 w-28 cursor-help rounded border object-cover"
                    />
                    <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] leading-4 text-white">
                      图{i + 1} · 行{img.line}
                    </span>
                    <button
                      onClick={() => removeDraftImage(img.start, img.end)}
                      title="删除这张图片"
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-600 text-white hover:bg-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-0 w-full flex-1 resize-none rounded-md border p-3 font-mono text-sm leading-6 focus:outline-none"
          />
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-white">
          {isNarrow ? (
            <>
              {noteColumn}
              {/* 窄屏不挤正文：dock 作为右侧浮层盖在上面 */}
              {dockTab && currentTask && (
                <div className="border-l shadow-xl absolute inset-y-0 right-0 z-30 w-[min(440px,92vw)] bg-white">
                  <ReferenceDock
                    tab={dockTab}
                    onTab={setDockTab}
                    taskId={currentTask.id}
                    wide={dockWide}
                    onResize={handleChatResize}
                    onClose={() => setDockTab(null)}
                    focusTime={dockTab === 'transcript' ? activeSectionStart : null}
                    onPickTime={handlePickTime}
                  />
                </div>
              )}
            </>
          ) : (
            <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
              <ResizablePanel defaultSize={100} minSize={45}>
                {noteColumn}
              </ResizablePanel>
              <ResizableHandle />
              {/* dock 面板常驻挂载、靠 collapse/expand 开关：条件挂载会让布局跳变 */}
              <ResizablePanel
                ref={dockRef}
                collapsible
                collapsedSize={0}
                defaultSize={38}
                minSize={25}
                maxSize={70}
              >
                {currentTask && (
                  <ReferenceDock
                    tab={dockTab ?? 'transcript'}
                    onTab={setDockTab}
                    taskId={currentTask.id}
                    wide={dockWide}
                    onResize={handleChatResize}
                    focusTime={dockTab === 'transcript' ? activeSectionStart : null}
                    onPickTime={handlePickTime}
                  />
                )}
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      )}
      {overlays}
      </div>
      <OutlineNav
        containerRef={bodyRef}
        contentKey={viewMode === 'preview' && !editing ? selectedContent : ''}
        collapsed={outlineCollapsed}
        onCollapsedChange={setOutlineCollapsedPersist}
        onActiveChange={setActiveSectionId}
      />
    </div>
  )
})

MarkdownViewer.displayName = 'MarkdownViewer'

export default MarkdownViewer
