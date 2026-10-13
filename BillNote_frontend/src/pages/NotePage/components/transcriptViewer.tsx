"use client"

import { useTaskStore } from "@/store/taskStore"
import { useEffect, useState, useRef } from "react"
import { cn } from "@/lib/utils"
import {ScrollArea} from "@/components/ui/scroll-area.tsx";

interface Segment {
  start: number
  end: number
  text: string
  speaker?: string
}

interface Task {
  transcript?: {
    segments?: Segment[]
  }
}

interface TranscriptViewerProps {
  /** 点某行转写时把该片段的起始秒抛出去，供正文跳到对应章节 */
  onPickTime?: (seconds: number) => void
  /** 正文当前章节的起始秒；变化时把列表滚到最近片段并高亮 */
  focusTime?: number | null
}

const TranscriptViewer = ({ onPickTime, focusTime = null }: TranscriptViewerProps) => {
  const getCurrentTask = useTaskStore((state) => state.getCurrentTask)
  const currentTaskId = useTaskStore((state) => state.currentTaskId)
  const [task, setTask] = useState<Task | null>(null)
  const [activeSegment, setActiveSegment] = useState<number | null>(null)
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    setTask(getCurrentTask())
  }, [currentTaskId, getCurrentTask])

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleSegmentClick = (index: number) => {
    setActiveSegment(index)
    const seconds = task?.transcript?.segments?.[index]?.start
    if (seconds !== undefined && onPickTime) onPickTime(seconds)
  }

  // 正文章节变化 → 列表跟到该章节起始时间最近的片段
  useEffect(() => {
    if (focusTime === null || !task?.transcript?.segments?.length) return
    const segments = task.transcript.segments
    let index = 0
    for (let i = 0; i < segments.length; i++) {
      if ((segments[i].start ?? 0) <= focusTime) index = i
      else break
    }
    setActiveSegment(index)
    scrollToSegment(index)
  }, [focusTime, task])

  const scrollToSegment = (index: number) => {
    segmentRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    })
  }

  return (
      <div className="transcript-viewer flex h-full w-full flex-col  rounded-md border bg-white p-4 shadow-sm">
        <h2 className="mb-4 text-lg font-medium">转写结果</h2>
        {!task?.transcript?.segments?.length ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">暂无转写内容</div>
        ) : (
            <>


            <div className="mb-3 grid grid-cols-[80px_1fr] gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
                <div>时间</div>
                <div>内容</div>
              </div>
            <ScrollArea className="w-full overflow-y-auto">

              <div className="space-y-1">
                {task.transcript.segments.map((segment, index) => (
                    <div
                        key={index}
                        ref={(el) => {
                          segmentRefs.current[index] = el
                        }}
                        className={cn(
                            "group grid grid-cols-[80px_1fr] gap-2 rounded-md p-2 transition-colors hover:bg-slate-50",
                            activeSegment === index && "bg-slate-100",
                        )}
                        onClick={() => handleSegmentClick(index)}
                    >
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <button
                            className="invisible rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 group-hover:visible"
                            onClick={(e) => {
                              e.stopPropagation()
                              // Add play functionality here
                            }}
                        >
                          {/*<Play className="h-3 w-3" />*/}
                        </button>
                        <span>{formatTime(segment.start)}</span>
                      </div>

                      <div className="text-sm leading-relaxed text-slate-700">
                        {segment.speaker && (
                            <span className="mr-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                      {segment.speaker}
                    </span>
                        )}
                        {segment.text}
                      </div>
                    </div>
                ))}
              </div>
            </ScrollArea>

            </>
        )}


        {(task?.transcript?.segments?.length ?? 0) > 0 && (
            <div className="mt-4 flex justify-between border-t pt-3 text-xs text-slate-500">
              <span>共 {task?.transcript?.segments?.length} 条片段</span>
              <span>
                总时长: {formatTime(task?.transcript?.segments?.[task.transcript.segments.length - 1]?.end || 0)}
              </span>
            </div>
        )}
      </div>
  )
}

export default TranscriptViewer
