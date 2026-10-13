import { describe, expect, it } from 'vitest'
import { mergeShelfItems } from './selectors'
import type { LibraryNote } from '@/services/library'
import type { Task } from '@/store/taskStore'

const note = (over: Partial<LibraryNote> = {}): LibraryNote => ({
  task_id: 'n1',
  title: null,
  video_title: '后端标题',
  folder_id: null,
  status: 'SUCCESS',
  video_id: 'BV1',
  platform: 'bilibili',
  cover_url: 'http://c/1.jpg',
  duration: 100,
  created_at: 1000,
  updated_at: 1000,
  last_opened_at: null,
  form_data: null,
  ...over,
})

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 'n1',
    markdown: '',
    transcript: { full_text: '', language: '', raw: null, segments: [] },
    status: 'SUCCESS',
    audioMeta: {
      cover_url: '', duration: 0, file_path: '', platform: '', raw_info: null, title: '', video_id: '',
    },
    createdAt: new Date(2000).toISOString(),
    platform: 'bilibili',
    formData: { video_url: '', platform: 'bilibili', quality: 'medium', model_name: '', provider_id: '' },
    ...over,
  }) as Task

describe('mergeShelfItems', () => {
  it('本地正在跑的状态优先于后端索引', () => {
    const [item] = mergeShelfItems([note()], [task({ status: 'TRANSCRIBING' })])
    expect(item.status).toBe('TRANSCRIBING')
  })

  it('双方都终态且不一致时信后端（本地停在旧 FAILED）', () => {
    const [item] = mergeShelfItems([note({ status: 'SUCCESS' })], [task({ status: 'FAILED' })])
    expect(item.status).toBe('SUCCESS')
  })

  it('标题/封面/时间后端优先，本地兜底', () => {
    const [item] = mergeShelfItems(
      [note({ title: '别名', cover_url: null, created_at: null })],
      [task({ audioMeta: { cover_url: 'http://local/2.jpg', duration: 5, file_path: '', platform: '', raw_info: null, title: '本地标题', video_id: '' } })],
    )
    expect(item.title).toBe('别名')
    expect(item.coverUrl).toBe('http://local/2.jpg')
    expect(item.createdAt).not.toBeNull()
  })

  it('只在本地的任务（后端还没落库）也要出现', () => {
    const items = mergeShelfItems([note()], [task({ id: 'local-only' })])
    expect(items.map(i => i.taskId)).toEqual(['n1', 'local-only'])
    expect(items[1].hasLocal).toBe(true)
  })
})
