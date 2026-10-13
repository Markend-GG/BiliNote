import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface EditPaneProps {
  draft: string
  onDraftChange: React.Dispatch<React.SetStateAction<string>>
  saving: boolean
  baseURL: string
  onCancel: () => void
  onSave: () => void
}

/** Markdown 编辑面板：草稿 + 图片缩略图管理（重复图片的缩略图完全相同，点 × 删该处引用） */
export function EditPane({ draft, onDraftChange, saving, baseURL, onCancel, onSave }: EditPaneProps) {
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
    onDraftChange(prev => {
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

  return (
        <div className="flex flex-1 flex-col overflow-hidden bg-white px-3 py-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-sm">
              编辑 Markdown：可在下方缩略图里点 × 删除图片，或直接修改文字，保存后生成新版本
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onCancel()} disabled={saving}>
                取消
              </Button>
              <Button size="sm" onClick={onSave} disabled={saving}>
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
            onChange={e => onDraftChange(e.target.value)}
            spellCheck={false}
            className="min-h-0 w-full flex-1 resize-none rounded-md border p-3 font-mono text-sm leading-6 focus:outline-none"
          />
        </div>
  )
}
