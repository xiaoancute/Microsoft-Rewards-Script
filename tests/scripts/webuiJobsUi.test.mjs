import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import { chooseDefaultJobId, formatJobOptionLabel } from '../../scripts/webui/public/job-ui.js'

test('run log job filter labels describe log sources clearly', async () => {
    assert.equal(
        formatJobOptionLabel({ id: 12, label: '立即运行', running: true }),
        '立即运行 · 运行中'
    )
    assert.equal(
        formatJobOptionLabel({ id: 11, label: '重新构建', running: false, exitCode: 0 }),
        '重新构建 · 已完成'
    )
    assert.equal(
        formatJobOptionLabel({ id: 10, label: '立即运行', running: false, exitCode: 1 }),
        '立即运行 · 异常退出'
    )
})

test('run log job filter defaults to the active job or the latest job', () => {
    const jobs = [
        { id: 1, label: '旧任务', running: false, exitCode: 0 },
        { id: 2, label: '最近任务', running: false, exitCode: 0 }
    ]

    assert.equal(chooseDefaultJobId(jobs, ''), '2')
    assert.equal(chooseDefaultJobId([...jobs, { id: 3, label: '运行中', running: true }], ''), '3')
    assert.equal(chooseDefaultJobId(jobs, '1'), '1')
    assert.equal(chooseDefaultJobId(jobs, 'missing'), '2')
    assert.equal(chooseDefaultJobId([], ''), '')
})

test('run log panel copy distinguishes WebUI jobs from reward tasks', async () => {
    const html = await fs.readFile(new URL('../../scripts/webui/public/index.html', import.meta.url), 'utf8')

    assert.match(html, /日志来源/)
    assert.match(html, /全部实时日志/)
    assert.match(html, /这里查看的是 WebUI 启动的后台任务日志/)
    assert.doesNotMatch(html, /查看任务:/)
})
