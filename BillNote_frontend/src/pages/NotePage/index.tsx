import { FC, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { scrollToHeading } from '@/utils/heading'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MarkdownViewer from '@/pages/NotePage/components/MarkdownViewer'
import { getTaskStatus } from '@/services/note'
import { useLibraryStore } from '@/store/libraryStore'
import { useTaskStore } from '@/store/taskStore'

type ViewStatus = 'idle' | 'loading' | 'success' | 'failed'

/**
 * 详情页（第二级）：只负责阅读一篇笔记。
 *
 * 走真路由（/note/:taskId）之后浏览器后退键、刷新、收藏夹都能用了；
 * 以前是纯 store 驱动，刷新一下就从笔记回到空白首页。
 */
const NotePage: FC = () => {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const jumpHeading = (location.state as { heading?: string } | null)?.heading
  const jumpedRef = useRef<string | null>(null)
  const tasks = useTaskStore(state => state.tasks)
  const setCurrentTask = useTaskStore(state => state.setCurrentTask)
  const hydrateTask = useTaskStore(state => state.hydrateTask)
  const touchNote = useLibraryStore(state => state.touchNote)
  const fetchLibrary = useLibraryStore(state => state.fetchLibrary)
  const libraryLoaded = useLibraryStore(state => state.loaded)
  const libraryError = useLibraryStore(state => state.loadError)

  const currentTask = tasks.find(task => task.id === taskId)
  const [status, setStatus] = useState<ViewStatus>('idle')
  const [restoring, setRestoring] = useState(false)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  // 每篇只尝试恢复一次：条件里若只看 currentTask/restoring，notes 一变化就会反复打后端
  const attemptedRef = useRef<string | null>(null)

  useEffect(() => {
    fetchLibrary()
  }, [fetchLibrary, reloadTick])

  useEffect(() => {
    if (!taskId) return
    setCurrentTask(taskId)
    touchNote(taskId)
  }, [taskId, setCurrentTask, touchNote])

  // 清过浏览器缓存 / 换了浏览器时本地没有这篇，用后端 note_results 里存的那份重建，
  // 否则直接刷新 /note/:id 会是一片空白。
  // 必须等笔记库索引拉回来再动手：form_data 和 created_at 都在索引里，抢跑的话
  // 恢复出来的笔记会缺「重新生成」要用的原始参数，创建时间也会变成"现在"。
  useEffect(() => {
    if (!taskId || currentTask || attemptedRef.current === taskId) return
    // 索引拉取失败时也要往下走：后端 /api/note 说不定还是通的，
    // 死等 loaded 只会让页面卡在"找不到这篇笔记"
    if (!libraryLoaded && !libraryError) return
    attemptedRef.current = taskId
    setRestoring(true)
    setRestoreFailed(false)
    const indexed = useLibraryStore.getState().notes.find(note => note.task_id === taskId)
    getTaskStatus(taskId)
      .then(res => {
        if (!res?.status) {
          setRestoreFailed(true)
          return
        }
        hydrateTask({
          task_id: taskId,
          status: res.status,
          markdown: res.result?.markdown,
          transcript: res.result?.transcript,
          audio_meta: res.result?.audio_meta,
          form_data: indexed?.form_data ?? null,
          created_at: indexed?.created_at ?? null,
        })
      })
      .catch(() => {
        // 后端对 FAILED 的任务返回业务错误（R.error），会走到这里。
        // 但"生成失败"和"找不到"是两回事：索引里写着 FAILED 就按失败态恢复，
        // 让用户看到失败页和重新生成入口，而不是一句误导的"找不到这篇笔记"
        const indexed = useLibraryStore.getState().notes.find(note => note.task_id === taskId)
        if (indexed?.status === 'FAILED') {
          hydrateTask({
            task_id: taskId,
            status: 'FAILED',
            form_data: indexed.form_data ?? null,
            created_at: indexed.created_at ?? null,
          })
        } else {
          setRestoreFailed(true)
        }
      })
      .finally(() => setRestoring(false))
  }, [taskId, currentTask, libraryLoaded, libraryError, hydrateTask])

  useEffect(() => {
    if (!currentTask) {
      setStatus('idle')
    } else if (currentTask.status === 'SUCCESS') {
      setStatus('success')
    } else if (currentTask.status === 'FAILED') {
      setStatus('failed')
    } else {
      // PENDING、DOWNLOADING、EXTRACTING、TRANSCRIBING、SUMMARIZING 等所有进行中状态
      setStatus('loading')
    }
  }, [currentTask?.id, currentTask?.status])

  // 从书架的"正文命中"进来时，等正文渲染出来再跳到对应章节
  useEffect(() => {
    if (!jumpHeading || !currentTask || status !== 'success') return
    if (jumpedRef.current === jumpHeading + taskId) return
    jumpedRef.current = jumpHeading + taskId
    const timer = setTimeout(() => scrollToHeading(jumpHeading), 350)
    return () => clearTimeout(timer)
  }, [jumpHeading, currentTask, status, taskId])

  if (!taskId) return <Navigate to="/" replace />

  // 重试要连"这篇试过了"的标记一起清掉，否则恢复逻辑不会重跑，页面只会再显示一次失败
  const retryLoad = () => {
    attemptedRef.current = null
    setRestoreFailed(false)
    setReloadTick(tick => tick + 1)
  }

  if (restoring) {
    return (
      <div className="text-muted-foreground flex h-screen items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在从后端恢复这篇笔记…
      </div>
    )
  }

  if (!currentTask || restoreFailed) {
    // 后端整体连不上时，"找不到"是个假结论——索引根本没拉到
    if (libraryError && !libraryLoaded) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3">
          <p className="text-lg font-medium text-neutral-700">连不上笔记库</p>
          <p className="text-muted-foreground max-w-md text-center text-sm">
            读不到后端的笔记索引，没法确认这篇还在不在。检查一下容器是否在运行，然后重试。
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={retryLoad}>
              重试
            </Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              返回书架
            </Button>
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-lg font-medium text-neutral-700">找不到这篇笔记</p>
        <p className="text-muted-foreground max-w-md text-center text-sm">
          后端也没有它的记录。可能已经被删除，或者生成从未成功落盘。
        </p>
        <Button variant="outline" onClick={() => navigate('/')}>
          返回书架
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <MarkdownViewer status={status} />
    </div>
  )
}

export default NotePage
