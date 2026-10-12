'use client'

import { useEffect, useState } from 'react'
import { Copy, Download, BrainCircuit, MessageSquare, Pencil, ChevronsDownUp, ChevronsUpDown, Trash2 } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'

interface VersionNote {
  ver_id: string
  model_name?: string
  style?: string
  created_at?: string
}

interface NoteHeaderProps {
  currentTask?: {
    markdown: VersionNote[] | string
  }
  isMultiVersion: boolean
  currentVerId: string
  setCurrentVerId: (id: string) => void
  modelName: string
  style: string
  noteStyles: { value: string; label: string }[]
  onCopy: () => void
  onDownload: () => void
  createAt?: string | Date
  setShowTranscribe: (show: boolean) => void
  showChat?: false | 'half' | 'full'
  setShowChat?: (mode: false | 'half' | 'full') => void
  onEdit?: () => void
  editing?: boolean
  /** 一键收起/展开全部章节（折叠状态在 MarkdownViewer 里用 DOM class 维护） */
  foldAll?: boolean
  onFoldAll?: () => void
  /** 删除当前选中的版本（版本历史只存在浏览器本地） */
  onDeleteVersion?: () => void
  canDeleteVersion?: boolean
}

export function MarkdownHeader({
  currentTask,
  isMultiVersion,
  currentVerId,
  setCurrentVerId,
  modelName,
  style,
  noteStyles,
  onCopy,
  onDownload,
  createAt,
  showTranscribe,
  setShowTranscribe,
  showChat,
  setShowChat,
  viewMode,
  setViewMode,
  onEdit,
  editing,
  foldAll,
  onFoldAll,
  onDeleteVersion,
  canDeleteVersion,
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

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return ''
    const d = typeof date === 'string' ? new Date(date) : date
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

  // 版本按时间倒序排好，最新的在第 0 位
  const versions: VersionNote[] = Array.isArray(currentTask?.markdown)
    ? [...currentTask!.markdown].sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
      )
    : []

  // 版本号按时间正序编号：最早那版是 V1，最新那版是 V{n}
  const versionLabel = (index: number) => {
    const no = versions.length - index
    const time = formatDate(versions[index]?.created_at).slice(5) // 去年份，下拉框放不下
    const head = index === 0 ? `V${no}（最新）` : `V${no}`
    return time ? `${head} · ${time}` : head
  }

  const currentVersionIndex = versions.findIndex(v => v.ver_id === currentVerId)

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-4 py-2 backdrop-blur-sm">
      {/* 左侧区域：版本 + 标签 + 创建时间 */}
      <div className="flex flex-wrap items-center gap-3">
        {isMultiVersion && (
          <Select value={currentVerId} onValueChange={setCurrentVerId}>
            <SelectTrigger className="h-8 w-[210px] text-sm">
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

        {isMultiVersion && onDeleteVersion && (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-500 hover:bg-red-50 hover:text-red-600"
                    disabled={!canDeleteVersion}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {canDeleteVersion ? '删除当前选中的版本' : '只剩一个版本，不能删'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

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
                      onDeleteVersion()
                    }}
                  >
                    删除
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}

        <Badge variant="secondary" className="bg-pink-100 text-pink-700 hover:bg-pink-200">
          {modelName}
        </Badge>
        <Badge variant="secondary" className="bg-cyan-100 text-cyan-700 hover:bg-cyan-200">
          {styleName}
        </Badge>

        {createAt && (
          <div className="text-muted-foreground text-sm">创建时间: {formatDate(createAt)}</div>
        )}
      </div>

      {/* 右侧操作按钮 */}
      <div className="flex items-center gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  setViewMode(viewMode == 'preview' ? 'map' : 'preview')
                }}
                variant="ghost"
                size="sm"
                className="h-8 px-2"
              >
                <BrainCircuit className="mr-1.5 h-4 w-4" />
                <span className="text-sm">{viewMode == 'preview' ? '思维导图' : 'markdown'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>思维导图</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {onFoldAll && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={onFoldAll} variant="ghost" size="sm" className="h-8 px-2">
                  {foldAll ? (
                    <ChevronsUpDown className="mr-1.5 h-4 w-4" />
                  ) : (
                    <ChevronsDownUp className="mr-1.5 h-4 w-4" />
                  )}
                  <span className="text-sm">{foldAll ? '展开全部' : '收起全部'}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>一键收起/展开所有章节，方便快速定位</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={handleCopy} variant="ghost" size="sm" className="h-8 px-2">
                <Copy className="mr-1.5 h-4 w-4" />
                <span className="text-sm">{copied ? '已复制' : '复制'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>复制内容</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onDownload} variant="ghost" size="sm" className="h-8 px-2">
                <Download className="mr-1.5 h-4 w-4" />
                <span className="text-sm">导出 Markdown</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>下载为 Markdown 文件</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {onEdit && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onEdit}
                  variant={editing ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2"
                  disabled={editing}
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  <span className="text-sm">{editing ? '编辑中' : '编辑'}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>编辑笔记内容（可删除重复的图片行）</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  setShowTranscribe(!showTranscribe)
                }}
                variant="ghost"
                size="sm"
                className="h-8 px-2"
              >
                {/*<Download className="mr-1.5 h-4 w-4" />*/}
                <span className="text-sm">原文参照</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>原文参照</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {setShowChat && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setShowChat(showChat ? false : 'half')}
                  variant={showChat ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2"
                >
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  <span className="text-sm">AI 问答</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>基于笔记内容的 AI 问答</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
}