import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatSource } from '@/services/chat'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  /** 用户粘贴的图片（data:image/...;base64,...），仅用于界面展示 */
  images?: string[]
}

interface ChatState {
  chatHistory: Record<string, ChatMessage[]>
  addMessage: (taskId: string, msg: ChatMessage) => void
  clearChat: (taskId: string) => void
  getMessages: (taskId: string) => ChatMessage[]
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chatHistory: {},

      addMessage: (taskId, msg) =>
        set(state => ({
          chatHistory: {
            ...state.chatHistory,
            [taskId]: [...(state.chatHistory[taskId] || []), msg],
          },
        })),

      clearChat: (taskId) =>
        set(state => {
          const { [taskId]: _, ...rest } = state.chatHistory
          return { chatHistory: rest }
        }),

      getMessages: (taskId) => get().chatHistory[taskId] || [],
    }),
    {
      name: 'bilinote-chat-storage',
      // 图片 base64 体积大，不写入 localStorage（避免超出配额），仅保留文字
      partialize: state => ({
        chatHistory: Object.fromEntries(
          Object.entries(state.chatHistory).map(([k, msgs]) => [
            k,
            msgs.map(m => (m.images ? { ...m, images: undefined } : m)),
          ]),
        ),
      }),
    },
  ),
)