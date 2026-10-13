import { test, expect } from '@playwright/test'

test('书架页渲染卡片与新建入口', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建笔记' })).toBeVisible()
  await expect(page.getByRole('button', { name: /全部/ })).toBeVisible()
})

test('新建文件夹对话框可开可关', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建文件夹' }).click()
  const dialog = page.locator('[data-slot="dialog-content"][data-state="open"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('列表/卡片视图切换', async ({ page }) => {
  await page.goto('/')
  await page.locator('button[aria-label="列表视图"]').click()
  await expect(page.locator('main img.h-12').first()).toBeVisible()
  await page.locator('button[aria-label="卡片视图"]').click()
  await expect(page.locator('main .aspect-video').first()).toBeVisible()
})

test('卡片 ⋯ 菜单不被卡片裁掉，删除项看得到也点得到', async ({ page }) => {
  // 回归：书架卡片是 overflow-hidden，菜单以前用 absolute 挂在卡片内部 → 整个下拉被裁掉，
  // 「删除笔记」正好在被裁掉的部分，用户在界面上根本看不到（真实报障）。
  const res = await page.request.get('/api/library')
  const notes = ((await res.json()).data.notes || []).filter((n: any) => n.status === 'SUCCESS')
  test.skip(!notes.length, '没有笔记数据')
  const title = notes[0].title || notes[0].video_title

  await page.goto('/')
  const card = page.locator('main div.group', { hasText: title }).first()
  // 卡片菜单的 aria-label 是「{标题} 的操作」，用 aria-haspopup 定位更稳
  await card.locator('button[aria-haspopup="menu"]').click()

  const item = page.getByRole('menuitem', { name: '删除笔记' })
  await expect(item).toBeVisible()
  await item.scrollIntoViewIfNeeded()
  const box = await item.boundingBox()
  expect(box, '菜单项没有布局位置').not.toBeNull()
  const viewport = page.viewportSize()!
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height, '菜单项超出视口下沿').toBeLessThanOrEqual(viewport.height)

  // 中心点上最顶层的元素必须还在菜单里：被祖先 overflow 裁掉时命中的会是卡片
  const hit = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      return el ? (el.closest('[role="menu"]') ? 'menu' : `not-menu:${el.tagName}`) : 'none'
    },
    [box!.x + box!.width / 2, box!.y + box!.height / 2],
  )
  expect(hit).toBe('menu')

  // 真的能点：打开删除确认框，然后取消（不真删用户数据）
  await item.click()
  await expect(page.getByText('删除这篇笔记？')).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByText('删除这篇笔记？')).toBeHidden()
})

test('新建笔记双击也只发一次提交请求', async ({ page }) => {
  // 拦截提交：既数得清发了几次，又不会真启动一次生成（那要烧 API 额度、跑好几分钟）。
  // 回归的是真实事故：一次点击发出两个相差 0.5ms 的请求 → 后端并发跑两份下载 →
  // 其中一份 rename .part 失败 → 书架上多一条"生成失败"，用户以为没成功又点一次。
  const posts: unknown[] = []
  await page.route('**/api/generate_note', async route => {
    posts.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'success',
        data: { task_id: 'e2e00000-1111-4111-8111-111111111111' },
      }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '新建笔记' }).click()
  const dialog = page.locator('[data-slot="dialog-content"][data-state="open"]')
  await expect(dialog).toBeVisible()
  await dialog
    .getByPlaceholder('请输入视频网站链接')
    .fill('https://www.bilibili.com/video/BV1e2e000E2gQ')

  const submit = dialog.getByRole('button', { name: /生成笔记/ })
  await expect(submit).toBeEnabled()
  // 双击 = 用户着急时的真实行为。防重锁必须是同步的 ref：react-hook-form 的校验是异步的，
  // 靠 setState 上锁的话第二次点击会赶在重渲染之前溜进去
  await submit.dblclick()
  await page.waitForTimeout(2000)

  if (posts.length === 0) {
    // 一次都没发出去 = 卡在校验或前端异常，把对话框现状打出来，否则只看到 0 != 1 没法定位
    const text = (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 700)
    throw new Error(`没有发出提交请求。对话框内容：${text}`)
  }
  expect(posts.length, `双击发出了 ${posts.length} 次提交请求`).toBe(1)

  // 提交完留在书架（不把人锁进流程页），并且立刻多出一张"生成中"的卡片
  await expect(page).toHaveURL(/\/$/)
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/排队中|生成中/).first()).toBeVisible({ timeout: 8000 })
})
