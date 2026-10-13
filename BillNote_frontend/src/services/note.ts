import request from '@/utils/request'
import toast from 'react-hot-toast'

/**
 * 生成笔记的请求体。字段与后端 VideoRequest 对齐；表单值里 quality 是字面量联合、
 * 部分字段可选，逐字段声明会让每个调用点都报不兼容，这里收口为宽松对象。
 */
export type GenerateNotePayload = Record<string, any>

export const generateNote = async (data: GenerateNotePayload) => {
  try {
    console.log('generateNote', data)
    const response = await request.post('/generate_note', data)

    if (!response) {
      if (response.data.msg) {
        toast.error(response.data.msg)
      }
      return null
    }
    toast.success('笔记生成任务已提交！')

    console.log('res', response)
    // 成功提示

    return response
  } catch (e: any) {
    console.error('❌ 请求出错', e)

    // 错误提示
    // toast.error('笔记生成失败，请稍后重试')

    throw e // 抛出错误以便调用方处理
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

export const getTaskStatus = async (task_id: string) => {
  try {
    // 成功提示

    return await request.get('/task_status/' + task_id)
  } catch (e) {
    console.error('❌ 请求出错', e)

    // 错误提示
    toast.error('笔记生成失败，请稍后重试')

    throw e
  }
}

/** 保存手动编辑后的笔记（同步更新后端文件与 AI 问答索引） */
export const update_note = async (task_id: string, markdown: string) => {
  return await request.post('/update_note', { task_id, markdown })
}