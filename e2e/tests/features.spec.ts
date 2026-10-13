import { test, expect } from '@playwright/test'

// 覆盖 V3.2/V3.3 的交互项。依赖真实数据的地方都先取 /api/library，没数据就 skip。
let taskId = ''
let title = ''

test.beforeAll(async ({ request }) => {
  const res = await request.get('/api/library')
  const notes = (await res.json()).data.notes
  if (notes.length) {
    taskId = notes[0].task_id
    title = notes[0].title || notes[0].video_title || ''
  }
})

test('设置→存储与清理页能扫描并列出占用', async ({ page }) => {
  await page.goto('/settings/storage')
  // 左侧导航里也有"存储与清理"这一项，不限定 main 会撞 strict mode
  await expect(page.getByRole('main').getByText('存储与清理')).toBeVisible()
  await expect(page.getByText('截图目录')).toBeVisible()
  await expect(page.getByText('AI 问答向量索引')).toBeVisible()
  // 孤儿区要么是清单要么是"很干净"
  await expect(page.getByText(/孤儿截图（\d+）|没有孤儿截图/).first()).toBeVisible()
})

test('书架正文搜索命中并可跳转', async ({ page }) => {
  test.skip(!taskId, '没有笔记数据')
  await page.goto('/')
  await page.fill('input[placeholder="搜索全部笔记…"]', '基期')
  await expect(page.getByText(/正文命中 \d+ 条/)).toBeVisible({ timeout: 8000 })
  await page.getByText(/正文命中 \d+ 条/).locator('..').getByRole('button').first().click()
  await expect(page).toHaveURL(/\/note\//)
  await expect(page.locator('.markdown-body')).toBeVisible()
})

test('排序偏好持久化', async ({ page }) => {
  await page.goto('/')
  await page.locator('button[aria-label="排序方式"]').click()
  await page.getByRole('menuitem', { name: '时长最长' }).click()
  await page.reload()
  await expect(page.locator('button[aria-label="排序方式"]')).toContainText('时长最长')
  // 还原，别把用户的偏好留在测试状态里
  await page.locator('button[aria-label="排序方式"]').click()
  await page.getByRole('menuitem', { name: '最新创建' }).click()
})

test('顶栏直接可见编辑/思维导图/收起全部', async ({ page }) => {
  test.skip(!taskId, '没有笔记数据')
  await page.goto(`/note/${taskId}`)
  await expect(page.getByRole('button', { name: /^编辑/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /思维导图|返回笔记/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /收起全部|展开全部/ })).toBeVisible()
})

test('复制视频链接会出 toast', async ({ context, page }) => {
  test.skip(!taskId, '没有笔记数据')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/note/${taskId}`)
  await page.locator('button[aria-label="更多操作"]').click()
  await page.getByRole('menuitem', { name: '复制视频链接' }).click()
  await expect(page.getByText('已复制视频链接')).toBeVisible({ timeout: 5000 })
})

test('导出 HTML 触发下载', async ({ page }) => {
  test.skip(!taskId, '没有笔记数据')
  await page.goto(`/note/${taskId}`)
  await page.locator('button[aria-label="更多操作"]').click()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.getByRole('menuitem', { name: /导出 HTML/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.html$/)
})

test('点转写行会把正文滚到对应章节', async ({ page }) => {
  test.skip(!taskId, '没有笔记数据')
  await page.goto(`/note/${taskId}`)
  await page.getByRole('button', { name: '原文参照' }).click()
  await expect(page.getByRole('tablist')).toBeVisible()
  const vp = page.locator('[data-radix-scroll-area-viewport]').first()
  const before = await vp.evaluate(el => el.scrollTop)
  // 点第 30 行转写（足够靠后，对应正文中后段章节）
  await page.getByRole('tabpanel').locator('div.grid').nth(30).click()
  await page.waitForTimeout(1200)
  const after = await vp.evaluate(el => el.scrollTop)
  expect(after).toBeGreaterThan(before)
})
