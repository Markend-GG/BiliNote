/**
 * 把笔记按标题包成可折叠的 section（rehype/hast 层插件）。
 *
 * 每个 h1~h4 连同它下面「直到下一个同级或更高级标题之前」的内容，被包成：
 *   <div class="md-section" data-level="N">
 *     <div class="md-section-head"><button class="md-fold-toggle"/><hN id="…">标题</hN></div>
 *     <div class="md-section-body">…该节内容（可嵌套子 section）…</div>
 *   </div>
 *
 * 为什么在 hast 层做：
 * - react-markdown 把 root 的 children 渲染成扁平兄弟节点，自定义 components.h2 拿不到「后面的内容」
 * - 渲染完再用 useEffect 改 DOM 会和 React 的 reconciliation 打架，还会让图片 Zoom 的定位错位
 * 必须排在 rehypeSlug 之后，标题上已生成的 id 要原样保留（目录锚点跳转依赖它）。
 */

const MAX_FOLD_LEVEL = 4
const HEADING_RE = /^h([1-6])$/
// 与后端 app/utils/markdown_toc.py 的 TOC_TITLES 保持一致：目录本身不折叠
const TOC_TITLES = ['目录', '大纲', 'contents', 'table of contents', 'toc']

type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  value?: string
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value || ''
  return (node.children || []).map(textOf).join('')
}

function isTocHeading(node: HastNode): boolean {
  const text = textOf(node).trim().toLowerCase()
  return TOC_TITLES.includes(text) || text.startsWith('目录')
}

function makeToggle(level: number): HastNode {
  return {
    type: 'element',
    tagName: 'button',
    properties: {
      className: ['md-fold-toggle'],
      type: 'button',
      ariaExpanded: true,
      ariaLabel: '展开或收起本节',
      dataLevel: level,
    },
    children: [],
  }
}

export default function rehypeFold() {
  return (tree: { children: HastNode[] }) => {
    const stack: { body: HastNode; level: number }[] = []
    const out: HastNode[] = []

    const place = (node: HastNode) => {
      if (stack.length) stack[stack.length - 1].body.children!.push(node)
      else out.push(node)
    }

    for (const node of tree.children) {
      const match = node.type === 'element' && node.tagName ? HEADING_RE.exec(node.tagName) : null
      if (!match) {
        place(node)
        continue
      }

      const level = Number(match[1])
      // h5/h6 和「目录」章节不折叠，当普通内容留在当前层
      if (level > MAX_FOLD_LEVEL || isTocHeading(node)) {
        place(node)
        continue
      }

      // 关掉所有层级不比它浅的 section，这样同级标题会并列、子标题会嵌进去
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()

      const body: HastNode = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['md-section-body'] },
        children: [],
      }
      const head: HastNode = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['md-section-head'] },
        children: [makeToggle(level), node],
      }
      const section: HastNode = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['md-section'], dataLevel: level },
        children: [head, body],
      }
      place(section)
      stack.push({ body, level })
    }

    tree.children = out
  }
}
