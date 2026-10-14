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

  // 面板组重挂载后也必须保持收起：切到思维导图再切回来会把整个 ResizablePanelGroup 卸掉重建。
  // "打开笔记时 dock 莫名展开"的根因就是首帧 status 还是 idle、面板组尚未挂载，
  // 那个 collapse() 打在 null ref 上等于没做，挂载后用的是写死的 defaultSize=38。
  // headless 里首屏时序碰巧走对（所以这条 bug 逃过了之前的测试），重挂载这条路是确定性的。
  await page.getByRole('button', { name: /思维导图/ }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /返回笔记|思维导图/ }).click()
  await expect.poll(dockWidth, { timeout: 5000 }).toBe(0)
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

test('生成中的流程页有返回书架的出口', async ({ page }) => {
  // 伪造一个"生成中"的任务：拦截笔记库与状态接口，不碰真实数据、也不会真跑一次生成。
  // 回归的是用户明确提的问题——流程页以前没有任何返回入口，人被卡在这一页只能刷新或按
  // 浏览器后退，很自然会以为任务没成功、回去再新建一次（同一视频就被生成两遍）。
  const fakeId = 'e2e11111-2222-4222-8222-222222222222'
  const now = Date.now()
  await page.route('**/api/library', route =>
    route.fulfill({
      json: {
        code: 0,
        msg: 'success',
        data: {
          folders: [],
          notes: [
            {
              task_id: fakeId,
              title: null,
              video_title: '生成中的测试任务',
              folder_id: null,
              status: 'PENDING',
              video_id: 'BV1test',
              platform: 'bilibili',
              cover_url: '',
              duration: 0,
              created_at: now,
              updated_at: now,
              last_opened_at: null,
              form_data: { video_url: 'https://www.bilibili.com/video/BV1test', platform: 'bilibili' },
            },
          ],
        },
      },
    }),
  )
  await page.route(`**/api/task_status/${fakeId}`, route =>
    route.fulfill({
      json: {
        code: 0,
        msg: 'success',
        data: { status: 'PENDING', message: '任务排队中', task_id: fakeId },
      },
    }),
  )

  await page.goto(`/note/${fakeId}`)
  await expect(page.getByText(/请稍候/)).toBeVisible({ timeout: 10000 })
  const back = page.getByRole('button', { name: '返回书架' })
  await expect(back).toBeVisible()
  await back.click()
  await expect(page).toHaveURL(/\/$/)
})
