import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { deleteOrphans, scanStorage, type StorageScan } from '@/services/storage'
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await scanStorage()
      setScan(data)
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

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
