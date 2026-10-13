'use client'

import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Download,
  FileText,
  Folder,
  MessageSquare,
  FileCode2,
  MoreHorizontal,
  Pencil,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Menu, type MenuEntryOrSeparator } from '@/components/ui/menu'
import type { NoteVersion } from '@/services/library'

export interface NoteSibling {
  taskId: string
  title: string
  active: boolean
}

interface NoteHeaderProps {
  /** 版本历史（新在前），权威存储在后端 note_versions 表 */
  versions: NoteVersion[]
  isMultiVersion: boolean
  currentVerId: string
  setCurrentVerId: (id: string) => void
  modelName: string
  style: string
  noteStyles: { value: string; label: string }[]
  createAt?: string | Date

  /** 视图与参照 dock */
  viewMode: 'map' | 'preview'
  setViewMode: (mode: 'map' | 'preview') => void
  dockTab: 'transcript' | 'chat' | null
  onDockTab: (tab: 'transcript' | 'chat' | null) => void

  /** 动作 */
  onCopy: () => void
  onDownload: () => void
  onEdit?: () => void
  editing?: boolean
  foldAll?: boolean
  onFoldAll?: () => void
  onDeleteVersion?: () => void
  canDeleteVersion?: boolean
  onRegenerate?: () => void
  onExportHtml?: () => void
  onPrint?: () => void

  /** 两级导航：返回书架、所在文件夹、同文件夹的其他笔记 */
  title: string
  onBack: () => void
  folderName?: string
  onOpenFolder?: () => void
  siblings?: NoteSibling[]
  onSwitchNote?: (taskId: string) => void
  onBackToShelf?: () => void
  /** 「⋯」菜单尾部的笔记级操作（重命名 / 移动 / 删除 / 设置），由 useNoteActions 提供 */
  noteEntries?: MenuEntryOrSeparator[]
}

/**
 * 详情页顶栏。
 *
 * 改造前这里平铺了 10 个按钮 + 3 个徽章 + 创建时间，挤成两行。现在一级只留高频动作
 * （返回、切换笔记、版本、重新生成、原文参照、AI 问答），其余收进「⋯」；
 * 模型名 / 风格 / 创建时间改成「⋯」菜单顶部的只读信息，不再常驻占宽度。
 */
export function MarkdownHeader({
  versions,
  isMultiVersion,
  currentVerId,
  setCurrentVerId,
  modelName,
  style,
  noteStyles,
  createAt,
  viewMode,
  setViewMode,
  dockTab,
  onDockTab,
  onCopy,
  onDownload,
  onEdit,
  editing,
  foldAll,
  onFoldAll,
  onDeleteVersion,
  canDeleteVersion,
  onRegenerate,
  onExportHtml,
  onPrint,
  title,
  onBack,
  folderName,
  onOpenFolder,
  siblings,
  onSwitchNote,
  onBackToShelf,
  noteEntries,
}: NoteHeaderProps) {
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (copied) {
      timer = setTimeout(() => setCopied(false), 2000)
    }
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = () => {
    onCopy()
    setCopied(true)
  }

  const styleName = noteStyles.find(v => v.value === style)?.label || style

  const formatDate = (date: string | Date | number | undefined | null) => {
    if (!date) return ''
    const d = typeof date === 'number' ? new Date(date) : typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return ''
    return d
      .toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(/\//g, '-')
  }

  // versions 由后端按新在前返回，这里不再排序

  // 版本号按时间正序编号：最早那版是 V1，最新那版是 V{n}
  const versionLabel = (index: number) => {
    const no = versions.length - index
    const time = formatDate(versions[index]?.created_at).slice(5) // 去年份，下拉框放不下
    const head = index === 0 ? `V${no}（最新）` : `V${no}`
    return time ? `${head} · ${time}` : head
  }

  const currentVersionIndex = versions.findIndex(v => v.ver_id === currentVerId)

  // 换笔记不用退回书架：标题本身就是下拉，列出同文件夹的笔记 + 最近打开的
  const canSwitch = (siblings?.length ?? 0) > 1
  const switchEntries: MenuEntryOrSeparator[] = [
    ...(siblings ?? []).map(sibling => ({
      key: sibling.taskId,
      label: <span className="block max-w-[280px] truncate">{sibling.title}</span>,
      icon: sibling.active ? <Check className="text-primary h-4 w-4" /> : <FileText className="h-4 w-4" />,
      disabled: sibling.active,
      onSelect: () => onSwitchNote?.(sibling.taskId),
    })),
    '---',
    {
      key: 'back-to-shelf',
      label: '回到书架',
      icon: <Folder className="h-4 w-4" />,
      onSelect: () => (onBackToShelf ?? onBack)(),
    },
  ]

  const moreEntries: MenuEntryOrSeparator[] = [
    ...(onEdit
      ? [
          {
            key: 'edit',
            label: editing ? '正在编辑…' : '编辑笔记',
            icon: <Pencil className="h-4 w-4" />,
            disabled: editing,
            onSelect: onEdit,
          },
        ]
      : []),
    {
      key: 'copy',
      label: copied ? '已复制' : '复制内容',
      icon: <Copy className="h-4 w-4" />,
      onSelect: handleCopy,
    },
    {
      key: 'download',
      label: '导出 Markdown',
      icon: <Download className="h-4 w-4" />,
      onSelect: onDownload,
    },
    ...(onExportHtml
      ? [
          {
            key: 'download-html',
            label: '导出 HTML（离线单文件）',
            icon: <FileCode2 className="h-4 w-4" />,
            onSelect: onExportHtml,
          },
        ]
      : []),
    ...(onPrint
      ? [
          {
            key: 'print',
            label: '打印 / 存为 PDF',
            icon: <Printer className="h-4 w-4" />,
            onSelect: onPrint,
          },
        ]
      : []),
    {
      key: 'mindmap',
      label: viewMode === 'map' ? '返回笔记视图' : '思维导图',
      icon: <BrainCircuit className="h-4 w-4" />,
      onSelect: () => setViewMode(viewMode === 'map' ? 'preview' : 'map'),
    },
    ...(onFoldAll && viewMode === 'preview'
      ? [
          {
            key: 'fold',
            label: foldAll ? '展开全部章节' : '收起全部章节',
            icon: foldAll ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />,
            onSelect: onFoldAll,
          },
        ]
      : []),
    ...(onDeleteVersion
      ? [
          '---' as const,
          {
            key: 'delete-version',
            label: '删除当前版本',
            icon: <Trash2 className="h-4 w-4" />,
            danger: true,
            disabled: !canDeleteVersion,
            onSelect: () => setConfirmDelete(true),
          },
        ]
      : []),
    ...(noteEntries?.length ? (['---' as const, ...noteEntries] as MenuEntryOrSeparator[]) : []),
  ]

  return (
    <div className="sticky top-0 z-20 flex items-center gap-1.5 border-b bg-white/95 px-3 py-2 backdrop-blur-sm print:hidden">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onBack}
              aria-label="返回书架"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>返回书架</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {folderName && (
        <button
          type="button"
          onClick={onOpenFolder}
          className="text-muted-foreground hover:text-primary flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-neutral-100"
          title={`所在文件夹：${folderName}`}
        >
          <Folder className="h-3.5 w-3.5" />
          <span className="max-w-[120px] truncate">{folderName}</span>
        </button>
      )}

      <span className="text-muted-foreground shrink-0">/</span>

      {canSwitch ? (
        <Menu
          align="start"
          className="min-w-0 flex-1"
          triggerClassName="flex w-full min-w-0 items-center gap-1 rounded px-2 py-1 text-sm font-medium hover:bg-neutral-100"
          ariaLabel="切换到其他笔记"
          trigger={
            <>
              <span className="truncate">{title}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
            </>
          }
          entries={switchEntries}
        />
      ) : (
        <div className="min-w-0 flex-1 truncate px-2 text-sm font-medium" title={title}>
          {title}
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {isMultiVersion && (
          <Select value={currentVerId} onValueChange={setCurrentVerId}>
            <SelectTrigger className="h-8 w-[190px] text-sm">
              <div className="flex items-center">
                {currentVersionIndex === -1 ? '' : versionLabel(currentVersionIndex)}
              </div>
            </SelectTrigger>
            <SelectContent>
              {versions.map((v, idx) => (
                <SelectItem key={v.ver_id} value={v.ver_id}>
                  {versionLabel(idx)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isMultiVersion && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-neutral-500 hover:bg-red-50 hover:text-red-600 h-8 w-8"
                  disabled={!canDeleteVersion}
                  onClick={() => setConfirmDelete(true)}
                  aria-label="删除当前版本"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canDeleteVersion ? '删除当前选中的版本' : '只剩一个版本，不能删'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {onRegenerate && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="h-8" onClick={onRegenerate}>
                  <RefreshCw className="h-4 w-4" />
                  重新生成
                </Button>
              </TooltipTrigger>
              <TooltipContent>用原来的链接重新生成，可以先改风格和模型；结果会作为新版本追加</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={dockTab === 'transcript' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => onDockTab(dockTab === 'transcript' ? null : 'transcript')}
              >
                <FileText className="h-4 w-4" />
                原文参照
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {dockTab === 'transcript' ? '再点一次关闭' : '在右侧打开视频转写原文'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={dockTab === 'chat' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => onDockTab(dockTab === 'chat' ? null : 'chat')}
              >
                <MessageSquare className="h-4 w-4" />
                AI 问答
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {dockTab === 'chat' ? '再点一次关闭' : '基于这篇笔记内容提问'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Menu
          trigger={<MoreHorizontal className="h-4 w-4" />}
          entries={moreEntries}
          ariaLabel="更多操作"
          info={
            <div className="space-y-0.5">
              <div>风格：{styleName || '—'}</div>
              <div>模型：{modelName || '—'}</div>
              {createAt && <div>创建：{formatDate(createAt)}</div>}
              {versions.length > 0 && <div>版本数：{versions.length}</div>}
            </div>
          }
        />
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除这个版本？</DialogTitle>
            <DialogDescription>
              {currentVersionIndex === -1 ? '当前版本' : versionLabel(currentVersionIndex)}
              　将被永久删除。版本历史只保存在本机浏览器里，删掉无法恢复（后端始终留着最新一次生成的内容）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmDelete(false)
                onDeleteVersion?.()
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
