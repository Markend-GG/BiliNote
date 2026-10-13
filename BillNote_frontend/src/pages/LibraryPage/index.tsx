import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Clock,
  Eye,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  Pencil,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import Fuse from 'fuse.js'
import toast from 'react-hot-toast'
import logo from '@/assets/icon.svg'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { MenuEntryOrSeparator } from '@/components/ui/menu'
import { NoteFormDialog } from '@/components/NoteFormDialog'
import { useLibraryStore, type LibraryFolder } from '@/store/libraryStore'
import { useTaskStore } from '@/store/taskStore'
import { useShelfItems, type ShelfItem } from '@/hooks/useShelfItems'
import { NoteCard, NoteRow } from './components/NoteCard'
import { FolderCard } from './components/FolderCard'
import { PromptDialog } from '@/components/PromptDialog'

/** activeFolder: null = 全部，'none' = 未分类，其余是文件夹 id */
type FolderFilter = string | 'none' | null

type PromptState =
  | { kind: 'newFolder' }
  | { kind: 'renameFolder'; id: string; name: string }
  | { kind: 'renameNote'; id: string; name: string }

const UNCATEGORIZED = '未分类'

/**
 * 书架页（第一级）。
 *
 * 负责"整理和挑选"：文件夹 + 笔记卡片混排、拖拽归档、搜索、新建。
 * 阅读是第二级 /note/:taskId 的事——分成两级之后正文才拿得到接近满宽的空间，
 * 也顺带把原来常驻左侧、一天用不了几次的「新建表单」挪进了模态框。
 */
const LibraryPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const folders = useLibraryStore(state => state.folders)
  const viewMode = useLibraryStore(state => state.viewMode)
  const loaded = useLibraryStore(state => state.loaded)
  const loading = useLibraryStore(state => state.loading)
  const { fetchLibrary, setViewMode, addFolder, renameFolder, removeFolder, moveNote, renameNote } =
    useLibraryStore()
  const removeTask = useTaskStore(state => state.removeTask)
  const items = useShelfItems()

  const [search, setSearch] = useState('')
  const [bodyHits, setBodyHits] = useState<SearchHit[]>([])
  // 从详情页点面包屑回来时，直接落在那篇笔记所在的文件夹里
  const [activeFolder, setActiveFolder] = useState<FolderFilter>(
    () => (location.state as { folder?: string | null } | null)?.folder ?? null,
  )
  const [newNoteOpen, setNewNoteOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [folderToDelete, setFolderToDelete] = useState<LibraryFolder | null>(null)
  const [noteToDelete, setNoteToDelete] = useState<ShelfItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchLibrary()
  }, [fetchLibrary])

  const fuse = useMemo(() => new Fuse(items, { keys: ['title'], threshold: 0.4 }), [items])

  // 标题走本地 Fuse，正文走后端 FTS5；两个字符起才值得打后端
  useEffect(() => {
    const keyword = search.trim()
    if (keyword.length < 2) {
      setBodyHits([])
      return
    }
    const timer = setTimeout(() => {
      searchNotes(keyword)
        .then(setBodyHits)
        .catch(() => setBodyHits([]))
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const keyword = search.trim()
  const searching = !!keyword

  const visibleItems = useMemo(() => {
    // 搜索是全局的：跨文件夹找笔记时不该被当前选中的文件夹限制住
    const base = searching ? fuse.search(keyword).map(r => r.item) : items
    const filtered =
      searching || activeFolder === null
        ? base
        : activeFolder === 'none'
          ? base.filter(item => !item.folderId)
          : base.filter(item => item.folderId === activeFolder)
    return [...filtered].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [items, fuse, keyword, searching, activeFolder])

  // 最近打开只占一行，够跳回去就行，不做成卡片区
  const recent = useMemo(
    () =>
      items
        .filter(item => item.lastOpenedAt)
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
        .slice(0, 5),
    [items],
  )

  const folderName = (id: string | null) =>
    id ? (folders.find(f => f.id === id)?.name ?? UNCATEGORIZED) : UNCATEGORIZED

  // 计数一律从合并后的 items 算：后端 note_count 只统计落过盘的笔记，
  // 刚提交还没写进索引的、以及只在本地的那条会漏掉，chip 上的数字就和「全部」对不上
  const counts = useMemo(() => {
    const byFolder = new Map<string, number>()
    let none = 0
    for (const item of items) {
      if (item.folderId) byFolder.set(item.folderId, (byFolder.get(item.folderId) ?? 0) + 1)
      else none += 1
    }
    return { byFolder, none }
  }, [items])

  const openNote = (taskId: string) => navigate(`/note/${taskId}`)

  const dropInto = async (taskId: string, folderId: string | null) => {
    const ok = await moveNote(taskId, folderId)
    if (ok) toast.success(`已移到「${folderName(folderId)}」`)
  }

  const handleDeleteFolder = async (mode: 'move' | 'delete') => {
    if (!folderToDelete) return
    setDeleting(true)
    try {
      const ok = await removeFolder(folderToDelete.id, mode)
      if (ok) {
        toast.success(mode === 'delete' ? '已删除文件夹和里面的笔记' : '已删除文件夹，笔记移到未分类')
        if (activeFolder === folderToDelete.id) setActiveFolder(null)
        setFolderToDelete(null)
      }
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteNote = async () => {
    if (!noteToDelete) return
    setDeleting(true)
    try {
      // removeTask 会同时清本地记录和后端文件/截图/向量索引
      await removeTask(noteToDelete.taskId)
      setNoteToDelete(null)
      await fetchLibrary()
    } catch {
      // 请求拦截器已经弹过提示
    } finally {
      setDeleting(false)
    }
  }

  const noteEntries = (item: ShelfItem): MenuEntryOrSeparator[] => [
    { key: 'open', label: '打开', icon: <Eye className="h-4 w-4" />, onSelect: () => openNote(item.taskId) },
    {
      key: 'rename',
      label: '重命名',
      icon: <Pencil className="h-4 w-4" />,
      onSelect: () => setPrompt({ kind: 'renameNote', id: item.taskId, name: item.title }),
    },
    '---',
    {
      key: 'move-none',
      label: `移到${UNCATEGORIZED}`,
      icon: <FolderInput className="h-4 w-4" />,
      disabled: !item.folderId,
      onSelect: () => dropInto(item.taskId, null),
    },
    ...folders
      .filter(folder => folder.id !== item.folderId)
      .map(folder => ({
        key: `move-${folder.id}`,
        label: `移到「${folder.name}」`,
        icon: <FolderInput className="h-4 w-4" />,
        onSelect: () => dropInto(item.taskId, folder.id),
      })),
    '---',
    {
      key: 'delete',
      label: '删除笔记',
      danger: true,
      icon: <Trash2 className="h-4 w-4" />,
      onSelect: () => setNoteToDelete(item),
    },
  ]

  const folderEntries = (folder: LibraryFolder): MenuEntryOrSeparator[] => [
    {
      key: 'open',
      label: '打开',
      icon: <Eye className="h-4 w-4" />,
      onSelect: () => setActiveFolder(folder.id),
    },
    {
      key: 'rename',
      label: '重命名',
      icon: <Pencil className="h-4 w-4" />,
      onSelect: () => setPrompt({ kind: 'renameFolder', id: folder.id, name: folder.name }),
    },
    '---',
    {
      key: 'delete',
      label: '删除文件夹',
      danger: true,
      icon: <Trash2 className="h-4 w-4" />,
      onSelect: () => {
        // 空文件夹没有"笔记怎么办"这个问题，直接删，不弹二次确认
        if (!counts.byFolder.get(folder.id)) {
          removeFolder(folder.id, 'move').then(ok => ok && toast.success('已删除文件夹'))
          if (activeFolder === folder.id) setActiveFolder(null)
          return
        }
        setFolderToDelete(folder)
      },
    },
  ]

  const showFolders = !searching && activeFolder === null
  const totalNotes = items.length
  const deletingCount = folderToDelete ? (counts.byFolder.get(folderToDelete.id) ?? 0) : 0

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-100">
      {/* ── 顶栏 ─────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-white px-4">
        <div className="flex shrink-0 items-center gap-2">
          <img src={logo} alt="logo" className="h-7 w-7 object-contain" />
          <span className="text-lg font-bold text-neutral-800">BiliNote</span>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索全部笔记…"
            className="h-9 pl-8"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="mr-1 flex items-center rounded-md border p-0.5">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="卡片视图"
                    onClick={() => setViewMode('card')}
                    className={`cursor-pointer rounded p-1 ${
                      viewMode === 'card' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-neutral-100'
                    }`}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>卡片视图</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="列表视图"
                    onClick={() => setViewMode('list')}
                    className={`cursor-pointer rounded p-1 ${
                      viewMode === 'list' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-neutral-100'
                    }`}
                  >
                    <List className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>列表视图（信息密度更高）</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <Button size="sm" onClick={() => setNewNoteOpen(true)}>
            <Plus className="h-4 w-4" />
            新建笔记
          </Button>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
                  <Link to="/settings" aria-label="全局配置">
                    <SlidersHorizontal className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>全局配置</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </header>

      {/* ── 文件夹筛选条 ─────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b bg-white px-4 py-2">
        <FilterChip
          label="全部"
          count={totalNotes}
          active={activeFolder === null && !searching}
          onClick={() => setActiveFolder(null)}
        />
        {folders.map(folder => (
          <FilterChip
            key={folder.id}
            label={folder.name}
            count={counts.byFolder.get(folder.id) ?? 0}
            active={activeFolder === folder.id}
            onClick={() => setActiveFolder(folder.id)}
          />
        ))}
        <FilterChip
          label={UNCATEGORIZED}
          count={counts.none}
          active={activeFolder === 'none'}
          onClick={() => setActiveFolder('none')}
        />
        <Button
          variant="ghost"
          size="sm"
          className="ml-1 shrink-0 text-neutral-500"
          onClick={() => setPrompt({ kind: 'newFolder' })}
        >
          <FolderPlus className="h-4 w-4" />
          新建文件夹
        </Button>
        {searching && (
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            搜索「{keyword}」· {visibleItems.length} 条结果（跨全部文件夹）
          </span>
        )}
      </div>

      {/* ── 内容区 ───────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        {showFolders && recent.length > 0 && (
          <div className="mb-4 flex items-center gap-2 text-sm">
            <Clock className="text-muted-foreground h-4 w-4 shrink-0" />
            <span className="text-muted-foreground shrink-0">最近打开</span>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              {recent.map(item => (
                <button
                  key={item.taskId}
                  type="button"
                  onClick={() => openNote(item.taskId)}
                  className="text-primary max-w-[220px] cursor-pointer truncate hover:underline"
                  title={item.title}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {!searching && activeFolder !== null && (
          <h2 className="text-muted-foreground mb-3 text-sm">
            {folderName(activeFolder === 'none' ? null : activeFolder)} · {visibleItems.length} 篇
          </h2>
        )}

        {visibleItems.length === 0 ? (
          <EmptyState
            loading={loading && !loaded}
            searching={searching}
            keyword={keyword}
            hasAnyNote={totalNotes > 0}
            onCreate={() => setNewNoteOpen(true)}
            onCreateFolder={() => setPrompt({ kind: 'newFolder' })}
          />
        ) : viewMode === 'card' ? (
          // 文件夹卡和笔记卡混排在同一个 auto-fill 栅格里（确认过的方案），
          // 共用列宽才能对齐；超宽屏下固定列数会把卡片拉得过大
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {showFolders &&
              folders.map(folder => (
                <FolderCard
                  key={folder.id}
                  name={folder.name}
                  count={counts.byFolder.get(folder.id) ?? 0}
                  active={activeFolder === folder.id}
                  onOpen={() => setActiveFolder(folder.id)}
                  onDropNote={taskId => dropInto(taskId, folder.id)}
                  menuEntries={folderEntries(folder)}
                />
              ))}
            {showFolders && (
              <FolderCard
                name={UNCATEGORIZED}
                count={counts.none}
                virtual
                active={activeFolder === 'none'}
                onOpen={() => setActiveFolder('none')}
                onDropNote={taskId => dropInto(taskId, null)}
                menuEntries={[]}
              />
            )}
            {visibleItems.map(item => (
              <NoteCard
                key={item.taskId}
                item={item}
                folderName={folderName(item.folderId)}
                showFolder={searching || activeFolder === null}
                onOpen={() => openNote(item.taskId)}
                menuEntries={noteEntries(item)}
              />
            ))}
          </div>
        ) : (
          <>
            {showFolders && (
              <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {folders.map(folder => (
                  <FolderCard
                    key={folder.id}
                    name={folder.name}
                    count={counts.byFolder.get(folder.id) ?? 0}
                    active={activeFolder === folder.id}
                    onOpen={() => setActiveFolder(folder.id)}
                    onDropNote={taskId => dropInto(taskId, folder.id)}
                    menuEntries={folderEntries(folder)}
                  />
                ))}
                <FolderCard
                  name={UNCATEGORIZED}
                  count={counts.none}
                  virtual
                  active={activeFolder === 'none'}
                  onOpen={() => setActiveFolder('none')}
                  onDropNote={taskId => dropInto(taskId, null)}
                  menuEntries={[]}
                />
              </div>
            )}
            <div className="mx-auto flex max-w-5xl flex-col gap-2">
              {visibleItems.map(item => (
                <NoteRow
                  key={item.taskId}
                  item={item}
                  folderName={folderName(item.folderId)}
                  showFolder={searching || activeFolder === null}
                  onOpen={() => openNote(item.taskId)}
                  menuEntries={noteEntries(item)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* ── 弹层 ─────────────────────────────────────────── */}
      <NoteFormDialog
        open={newNoteOpen}
        onOpenChange={setNewNoteOpen}
        taskId={null}
        onSubmitted={taskId => {
          fetchLibrary()
          openNote(taskId)
        }}
      />

      <PromptDialog
        open={prompt !== null}
        onOpenChange={open => !open && setPrompt(null)}
        title={
          prompt?.kind === 'newFolder'
            ? '新建文件夹'
            : prompt?.kind === 'renameFolder'
              ? '重命名文件夹'
              : '重命名笔记'
        }
        description={
          prompt?.kind === 'renameNote'
            ? '只有你自己看得到这个别名，视频原标题会保留。清空则恢复用视频标题。'
            : prompt?.kind === 'renameFolder'
              ? '改名不影响里面的笔记。'
              : '文件夹用来收纳笔记，之后可以随时重命名或删除。'
        }
        label={prompt?.kind === 'renameNote' ? '别名' : '名称'}
        initialValue={prompt && prompt.kind !== 'newFolder' ? prompt.name : ''}
        placeholder={prompt?.kind === 'renameNote' ? '例如：数量关系专项' : '例如：行测'}
        confirmLabel={prompt?.kind === 'newFolder' ? '创建' : '保存'}
        onConfirm={async value => {
          if (!prompt) return false
          if (prompt.kind === 'newFolder') return addFolder(value)
          if (prompt.kind === 'renameFolder') return renameFolder(prompt.id, value)
          return renameNote(prompt.id, value)
        }}
      />

      <Dialog open={!!folderToDelete} onOpenChange={open => !open && setFolderToDelete(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>删除「{folderToDelete?.name}」？</DialogTitle>
            <DialogDescription>
              里面有 {deletingCount} 篇笔记。你可以只删掉文件夹（笔记回到未分类），
              或者连笔记一起删——后者会同时清掉后端保存的笔记文件和截图，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:flex-col sm:items-stretch">
            <Button variant="outline" onClick={() => handleDeleteFolder('move')} disabled={deleting}>
              只删文件夹，笔记移到{UNCATEGORIZED}
            </Button>
            <Button variant="destructive" onClick={() => handleDeleteFolder('delete')} disabled={deleting}>
              连 {deletingCount} 篇笔记一起删除
            </Button>
            <Button variant="ghost" onClick={() => setFolderToDelete(null)} disabled={deleting}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!noteToDelete} onOpenChange={open => !open && setNoteToDelete(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>删除这篇笔记？</DialogTitle>
            <DialogDescription>
              「{noteToDelete?.title}」将被永久删除：后端保存的笔记文件、这篇引用的截图、
              AI 问答索引，以及浏览器里的版本历史都会一起清掉，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNoteToDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteNote} disabled={deleting}>
              {deleting ? '删除中…' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
        active
          ? 'border-primary bg-primary text-white'
          : 'bg-white text-neutral-700 hover:border-neutral-400'
      }`}
    >
      {label}
      <span className={active ? 'text-white/80' : 'text-neutral-400'}>{count}</span>
    </button>
  )
}

function EmptyState({
  loading,
  searching,
  keyword,
  hasAnyNote,
  onCreate,
  onCreateFolder,
}: {
  loading: boolean
  searching: boolean
  keyword: string
  hasAnyNote: boolean
  onCreate: () => void
  onCreateFolder: () => void
}) {
  if (loading) {
    return <p className="text-muted-foreground py-20 text-center text-sm">正在读取笔记库…</p>
  }
  if (searching) {
    return (
      <p className="text-muted-foreground py-20 text-center text-sm">
        没有匹配「{keyword}」的笔记
      </p>
    )
  }
  if (hasAnyNote) {
    return (
      <div className="text-muted-foreground py-16 text-center text-sm">
        这里还没有笔记。把卡片拖进来归档，或者
        <button type="button" onClick={onCreate} className="text-primary mx-1 cursor-pointer underline">
          新建一篇
        </button>
        。
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="text-lg font-medium text-neutral-700">还没有笔记</p>
      <p className="text-muted-foreground max-w-md text-sm">
        粘贴 B 站 / YouTube / 抖音等视频链接，选一个笔记风格，AI 会把它整理成带目录、
        可跳转原片、带板书截图的学习笔记。
      </p>
      <div className="flex gap-2">
        <Button onClick={onCreate}>
          <Plus className="h-4 w-4" />
          新建笔记
        </Button>
        <Button variant="outline" onClick={onCreateFolder}>
          <FolderPlus className="h-4 w-4" />
          新建文件夹
        </Button>
      </div>
    </div>
  )
}

export default LibraryPage
