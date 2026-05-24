import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import { chooseLogJobId, formatCurrentLogSourceLabel } from '../../scripts/webui/public/job-ui.js'

test('run log source label describes the single selected source clearly', async () => {
    assert.equal(
        formatCurrentLogSourceLabel({ id: 12, label: '立即运行', running: true }),
        '立即运行 · 运行中'
    )
    assert.equal(
        formatCurrentLogSourceLabel({ id: 11, label: '重新构建', running: false, exitCode: 0 }),
        '重新构建 · 已完成'
    )
    assert.equal(
        formatCurrentLogSourceLabel({ id: 10, label: '立即运行', running: false, exitCode: 1 }),
        '立即运行 · 异常退出'
    )
    assert.equal(formatCurrentLogSourceLabel(null), '当前任务日志')
})

test('run log view selects the active job or the latest job automatically', () => {
    const jobs = [
        { id: 1, label: '旧任务', running: false, exitCode: 0 },
        { id: 2, label: '最近任务', running: false, exitCode: 0 }
    ]

    assert.equal(chooseLogJobId(jobs), '2')
    assert.equal(chooseLogJobId([...jobs, { id: 3, label: '运行中', running: true }]), '3')
    assert.equal(chooseLogJobId([]), '')
})

test('run log panel exposes one automatic log source instead of a selector', async () => {
    const html = await fs.readFile(new URL('../../scripts/webui/public/index.html', import.meta.url), 'utf8')

    assert.match(html, /日志来源/)
    assert.match(html, /id="job-source-label"/)
    assert.match(html, /这里自动显示正在运行的后台任务日志/)
    assert.doesNotMatch(html, /id="job-filter"/)
    assert.doesNotMatch(html, /全部实时日志/)
    assert.doesNotMatch(html, /查看任务:/)
})
