import { test, expect } from '@playwright/test'

let taskId = ''

test.beforeAll(async ({ request }) => {
  const res = await request.get('/api/library')
  const notes = (await res.json()).data.notes
  if (!notes.length) test.skip()
  taskId = notes[0].task_id
})

test('章节导航列出全部小节且滚动高亮跟随', async ({ page }) => {
  await page.goto(`/note/${taskId}`)
  const aside = page.locator('aside')
  await expect(aside).toBeVisible()
  const entries = aside.locator('button[title]')
  await expect(entries.first()).toBeVisible()
  expect(await entries.count()).toBeGreaterThan(3)

  const before = await aside.locator('button[aria-current="location"]').getAttribute('title')
  await page.evaluate(() => {
    const vp = document
      .querySelector('.markdown-body')!
      .closest('[data-radix-scroll-area-viewport]') as HTMLElement
    vp.scrollTop = vp.scrollHeight * 0.6
  })
  // scroll-spy 是 80ms 节流 + 渲染后再量位置，重笔记下 700ms 死等会偶发超时；轮询等到变为止
  await expect
    .poll(() => aside.locator('button[aria-current="location"]').getAttribute('title'), {
      timeout: 8000,
    })
    .not.toBe(before)
})

test('打开参照 dock 时章节栏收竖条，关闭后恢复', async ({ page }) => {
  await page.goto(`/note/${taskId}`)
  // dock 面板是常驻挂载的，关掉只是 collapse 到 0 宽（内容被 overflow:hidden 裁掉）。
  // 所以不能断言 tablist "hidden"：它有 px-2 内边距，自身盒子始终 16x40，Playwright 会判可见
  const dockPanel = page.locator('[data-panel-id]', {
    has: page.locator('[aria-label="参照面板"]'),
  })
  const dockWidth = async () => (await dockPanel.boundingBox())?.width ?? -1

  expect(await dockWidth()).toBe(0)
  await expect(page.locator('aside')).toBeVisible()

  await page.getByRole('button', { name: '原文参照' }).click()
  await expect.poll(dockWidth, { timeout: 5000 }).toBeGreaterThan(200)
  await expect(page.locator('button[aria-label="展开章节导航"]')).toBeVisible()

  await page.getByRole('button', { name: '原文参照' }).click()
  await expect.poll(dockWidth, { timeout: 5000 }).toBe(0)
  await expect(page.locator('aside')).toBeVisible()
})

test('窄屏下 dock 是浮层且带关闭按钮', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto(`/note/${taskId}`)
  await expect(page.locator('button[aria-label="展开章节导航"]')).toBeVisible()
  await page.getByRole('button', { name: '原文参照' }).click()
  // 窄屏是条件挂载的浮层，关掉就整个从 DOM 里消失，这里断言 hidden 是对的
  await expect(page.getByRole('tablist')).toBeVisible()
  await page.locator('button[aria-label="关闭参照面板"]').click()
  await expect(page.getByRole('tablist')).toBeHidden()
})
