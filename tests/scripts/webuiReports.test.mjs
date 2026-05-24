import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { buildEarningsReport } from '../../scripts/webui/reports.js'

const require = createRequire(import.meta.url)
const {
    appendEarningsRun,
    appendFailureSnapshot,
    earningsFile
} = require('../../earnings-report.cjs')

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-webui-reports-'))
}

async function writeAccounts(projectRoot, accounts) {
    const dir = path.join(projectRoot, 'config')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'accounts.json'), JSON.stringify(accounts, null, 4))
}

test('buildEarningsReport keeps old days compatibility and merges configured/history accounts', async () => {
    const projectRoot = await makeProjectRoot()
    await writeAccounts(projectRoot, [{ email: 'active@example.com', password: 'secret' }])

    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T01:00:00.000Z',
        runFinishedAt: '2026-04-24T01:04:00.000Z',
        accountStats: [{ email: 'deleted@example.com', collectedPoints: 9, duration: 10, success: true }]
    })

    const report = await buildEarningsReport(projectRoot, {
        days: 7,
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.equal(report.days, 7)
    assert.equal(report.window.range, '7d')
    assert.deepEqual(report.filters.accounts, ['active@example.com', 'deleted@example.com'])
    assert.equal(report.accounts[0].email, 'deleted@example.com')
    assert.equal(report.recentRuns[0].status, 'success')
})

test('buildEarningsReport tolerates malformed JSONL and keeps configured accounts in filters', async () => {
    const projectRoot = await makeProjectRoot()
    await writeAccounts(projectRoot, [{ email: 'active@example.com', password: 'secret' }])

    await fs.mkdir(path.dirname(earningsFile(projectRoot)), { recursive: true })
    await fs.writeFile(earningsFile(projectRoot), '{"bad":\nnot-json\n', 'utf8')

    const report = await buildEarningsReport(projectRoot, {
        range: 'today',
        timezoneOffsetMinutes: 0,
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.equal(report.totals.runs, 0)
    assert.deepEqual(report.filters.accounts, ['active@example.com'])
    assert.equal(report.failureBuckets.length, 6)
})

test('buildEarningsReport includes account health and recent failure snapshots', async () => {
    const projectRoot = await makeProjectRoot()
    await writeAccounts(projectRoot, [
        { email: 'ok@example.com', password: 'secret' },
        { email: 'bad@example.com', password: 'secret' }
    ])

    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-23T01:00:00.000Z',
        runFinishedAt: '2026-04-23T01:05:00.000Z',
        accountStats: [
            { email: 'ok@example.com', collectedPoints: 10, duration: 10, success: true },
            { email: 'bad@example.com', collectedPoints: 0, duration: 10, success: false, error: '登录失败' }
        ]
    })
    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T01:00:00.000Z',
        runFinishedAt: '2026-04-24T01:04:00.000Z',
        accountStats: [
            { email: 'bad@example.com', collectedPoints: 0, duration: 10, success: false, error: '风控暂停', riskControlStopped: true }
        ]
    })
    await appendFailureSnapshot(projectRoot, {
        runId: 'health-run',
        account: 'bad@example.com',
        stage: 'searches',
        error: '风控暂停',
        url: 'https://rewards.bing.com/',
        pageTitle: 'Rewards',
        riskControlStopped: true,
        capturedAt: '2026-04-24T01:04:00.000Z'
    })

    const report = await buildEarningsReport(projectRoot, {
        range: '7d',
        timezoneOffsetMinutes: 0,
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.equal(report.health.summary.attentionAccounts, 1)
    assert.equal(report.health.accounts[0].email, 'bad@example.com')
    assert.equal(report.health.accounts[0].level, 'risk')
    assert.equal(report.health.accounts[0].score < report.health.accounts[1].score, true)
    assert.match(report.health.accounts[0].suggestion, /暂停|人工/)
    assert.equal(report.failureSnapshots[0].account, 'bad@example.com')
    assert.equal(report.failureSnapshots[0].stage, 'searches')

    const scoped = await buildEarningsReport(projectRoot, {
        range: '7d',
        account: 'bad@example.com',
        timezoneOffsetMinutes: 0,
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.deepEqual(scoped.filters.accounts, ['bad@example.com', 'ok@example.com'])
    assert.deepEqual(scoped.health.accounts.map(item => item.email), ['bad@example.com'])
    assert.equal(scoped.failureSnapshots.length, 1)
})
