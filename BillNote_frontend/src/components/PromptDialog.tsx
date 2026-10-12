import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface PromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  label: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  /** 允许提交空值（重命名笔记时清空 = 恢复用视频标题） */
  allowEmpty?: boolean
  /** 返回 false 表示失败，对话框不关闭（错误 toast 由请求拦截器负责） */
  onConfirm: (value: string) => Promise<boolean> | boolean
}

/** 新建文件夹 / 重命名文件夹 / 重命名笔记共用的单行输入对话框 */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue = '',
  placeholder,
  confirmLabel = '确定',
  allowEmpty = false,
  onConfirm,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)

  // 每次打开都重置成传入的初始值，否则会留着上一次编辑的内容
  useEffect(() => {
    if (open) {
      setValue(initialValue)
      setBusy(false)
    }
  }, [open, initialValue])

  const submit = async () => {
    const trimmed = value.trim()
    if (busy || (!trimmed && !allowEmpty)) return
    setBusy(true)
    try {
      const ok = await onConfirm(trimmed)
      if (ok) onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="prompt-input">{label}</Label>
          <Input
            id="prompt-input"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={(!value.trim() && !allowEmpty) || busy}>
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PromptDialog
