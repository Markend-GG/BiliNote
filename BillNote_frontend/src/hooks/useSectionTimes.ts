import { useEffect, useState } from 'react'

export interface SectionTime {
  id: string
  start: number
}

const PILL_RE = /原片（(\d{1,3}):(\d{2})）/

/**
 * 从 DOM 里每节第一个「原片（mm:ss）」胶囊解析章节起始时间。
 *
 * 转写↔正文联动靠它做时间↔章节的换算：点转写行找"时间≤该行"的最近章节，
 * 正文滚动高亮变化时反过来把转写列表带到该章节的起始时间附近。
 */
export function useSectionTimes(
  containerRef: React.RefObject<HTMLDivElement | null>,
  contentKey: string,
): SectionTime[] {
  const [times, setTimes] = useState<SectionTime[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      setTimes([])
      return
    }
    const next: SectionTime[] = []
    container.querySelectorAll('.md-section').forEach(section => {
      const heading = section.querySelector(
        ':scope > .md-section-head > h1, :scope > .md-section-head > h2, :scope > .md-section-head > h3, :scope > .md-section-head > h4',
      )
      if (!heading?.id) return
      const pill = section.querySelector('.origin-link a')
      const match = pill?.textContent?.match(PILL_RE)
      if (!match) return
      next.push({ id: heading.id, start: parseInt(match[1], 10) * 60 + parseInt(match[2], 10) })
    })
    next.sort((a, b) => a.start - b.start)
    setTimes(next)
  }, [contentKey, containerRef])

  return times
}

/** 时间落在哪个章节里：起始时间 ≤ t 的最后一节 */
export function sectionForTime(times: SectionTime[], seconds: number): SectionTime | null {
  let found: SectionTime | null = null
  for (const item of times) {
    if (item.start <= seconds) found = item
    else break
  }
  return found
}
