import { request, type FullConfig } from '@playwright/test'

/**
 * 等后端真的就绪再开跑。
 *
 * 容器刚重建时固定 sleep 十几秒是不够的：实测过一次前两个用例假失败、后面 9 个直接没跑，
 * 单独重跑又全过。与其把 sleep 猜得越来越大，不如轮询一个真接口直到 200。
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost'
  const ctx = await request.newContext({ baseURL })
  const deadline = Date.now() + 120_000
  let lastError = 'unknown'
  while (Date.now() < deadline) {
    try {
      const res = await ctx.get('/api/library', { timeout: 5000 })
      if (res.ok()) {
        await ctx.dispose()
        return
      }
      lastError = `HTTP ${res.status()}`
    } catch (e: any) {
      lastError = e?.message || String(e)
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  await ctx.dispose()
  throw new Error(`后端 120 秒内没有就绪（${baseURL}/api/library）：${lastError}`)
}
