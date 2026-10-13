import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollToHeading } from './heading'

const section = (id: string, headingId: string, tag: string, cls = '') => {
  const sec = document.createElement('div')
  sec.className = `md-section ${cls}`.trim()
  const head = document.createElement('div')
  head.className = 'md-section-head'
  const h = document.createElement(tag)
  h.id = headingId
  h.textContent = id
  head.appendChild(h)
  sec.appendChild(head)
  return sec
}

beforeEach(() => {
  document.body.innerHTML = ''
  Element.prototype.scrollIntoView = vi.fn()
})

describe('scrollToHeading', () => {
  it('精确 id 命中并展开所有折叠祖先', () => {
    const outer = section('外', 'h-outer', 'h2')
    const inner = section('内', 'h-inner', 'h3', 'md-collapsed')
    outer.appendChild(inner)
    document.body.appendChild(outer)

    expect(scrollToHeading('h-inner')).toBe(true)
    expect(inner.classList.contains('md-collapsed')).toBe(false)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('id 不中时按标题文本模糊匹配', () => {
    const sec = section('题型一：基期倍比', 'real-slug', 'h2')
    document.body.appendChild(sec)
    expect(scrollToHeading('题型一基期倍比')).toBe(true)
  })

  it('都找不到返回 false', () => {
    document.body.appendChild(section('甲', 'h-a', 'h2'))
    expect(scrollToHeading('完全不存在的章节')).toBe(false)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })
})
