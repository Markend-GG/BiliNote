import { useEffect, useRef } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { useLibraryStore } from '@/store/libraryStore'
import { getTaskStatus } from '@/services/note.ts'
import toast from 'react-hot-toast'

// 连续多少轮一条都查不到才提示一次。提示只说"连接不稳"，绝不改任务状态
const WARN_AFTER_ROUNDS = 3

/**
 * 轮询未完成任务的状态。
 *
 * 一条铁律：**只有后端说 FAILED 才算失败**。传输层出错（超时、断网、后端忙）只代表
 * "这一轮没查到"，此时改状态会造成不可逆的错觉——写成 FAILED 后这个任务就被下面的
 * 过滤器排除、再也不会自愈，界面永远显示"生成失败"而后端还在跑，用户只能重新提交，
 * 于是同一个视频被生成两遍（白烧一遍 API 额度，书架上还多一条失败记录）。
 */
export const useTaskPolling = (interval = 3000) => {
  const tasks = useTaskStore(state => state.tasks)
  const updateTaskContent = useTaskStore(state => state.updateTaskContent)

  const tasksRef = useRef(tasks)
  // 上一轮没回来就跳过本轮：生成期间后端很忙，堆请求只会制造更多超时，形成自我加强的故障
  const pollingRef = useRef(false)
  const failedRoundsRef = useRef(0)
  const warnedRef = useRef(false)

  // 每次 tasks 更新，把最新的 tasks 同步进去
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    const timer = setInterval(async () => {
      if (pollingRef.current) return

      const pendingTasks = tasksRef.current.filter(
        task => task.status != 'SUCCESS' && task.status != 'FAILED',
      )
      // 没有活跃任务时把计数清掉，下一次生成从零开始算
      if (pendingTasks.length === 0) {
        failedRoundsRef.current = 0
        warnedRef.current = false
        return
      }

      pollingRef.current = true
      let failedThisRound = 0
      try {
        for (const task of pendingTasks) {
          try {
            const res = await getTaskStatus(task.id)
            // 后端明确说"没有这个任务的记录"：这是浏览器里的残留任务（提交时后端同步写状态文件，
            // 真任务一定查得到）。标记失败并停止轮询，别让它永远显示"排队中"
            if (res?.known === false) {
              console.warn(`任务 ${task.id} 后端无记录，标记为失败`)
              updateTaskContent(task.id, { status: 'FAILED' })
              continue
            }
            const status = res?.status
            if (!status || status === task.status) continue

            if (status === 'SUCCESS') {
              const { markdown, transcript, audio_meta } = res.result ?? {}
              toast.success('笔记生成成功')
              updateTaskContent(task.id, {
                status,
                markdown,
                transcript,
                audioMeta: audio_meta,
              })
              // 生成成功时后端落了一个新版本行，版本下拉要跟着刷新
              useLibraryStore.getState().fetchVersions(task.id)
            } else {
              if (status === 'FAILED') console.warn(`⚠️ 任务 ${task.id} 后端判定失败`)
              updateTaskContent(task.id, { status })
            }
          } catch (e) {
            // 保持原状态，下一轮再试。这里改状态就是上面注释里说的那个坑
            failedThisRound += 1
            console.warn(`任务 ${task.id} 状态查询失败，保持原状态继续轮询：`, e)
          }
        }
      } finally {
        pollingRef.current = false
      }

      if (failedThisRound === 0) {
        failedRoundsRef.current = 0
        warnedRef.current = false
        return
      }
      failedRoundsRef.current += 1
      if (failedRoundsRef.current >= WARN_AFTER_ROUNDS && !warnedRef.current) {
        warnedRef.current = true
        toast('与后端连接不稳定，正在自动重试；任务在后端继续跑，不用重新提交', { icon: '⚠️' })
      }
    }, interval)

    return () => clearInterval(timer)
  }, [interval, updateTaskContent])
}
