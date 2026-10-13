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
  await page.waitForTimeout(700)
  const after = await aside.locator('button[aria-current="location"]').getAttribute('title')
  expect(after).not.toBe(before)
})

test('打开参照 dock 时章节栏收竖条，关闭后恢复', async ({ page }) => {
  await page.goto(`/note/${taskId}`)
  await page.getByRole('button', { name: '原文参照' }).click()
  await expect(page.getByRole('tablist')).toBeVisible()
  await expect(page.locator('button[aria-label="展开章节导航"]')).toBeVisible()
  await page.getByRole('button', { name: '原文参照' }).click()
  await expect(page.getByRole('tablist')).toBeHidden()
  await expect(page.locator('aside')).toBeVisible()
})

test('窄屏下 dock 是浮层且带关闭按钮', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto(`/note/${taskId}`)
  await expect(page.locator('button[aria-label="展开章节导航"]')).toBeVisible()
  await page.getByRole('button', { name: '原文参照' }).click()
  await expect(page.getByRole('tablist')).toBeVisible()
  await page.locator('button[aria-label="关闭参照面板"]').click()
  await expect(page.getByRole('tablist')).toBeHidden()
})
