import request from '@/utils/request'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSource {
  text: string
  source_type: 'markdown' | 'transcript'
  section_title?: string
  start_time?: number
  end_time?: number
}

export interface AskResponse {
  answer: string
  sources: ChatSource[]
}

export type IndexStatus = 'idle' | 'indexing' | 'indexed' | 'failed'

export interface ChatStatusResponse {
  indexed: boolean
  status: IndexStatus
}

// 索引状态和触发索引都是"后台自动"发生的：dock 常驻挂载后，每打开一篇笔记都会打这两个接口。
// 失败时 ChatPanel 自己会渲染「索引失败，请重试」，全局红 toast 只会变成骚扰（还会和重试按钮的提示重复）。
const SILENT = { suppressToast: true }

export const indexTask = async (taskId: string): Promise<void> => {
  return await request.post('/chat/index', { task_id: taskId }, SILENT)
}

export const askQuestion = async (data: {
  task_id: string
  question: string
  history: ChatMessage[]
  provider_id: string
  model_name: string
  /** 可选：data:image/...;base64,... 形式的多模态图片（最多 4 张） */
  images?: string[]
}): Promise<AskResponse> => {
  return await request.post('/chat/ask', data, { timeout: 180000 })
}

export const getChatStatus = async (taskId: string): Promise<ChatStatusResponse> => {
  return await request.get(`/chat/status?task_id=${taskId}`, SILENT)
}