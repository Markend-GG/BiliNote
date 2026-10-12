import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { delete_task, generateNote } from '@/services/note.ts'
import { v4 as uuidv4 } from 'uuid'
import toast from 'react-hot-toast'
import { get, set, del } from 'idb-keyval'
import { isTaskRunning, taskStatusLabels } from '@/constant/note'


export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILD'

export interface AudioMeta {
  cover_url: string
  duration: number
  file_path: string
  platform: string
  raw_info: any
  title: string
  video_id: string
}

export interface Segment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  full_text: string
  language: string
  raw: any
  segments: Segment[]
}
export interface Markdown {
  ver_id: string
  content: string
  style: string
  model_name: string
  created_at: string
}

export interface Task {
  id: string
  markdown: string|Markdown [] //为了兼容之前的笔记
  transcript: Transcript
  status: TaskStatus
  audioMeta: AudioMeta
  createdAt: string
  formData: {
    video_url: string
    link: undefined | boolean
    screenshot: undefined | boolean
    platform: string
    quality: string
    model_name: string
    provider_id: string
  }
}

interface TaskStore {
  tasks: Task[]
  currentTaskId: string | null
  addPendingTask: (taskId: string, platform: string) => void
  updateTaskContent: (id: string, data: Partial<Omit<Task, 'id' | 'createdAt'>>) => void
  removeTask: (id: string) => void
  removeVersion: (taskId: string, verId: string) => void
  clearTasks: () => void
  setCurrentTask: (taskId: string | null) => void
  getCurrentTask: () => Task | null
  retryTask: (id: string, payload?: any) => Promise<boolean>
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      currentTaskId: null,

      addPendingTask: (taskId: string, platform: string, formData: any) =>

        set(state => ({
          tasks: [
            {
              formData: formData,
              id: taskId,
              status: 'PENDING',
              markdown: '',
              platform: platform,
              transcript: {
                full_text: '',
                language: '',
                raw: null,
                segments: [],
              },
              createdAt: new Date().toISOString(),
              audioMeta: {
                cover_url: '',
                duration: 0,
                file_path: '',
                platform: '',
                raw_info: null,
                title: '',
                video_id: '',
              },
            },
            ...state.tasks,
          ],
          currentTaskId: taskId, // 默认设置为当前任务
        })),

      updateTaskContent: (id, data) =>
          set(state => ({
            tasks: state.tasks.map(task => {
              if (task.id !== id) return task

              if (task.status === 'SUCCESS' && data.status === 'SUCCESS') return task

              // 如果是 markdown 字符串，封装为版本
              if (typeof data.markdown === 'string') {
                const prev = task.markdown
                // 内容一模一样就不新增版本：重复点保存、或轮询重复收到同一份结果时，
                // 版本下拉里会堆出好几个相同的版本，切来切去看着像没反应
                const latestContent = Array.isArray(prev) ? prev[0]?.content : prev
                if (typeof latestContent === 'string' && latestContent === data.markdown) {
                  return { ...task, ...data, markdown: prev }
                }
                const newVersion: Markdown = {
                  ver_id: `${task.id}-${uuidv4()}`,
                  content: data.markdown,
                  style: task.formData.style || '',
                  model_name: task.formData.model_name || '',
                  created_at: new Date().toISOString(),
                }

                let updatedMarkdown: Markdown[]
                if (Array.isArray(prev)) {
                  updatedMarkdown = [newVersion, ...prev]
                } else {
                  updatedMarkdown = [
                    newVersion,
                    ...(typeof prev === 'string' && prev
                        ? [{
                          ver_id: `${task.id}-${uuidv4()}`,
                          content: prev,
                          style: task.formData.style || '',
                          model_name: task.formData.model_name || '',
                          created_at: new Date().toISOString(),
                        }]
                        : []),
                  ]
                }

                return {
                  ...task,
                  ...data,
                  markdown: updatedMarkdown,
                }
              }

              return { ...task, ...data }
            }),
          })),


      getCurrentTask: () => {
        const currentTaskId = get().currentTaskId
        return get().tasks.find(task => task.id === currentTaskId) || null
      },
      retryTask: async (id: string, payload?: any) => {
        if (!id) {
          toast.error('任务不存在')
          return false
        }
        const task = get().tasks.find(task => task.id === id)
        if (!task) return false

        // 生成中的任务直接拦掉：连点会让后端并发跑同一个 task_id，白烧一遍额度
        if (isTaskRunning(task.status)) {
          toast(`正在${taskStatusLabels[task.status] || '生成'}，请勿重复点击`, { icon: '⏳' })
          return false
        }

        const newFormData = payload || task.formData
        const previousStatus = task.status
        // 先同步置为 PENDING，让按钮立刻进入禁用态，堵住网络往返这段空窗
        set(state => ({
          tasks: state.tasks.map(t =>
            t.id === id ? { ...t, formData: newFormData, status: 'PENDING' } : t
          ),
        }))

        try {
          await generateNote({
            ...newFormData,
            task_id: id,
          })
          return true
        } catch (e: any) {
          // 提交失败要把状态还回去，否则按钮会一直转圈
          set(state => ({
            tasks: state.tasks.map(t => (t.id === id ? { ...t, status: previousStatus } : t)),
          }))
          // 就绪门禁：转写模型未下载好，给提示让用户先去下载
          if (e?.data?.reason === 'transcriber_model_not_ready') {
            toast.error(
              e?.data?.downloading
                ? '转写模型正在下载中，请稍候再重试'
                : '转写模型尚未下载，请先去「设置 → 音频转写配置」页下载',
            )
            return false
          }
          console.error('重试任务失败：', e)
          return false
        }
      },


      removeVersion: (taskId, verId) =>
        set(state => ({
          tasks: state.tasks.map(task => {
            if (task.id !== taskId || !Array.isArray(task.markdown)) return task
            const rest = task.markdown.filter(v => v.ver_id !== verId)
            // 至少留一个版本：删空了就没有内容可显示，按钮那边也会先拦住
            if (!rest.length) return task
            return { ...task, markdown: rest }
          }),
        })),

      removeTask: async id => {
        const task = get().tasks.find(t => t.id === id)

        // 更新 Zustand 状态
        set(state => ({
          tasks: state.tasks.filter(task => task.id !== id),
          currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
        }))

        // 调用后端删除接口（如果找到了任务）
        if (task) {
          await delete_task({
            video_id: task.audioMeta.video_id,
            platform: task.platform,
          })
        }
      },

      clearTasks: () => set({ tasks: [], currentTaskId: null }),

      setCurrentTask: taskId => set({ currentTaskId: taskId }),
    }),
    {
      name: 'task-storage',
      storage: createJSONStorage(() => ({
        getItem: async (name: string): Promise<string | null> => {
          const value = await get(name)
          return value ?? null
        },
        setItem: async (name: string, value: string): Promise<void> => {
          await set(name, value)
        },
        removeItem: async (name: string): Promise<void> => {
          await del(name)
        },
      })),
    }
  )
)
