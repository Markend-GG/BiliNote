import { loadCSS, loadJS } from 'markmap-common'
import { Transformer } from 'markmap-lib'
import * as markmap from 'markmap-view'
import * as katex from 'katex'

// markmap 浏览器版的公式渲染依赖 window.katex：没有它时会去 jsdelivr CDN
// 异步加载 katex（国内基本加载失败），期间公式会显示为原始 LaTeX 源码。
// 应用本身已打包了 katex（rehype-katex 同款依赖），直接挂到 window 即可让
// 思维导图同步渲染公式。
;(window as any).katex = katex

export const transformer = new Transformer()
const { scripts, styles } = transformer.getAssets()
loadCSS(styles ?? [])
loadJS(scripts ?? [], { getMarkmap: () => markmap })