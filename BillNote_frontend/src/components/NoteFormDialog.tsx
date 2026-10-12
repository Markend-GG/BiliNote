import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import NoteForm from '@/pages/NotePage/components/NoteForm'

interface NoteFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 新建；传 task_id = 用那篇的参数重新生成 */
  taskId?: string | null
  onSubmitted?: (taskId: string) => void
}

/**
 * 新建 / 重新生成共用的对话框。
 *
 * 表单以前是常驻左侧栏的一块（占掉 23% 宽度），但一天用不了几次；改成按需弹出的模态框，
 * 正文才拿得到宽度。表单本身（校验、防重复提交、阶段提示）一点没动。
 */
export function NoteFormDialog({ open, onOpenChange, taskId = null, onSubmitted }: NoteFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[88vh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle>{taskId ? '重新生成笔记' : '新建笔记'}</DialogTitle>
          <DialogDescription>
            {taskId
              ? '沿用原来的视频链接，可以改模型、风格和笔记格式。生成结果会作为新版本追加，旧版本仍然可以在版本下拉里查看。'
              : '粘贴视频链接，选择模型和笔记风格。长视频要抽帧并分批送给模型，可能需要几分钟。'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 py-4">
          {/* 关掉就卸载：表单里有上传状态等本地 state，每次打开都该是干净的 */}
          {open && (
            <NoteForm
              taskId={taskId}
              onSubmitted={id => {
                onOpenChange(false)
                onSubmitted?.(id)
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default NoteFormDialog
