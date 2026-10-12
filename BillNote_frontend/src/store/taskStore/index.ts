import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { delete_task, generateNote } from '@/services/note.ts'
import { v4 as uuidv4 } from 'uuid'
import toast from 'react-hot-toast'
import { get, set, del } from 'idb-keyval'
import { isTaskRunning, taskStatusLabels } from '@/constant/note'


/**
 * 后端 TaskStatus 枚举的取值（app/enmus/task_status_enums.py）。
 * 以前这里写的是 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILD'：FAILD 拼错、RUNNING 后端根本不发、
 * 中间阶段全缺。运行时靠 taskStatusLabels 的 Record<string,string> 兜住了才没出事。
 */
export type TaskStatus =
  | 'PENDING'
  | 'PARSING'
  | 'DOWNLOADING'
  | 'EXTRACTING'
  | 'TRANSCRIBING'
  | 'SUMMARIZING'
  | 'FORMATTING'
  | 'SAVING'
  | 'SUCCESS'
  | 'FAILED'

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
  /** addPendingTask 一直在写这个字段（书架页靠它判断封面走不走代理），接口里以前漏了声明 */
  platform: string
  /** 所属文件夹，null = 未分类。权威值在后端 notes 表，这里只是本地副本 */
  folderId?: string | null
  /** 用户自定义别名，为空时显示视频标题 */
  title?: string | null
  formData: {
    video_url: string
    link?: boolean
    screenshot?: boolean
    platform: string
    quality: string
    model_name: string
    provider_id: string
    // NoteForm 提交时是把整个 payload 存进来的，style / format / extras /
    // video_understanding / video_interval / grid_size 也都在里面，重新生成要用
    [key: string]: any
  }
}

/** 详情页刷新后本地没这篇时，用后端 /api/task_status 的返回把它重建出来 */
export interface HydratePayload {
  task_id: string
  status?: string
  markdown?: string
  transcript?: Transcript
  audio_meta?: AudioMeta
  form_data?: Record<string, any> | null
  created_at?: number | null
}

interface TaskStore {
  tasks: Task[]
  currentTaskId: string | null
  addPendingTask: (taskId: string, platform: string, formData: Task['formData']) => void
  hydrateTask: (payload: HydratePayload) => void
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

      addPendingTask: (taskId, platform, formData) =>
        set(state => ({
          tasks: [
            {
              formData: formData,
              id: taskId,
              status: 'PENDING',
              markdown: '',
              platform: platform,
              folderId: null,
              title: null,
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
        // 先本地移除让界面立刻响应。后端删除失败不回滚——条目塞回来只会让人以为没删掉，
        // 书架页刷新后它本来也会重新出现。
        set(state => ({
          tasks: state.tasks.filter(task => task.id !== id),
          currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
        }))
        // 不管本地有没有这条都要通知后端：清过浏览器缓存时本地记录已经没了，
        // 但 note_results 里的文件和截图还在盘上
        await delete_task({ task_id: id })
      },

      hydrateTask: payload => {
        const { task_id } = payload
        // 本地已有就不覆盖：浏览器里可能存着多个版本，后端只留最新一份
        if (get().tasks.some(task => task.id === task_id)) return

        const meta = payload.audio_meta
        const form = payload.form_data ?? {}
        const createdAt = new Date(payload.created_at ?? Date.now()).toISOString()
        const task: Task = {
          id: task_id,
          status: (payload.status || 'SUCCESS') as TaskStatus,
          markdown: payload.markdown
            ? [
                {
                  ver_id: `${task_id}-restored`,
                  content: payload.markdown,
                  style: form.style || '',
                  model_name: form.model_name || '',
                  created_at: createdAt,
                },
              ]
            : '',
          transcript: payload.transcript ?? {
            full_text: '',
            language: '',
            raw: null,
            segments: [],
          },
          platform: meta?.platform || form.platform || '',
          folderId: null,
          title: null,
          audioMeta: meta ?? {
            cover_url: '',
            duration: 0,
            file_path: '',
            platform: '',
            raw_info: null,
            title: '',
            video_id: '',
          },
          createdAt,
          formData: {
            video_url: form.video_url || meta?.raw_info?.webpage_url || '',
            platform: form.platform || meta?.platform || '',
            quality: form.quality || 'medium',
            model_name: form.model_name || '',
            provider_id: form.provider_id || '',
            ...form,
          },
        }
        set(state => ({ tasks: [task, ...state.tasks] }))
      },

      clearTasks: () => set({ tasks: [], currentTaskId: null }),

      setCurrentTask: taskId => set({ currentTaskId: taskId }),
    }),
    {
      name: 'task-storage',
      version: 2,
      migrate: (persisted: any, version: number) => {
        // v2：Task 增加 folderId / title，并把一直在写却没声明的 platform 补进类型。
        // 老记录只补默认值，内容和版本历史一律不动。
        if (version < 2 && Array.isArray(persisted?.tasks)) {
          persisted.tasks = persisted.tasks.map((task: any) => ({
            ...task,
            folderId: task.folderId ?? null,
            title: task.title ?? null,
            platform: task.platform ?? task.audioMeta?.platform ?? '',
          }))
        }
        return persisted
      },
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
