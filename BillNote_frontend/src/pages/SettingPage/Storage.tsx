import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, RefreshCw, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  deleteOrphans,
  getCleanupStatus,
  runCleanup,
  saveCleanupPolicy,
  scanStorage,
  type CleanupPolicy,
  type CleanupStatus,
  type StorageScan,
} from '@/services/storage'
import { formatDate } from '@/pages/LibraryPage/utils'

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B'
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

/**
 * 设置 → 存储与清理。
 *
 * 截图目录是全局扁平的，历史原因攒下大量没有任何笔记引用的孤儿文件；
 * 这里把"扫出来 → 人眼过一遍 → 确认删除"做成产品功能，删除前服务端还会再校验一次引用。
 */
const StoragePage = () => {
  const [scan, setScan] = useState<StorageScan | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(false)
  const [cleanup, setCleanup] = useState<CleanupStatus | null>(null)
  // 表单用草稿态：改了数字还没保存时，不该让界面上的"当前策略"跟着变
  const [draft, setDraft] = useState<CleanupPolicy>({
    enabled: true,
    keep_days: 14,
    max_orphan_mb: 800,
  })
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [running, setRunning] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [data, status] = await Promise.all([scanStorage(), getCleanupStatus()])
      setScan(data)
      setCleanup(status)
      setDraft(status.policy)
      setSelected(new Set())
      setError(false)
    } catch {
      // 拦截器已经弹过 toast；这里留个错误态，页面才有"重试"入口而不是一片空白
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleSavePolicy = async () => {
    setSavingPolicy(true)
    try {
      const policy = await saveCleanupPolicy(draft)
      setCleanup(prev => (prev ? { ...prev, policy } : prev))
      toast.success('自动清理设置已保存')
    } catch {
      // 拦截器已提示
    } finally {
      setSavingPolicy(false)
    }
  }

  const handleRunNow = async () => {
    setRunning(true)
    try {
      const res = await runCleanup()
      toast.success(
        res.deleted
          ? `已清理 ${res.deleted} 张孤儿截图，释放 ${formatBytes(res.freed_bytes)}`
          : '没有需要清理的孤儿截图',
      )
      await refresh()
    } catch {
      // 拦截器已提示
    } finally {
      setRunning(false)
    }
  }

  const orphans = useMemo(() => scan?.orphans ?? [], [scan])
  const allSelected = orphans.length > 0 && selected.size === orphans.length

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleDelete = async () => {
    const names = [...selected]
    if (!names.length) return
    setDeleting(true)
    try {
      const res = await deleteOrphans(names)
      toast.success(
        res.skipped.length
          ? `已删除 ${res.deleted.length} 张，${res.skipped.length} 张因已被笔记引用而跳过`
          : `已删除 ${res.deleted.length} 张孤儿截图`,
      )
      setConfirmOpen(false)
      await refresh()
    } catch {
      // 拦截器已提示
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-medium">存储与清理</div>
          <div className="text-muted-foreground text-xs">
            截图、笔记文件与向量索引的占用情况；孤儿截图 = 没有任何笔记引用的文件
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          重新扫描
        </Button>
      </div>

      {!scan && error && (
        <div className="text-muted-foreground rounded-lg border bg-white p-6 text-center text-sm">
          扫描失败，后端可能没起来。
          <button
            type="button"
            onClick={refresh}
            className="text-primary ml-1 cursor-pointer underline"
          >
            重试
          </button>
        </div>
      )}

      {scan && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-white p-3">
              <div className="text-muted-foreground text-xs">截图目录</div>
              <div className="mt-1 text-xl font-semibold">{formatBytes(scan.screenshots.bytes)}</div>
              <div className="text-muted-foreground mt-1 text-xs">
                {scan.screenshots.count} 张，其中孤儿 {scan.screenshots.orphan_count} 张 /{' '}
                {formatBytes(scan.screenshots.orphan_bytes)}
              </div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-muted-foreground text-xs">笔记文件</div>
              <div className="mt-1 text-xl font-semibold">{formatBytes(scan.note_results_bytes)}</div>
              <div className="text-muted-foreground mt-1 text-xs">正文 / 转写 / 音频缓存</div>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <div className="text-muted-foreground text-xs">AI 问答向量索引</div>
              <div className="mt-1 text-xl font-semibold">{formatBytes(scan.vector_db_bytes)}</div>
              <div className="text-muted-foreground mt-1 text-xs">删除笔记时会自动清理对应索引</div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-neutral-500" />
              <span className="text-sm font-medium">自动清理孤儿截图</span>
              <span className="text-muted-foreground text-xs">后台每天检查一次</span>
              <Switch
                className="ml-auto"
                checked={draft.enabled}
                onCheckedChange={enabled => setDraft(d => ({ ...d, enabled }))}
                aria-label="启用自动清理"
              />
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
              只清理<b className="text-neutral-700">没有任何笔记引用</b>的截图。笔记里正在用的图既不计入容量、
              也永远不会被删；生成中的笔记有 30 分钟保护期。填 0 表示关掉对应那条规则。
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">孤儿超过</span>
                <Input
                  type="number"
                  min={0}
                  value={draft.keep_days}
                  onChange={e => setDraft(d => ({ ...d, keep_days: Number(e.target.value) || 0 }))}
                  className="h-7 w-16 text-xs"
                  aria-label="保留天数"
                />
                <span className="text-muted-foreground">天自动删</span>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-muted-foreground">孤儿总量超过</span>
                <Input
                  type="number"
                  min={0}
                  value={draft.max_orphan_mb}
                  onChange={e => setDraft(d => ({ ...d, max_orphan_mb: Number(e.target.value) || 0 }))}
                  className="h-7 w-20 text-xs"
                  aria-label="孤儿总量上限 MB"
                />
                <span className="text-muted-foreground">MB 时从最旧的开始删</span>
              </label>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSavePolicy} disabled={savingPolicy}>
                  {savingPolicy ? '保存中…' : '保存设置'}
                </Button>
                <Button variant="outline" size="sm" onClick={handleRunNow} disabled={running}>
                  {running ? '清理中…' : '立即清理一次'}
                </Button>
              </div>
            </div>
            {cleanup?.last_run && (
              <div className="text-muted-foreground mt-2.5 border-t pt-2 text-xs">
                上次清理：{formatDate(cleanup.last_run.at)}
                （{cleanup.last_run.reason === 'manual' ? '手动' : '定时'}）· 删除{' '}
                {cleanup.last_run.deleted} 张（超期 {cleanup.last_run.aged_deleted} / 超容量{' '}
                {cleanup.last_run.over_cap_deleted}）· 释放{' '}
                {formatBytes(cleanup.last_run.freed_bytes)} · 剩余孤儿{' '}
                {cleanup.last_run.remaining_orphans} 张 /{' '}
                {formatBytes(cleanup.last_run.remaining_orphan_bytes)}
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-white">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={checked =>
                    setSelected(checked ? new Set(orphans.map(o => o.name)) : new Set())
                  }
                  aria-label="全选孤儿截图"
                />
                <span className="text-sm font-medium">
                  孤儿截图（{orphans.length}）
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                disabled={!selected.size || deleting}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                删除选中（{selected.size}）
              </Button>
            </div>
            {orphans.length === 0 ? (
              <p className="text-muted-foreground px-3 py-8 text-center text-sm">
                没有孤儿截图，磁盘很干净
              </p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                {orphans.map(o => (
                  <label
                    key={o.name}
                    className="hover:bg-neutral-50 flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
                  >
                    <Checkbox checked={selected.has(o.name)} onCheckedChange={() => toggle(o.name)} />
                    <span className="min-w-0 flex-1 truncate font-mono" title={o.name}>
                      {o.name}
                    </span>
                    <span className="text-muted-foreground w-20 shrink-0 text-right">
                      {formatBytes(o.size)}
                    </span>
                    <span className="text-muted-foreground w-32 shrink-0 text-right">
                      {formatDate(o.mtime)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={open => !deleting && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>删除 {selected.size} 张孤儿截图？</DialogTitle>
            <DialogDescription>
              这些文件没有被任何笔记引用，删除后释放约{' '}
              {formatBytes(orphans.filter(o => selected.has(o.name)).reduce((s, o) => s + o.size, 0))}。
              服务端删除前会再校验一次引用，万一期间被新笔记引用会自动跳过。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? '删除中…' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default StoragePage
