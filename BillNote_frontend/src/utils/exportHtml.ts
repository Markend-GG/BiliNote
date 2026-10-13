/**
 * 把当前渲染好的笔记导出成单个离线 HTML：样式内联、图片转 base64。
 *
 * 直接序列化渲染后的 DOM 而不是重新跑一遍 markdown 管线：所见即所得，
 * 公式/表格/折叠结构都是浏览器里已经排好的样子。
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

export async function exportNoteAsHtml(bodyEl: HTMLElement | null, title: string) {
  if (!bodyEl) return
  const clone = bodyEl.cloneNode(true) as HTMLElement

  // 截图和封面走的是后端代理/静态目录，离线打开会 404，全部内联成 dataURL
  const imgs = [...clone.querySelectorAll('img')]
  await Promise.all(
    imgs.map(async img => {
      const src = img.getAttribute('src') || ''
      if (!src || src.startsWith('data:')) return
      try {
        const blob = await (await fetch(src)).blob()
        img.setAttribute('src', await toDataUrl(blob))
      } catch {
        // 拉不到（比如外链封面防盗链）就保留原地址，不影响导出
      }
    }),
  )

  // 页面现有的样式表（github-markdown-css / katex）直接内联，保证离线排版一致
  const cssTexts = await Promise.all(
    [...document.querySelectorAll('link[rel="stylesheet"]')].map(async link => {
      try {
        return await (await fetch((link as HTMLLinkElement).href)).text()
      } catch {
        return ''
      }
    }),
  )

  const html =
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>${cssTexts.join('\n')}</style>` +
    `<style>body{margin:0;background:#fff}.markdown-body{max-width:860px;margin:0 auto;padding:32px 16px}</style>` +
    `</head><body><div class="markdown-body">${clone.innerHTML}</div></body></html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title || 'note'}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
