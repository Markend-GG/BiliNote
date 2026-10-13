import { describe, expect, it } from 'vitest'
import { SORTERS, coverSrc, formatDate, formatDuration } from './utils'
import type { ShelfItem } from '@/store/selectors'

describe('formatDuration', () => {
  it('超过一小时带小时位', () => expect(formatDuration(6180.495)).toBe('1:43:00'))
  it('不足一小时只有分秒', () => expect(formatDuration(45)).toBe('0:45'))
  it('空值返回空串', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(0)).toBe('')
  })
})

describe('formatDate', () => {
  it('按本地时区输出 yyyy-MM-dd HH:mm', () => {
    const ms = new Date(2026, 9, 12, 12, 5).getTime()
    expect(formatDate(ms)).toBe('2026-10-12 12:05')
  })
  it('坏值返回空串', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(NaN)).toBe('')
  })
})

describe('coverSrc', () => {
  const item = (over: Partial<ShelfItem> = {}): ShelfItem =>
    ({ taskId: 't', title: '', folderId: null, status: 'SUCCESS', platform: 'bilibili', coverUrl: 'http://x/1.jpg', duration: null, createdAt: null, lastOpenedAt: null, hasLocal: false, ...over })
  it('远程封面走后端代理且是绝对路径', () => {
    expect(coverSrc(item())).toBe('/api/image_proxy?url=' + encodeURIComponent('http://x/1.jpg'))
  })
  it('本地视频直连', () => {
    expect(coverSrc(item({ platform: 'local', coverUrl: '/uploads/a.mp4' }))).toBe('/uploads/a.mp4')
  })
  it('没封面给占位图', () => {
    expect(coverSrc(item({ coverUrl: null }))).toBe('/placeholder.png')
  })
})

describe('SORTERS', () => {
  const item = (over: Partial<ShelfItem>): ShelfItem =>
    ({ taskId: 't', title: '', folderId: null, status: 'SUCCESS', platform: null, coverUrl: null, duration: null, createdAt: null, lastOpenedAt: null, hasLocal: false, ...over })
  const list = [item({ taskId: 'a', createdAt: 1, duration: 9, title: '乙' }), item({ taskId: 'b', createdAt: 3, duration: 5, title: '甲' })]
  it('默认最新创建', () => expect(list.sort(SORTERS.created.cmp).map(i => i.taskId)).toEqual(['b', 'a']))
  it('时长最长', () => expect(list.sort(SORTERS.duration.cmp).map(i => i.taskId)).toEqual(['a', 'b']))
  it('标题按中文排', () => expect(list.sort(SORTERS.title.cmp).map(i => i.taskId)).toEqual(['b', 'a']))
})
