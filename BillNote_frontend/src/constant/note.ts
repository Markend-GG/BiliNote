/* -------------------- 常量 -------------------- */
import {
  BiliBiliLogo,
  DouyinLogo,
  KuaishouLogo,
  LocalLogo,
  YoutubeLogo,
} from '@/components/Icons/platform.tsx'

export const noteFormats = [
  { label: '目录', value: 'toc' },
  { label: '原片跳转', value: 'link' },
  { label: '原片截图', value: 'screenshot' },
  { label: 'AI总结', value: 'summary' },
] as const

export const noteStyles = [
  { label: '精简', value: 'minimal' },
  { label: '详细', value: 'detailed' },
  { label: '教程', value: 'tutorial' },
  { label: '行测课程', value: 'xingce_course' },
  { label: '申论课程', value: 'shenlun_course' },
  { label: '行测速查卡', value: 'xingce_cheatsheet' },
  { label: '学术', value: 'academic' },
  { label: '小红书', value: 'xiaohongshu' },
  { label: '生活向', value: 'life_journal' },
  { label: '任务导向', value: 'task_oriented' },
  { label: '商业风格', value: 'business' },
  { label: '会议纪要', value: 'meeting_minutes' },
] as const

export const videoPlatforms = [
  { label: '哔哩哔哩', value: 'bilibili', logo: BiliBiliLogo },
  { label: 'YouTube', value: 'youtube', logo: YoutubeLogo },
  { label: '抖音', value: 'douyin', logo: DouyinLogo },
  { label: '快手', value: 'kuaishou', logo: KuaishouLogo },
  { label: '本地视频', value: 'local', logo: LocalLogo },
] as const

/** 后端 TaskStatus 的中文文案，按钮和进度条共用 */
export const taskStatusLabels: Record<string, string> = {
  PENDING: '排队中',
  PARSING: '解析链接',
  DOWNLOADING: '下载音视频',
  EXTRACTING: '抽取视频画面',
  TRANSCRIBING: '语音转写',
  SUMMARIZING: 'AI 生成笔记',
  FORMATTING: '插入截图与链接',
  SAVING: '保存笔记',
  SUCCESS: '已完成',
  FAILED: '生成失败',
}

/** 除终态以外都算「正在生成」，用来禁用提交按钮、拦截重复点击 */
export const isTaskRunning = (status?: string) =>
  !!status && status !== 'SUCCESS' && status !== 'FAILED'
