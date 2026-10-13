import { useState, useEffect, useRef, useMemo, memo, FC } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button.tsx'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { toast } from 'react-hot-toast'
import Error from '@/components/Lottie/error.tsx'
import Loading from '@/components/Lottie/Loading.tsx'
import Idle from '@/components/Lottie/Idle.tsx'
import StepBar from '@/pages/NotePage/components/StepBar.tsx'
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
import { createMarkdownComponents } from '@/pages/NotePage/components/markdownComponents.tsx'
import { EditPane } from '@/pages/NotePage/components/EditPane.tsx'
import { useVersions } from '@/hooks/useVersions'
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

// ReactMarkdown 的组件映射 / 折叠 / 版本 / 编辑面板都拆出去了，本文件只做组装
const MarkdownViewer: FC<MarkdownViewerProps> = memo(({ status }) => {
  // 确保baseURL没有尾部斜杠
  const baseURL = (String(import.meta.env.VITE_API_BASE_URL || '').replace('/api','') || '').replace(/\/$/, '')
  const getCurrentTask = useTaskStore.getState().getCurrentTask
  const currentTask = useTaskStore(state => state.getCurrentTask())
  const taskStatus = currentTask?.status || 'PENDING'
  const retryTask = useTaskStore.getState().retryTask
  // 版本历史的权威存储在后端 note_versions 表；本地 store 里可能还留着升级前的数组格式，
  // 由下面的 effect 一次性上传后降级为最新正文串。
  // 这里只能用 currentTask?.id：taskId 在下面第 100 行才声明，而 selector 是渲染期同步调用的，
  // 引用它会撞上 TDZ（ReferenceError → 整页白屏），tsc 对闭包里的提前引用不报错。
  const versionsOrNull = useLibraryStore(state =>
    currentTask?.id ? (state.versionsByTask[currentTask.id] ?? null) : null,
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

  const bodyRef = useRef<HTMLDivElement>(null)
  const {
    currentVerId,
    setCurrentVerId,
    selectedContent,
    modelName,
    style,
    createTime,
    handleDeleteVersion,
  } = useVersions(currentTask, versions, taskStatus)

  // 转写↔正文联动：章节起始时间表 + 当前高亮章节的起始秒（必须在 bodyRef 声明之后）
  const sectionTimes = useSectionTimes(bodyRef, selectedContent)
  const activeSectionStart = sectionTimes.find(t => t.id === activeSectionId)?.start ?? null
  const handlePickTime = (seconds: number) => {
    const section = sectionForTime(sectionTimes, seconds)
    if (section) scrollToHeading(section.id)
  }

  const [foldAll, setFoldAll] = useState(false)

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
  if (status === 'loading') {
    return (
      <div className="flex h-full w-full flex-col">
        {/* 生成中也要有出口：这一页以前没有任何返回入口，人被卡在这儿只能刷新或按浏览器后退，
            很自然就会以为任务没成功、回去再新建一次（同一视频被生成两遍） */}
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => goShelf(folderId)}>
            <ArrowLeft className="h-4 w-4" />
            返回书架
          </Button>
          <span className="text-muted-foreground min-w-0 truncate text-xs">
            {currentTask?.audioMeta?.title ||
              currentTask?.formData?.video_url ||
              '新任务'}{' '}
            · 生成中，可以随时离开这一页
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center space-y-4 text-neutral-500">
          <StepBar steps={steps} currentStep={taskStatus} />
          <Loading />
          <div className="text-center text-sm">
            <p className="text-lg font-bold">正在{taskStatusLabels[taskStatus] || '生成笔记'}，请稍候…</p>
            <p className="text-muted-foreground mt-2 max-w-md text-xs">
              长视频要抽帧并分批送给模型，可能需要几分钟。任务在后端跑着，
              回书架做别的事也不影响，完成后那张卡片会变成「已完成」。
            </p>
          </div>
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
        <EditPane
          draft={draft}
          onDraftChange={setDraft}
          saving={saving}
          baseURL={baseURL}
          onCancel={() => setEditing(false)}
          onSave={handleSaveEdit}
        />
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
