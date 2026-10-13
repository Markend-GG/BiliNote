import request from '@/utils/request'
import type { RequestFailure } from '@/utils/request'
import toast from 'react-hot-toast'

/**
 * 生成笔记的请求体。字段与后端 VideoRequest 对齐；表单值里 quality 是字面量联合、
 * 部分字段可选，逐字段声明会让每个调用点都报不兼容，这里收口为宽松对象。
 */
export type GenerateNotePayload = Record<string, any>

export interface GenerateNoteResult {
  task_id: string
  /** 后端发现同视频同风格已在生成，直接复用了那个任务 */
  deduped?: boolean
}

// 提交入口有同步前置动作（转写模型就绪检查、视频 ID 解析），全局默认的 10s 不够；
// 轮询反过来要短一点，免得一次卡住把后面的轮次全堵住
const SUBMIT_TIMEOUT = 60_000
const POLL_TIMEOUT = 15_000

/**
 * 提交生成任务。
 *
 * 超时按「结果未知」处理，不能当失败：客户端断开不会让 FastAPI 停下，任务很可能已经排进队列。
 * 后端按 (视频, 风格) 幂等去重——同键在跑就把那个 task_id 还回来——所以这里重发一次是安全的：
 * 要么拿回同一个任务，要么在真的没提交成功时补上。
 */
export const generateNote = async (data: GenerateNotePayload): Promise<GenerateNoteResult> => {
  const post = () =>
    request.post<any, GenerateNoteResult>('/generate_note', data, { timeout: SUBMIT_TIMEOUT })
  const announce = (res: GenerateNoteResult) => {
    toast.success(
      res?.deduped ? '这个视频的同风格笔记正在生成中，已接回那个任务' : '笔记生成任务已提交！',
    )
    return res
  }
  try {
    return announce(await post())
  } catch (e) {
    if (!(e as RequestFailure)?.isTimeout) throw e
    toast('提交超时，正在确认任务是否已创建…', { icon: '⏳' })
    try {
      return announce(await post())
    } catch (retryError) {
      // 后端在排队前就会把 PENDING 写进笔记库，所以书架页大概率已经能看到这条"生成中"
      toast.error('提交仍然超时。任务可能已在后台创建，请到书架页确认后再决定是否重试')
      throw retryError
    }
  }
}

/**
 * 删除一篇笔记。后端会真正清掉 note_results 下的 5 个文件、这篇引用的截图、
 * SQLite 索引行和向量索引（以前那个接口是空壳，界面上删了盘上什么都没少）。
 * 失败提示交给请求拦截器统一弹，这里不重复 toast。
 */
export const deleteNote = async ({ task_id }: { task_id: string }) => {
  const res = await request.post<any, { deleted_files: number; deleted_screenshots: number }>(
    '/delete_task',
    { task_id },
  )
  toast.success(
    res?.deleted_screenshots ? `已删除笔记，释放 ${res.deleted_screenshots} 张截图` : '已删除笔记',
  )
  return res
}

/**
 * 查任务状态（轮询与详情页恢复共用）。
 *
 * 失败必须静默：一次超时/断网只代表"这一轮没查到"，怎么解读由调用方决定。
 * 以前这里自己弹「笔记生成失败，请稍后重试」，轮询又把异常当成 FAILED 写进 store，
 * 于是一次 10 秒超时 = 两条红 toast + 界面永久显示生成失败，而后端还在正常跑。
 */
export const getTaskStatus = async (task_id: string) => {
  return await request.get('/task_status/' + task_id, {
    suppressToast: true,
    timeout: POLL_TIMEOUT,
  })
}

/** 保存手动编辑后的笔记（同步更新后端文件与 AI 问答索引） */
export const update_note = async (task_id: string, markdown: string) => {
  return await request.post('/update_note', { task_id, markdown })
}