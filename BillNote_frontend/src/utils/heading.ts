/**
 * 目录链接与章节导航共用的跳转逻辑。
 *
 * LLM 生成的目录锚点可能和标题实际文本不完全一致（例如标题带 *Content-[00:00]* 后缀、
 * 目录链接里没有），所以精确 id 失败后要按文本模糊匹配；目标还可能藏在折叠起来的章节里，
 * 不先展开祖先滚过去就是一片空白。
 */
export function scrollToHeading(id: string): boolean {
  let target: HTMLElement | null = document.getElementById(id)

  if (!target) {
    const normalize = (s: string) => s.replace(/[-：:\s*\[\]]/g, '').toLowerCase()
    const search = normalize(id)
    for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const text = heading.textContent || ''
      if (normalize(text).includes(search) || search.includes(normalize(text))) {
        target = heading as HTMLElement
        break
      }
    }
  }

  if (!target) return false

  for (
    let section = target.closest('.md-section');
    section;
    section = section.parentElement?.closest('.md-section') || null
  ) {
    section.classList.remove('md-collapsed')
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}
