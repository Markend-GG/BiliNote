/**
 * 把 \[...\] / \(...\) 形式的公式归一化为 $ / $$ 分隔符。
 * remark-math（笔记/问答）和 markmap（思维导图）都只识别 $ 分隔符；
 * 笔记模型输出的 \[...\] 会被当成普通文本显示成原始 LaTeX。
 *
 * 块级公式额外用换行包裹并 trim：保证 $$ 永远处于行首（remark-math 的
 * 块级公式要求行首标记），即使原文里 \[ 跟在文字后面也不会解析失败。
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown) return markdown
  return markdown
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)
}