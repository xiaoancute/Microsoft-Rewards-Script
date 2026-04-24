import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    earningsFile,
    appendEarningsRun,
    readEarningsReport
} = require('../../earnings-report.cjs')

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-earnings-'))
}

test('appendEarningsRun writes a structured JSONL run record', async () => {
    const projectRoot = await makeProjectRoot()

    const record = await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T01:00:00.000Z',
        runFinishedAt: '2026-04-24T01:05:00.000Z',
        accountStats: [
            {
                email: 'ok@example.com',
                initialPoints: 100,
                finalPoints: 130,
                collectedPoints: 30,
                duration: 42.5,
                success: true
            },
            {
                email: 'bad@example.com',
                initialPoints: 0,
                finalPoints: 0,
                collectedPoints: 0,
                duration: 12,
                success: false,
                error: '流程失败'
            }
        ]
    })

    const content = await fs.readFile(earningsFile(projectRoot), 'utf8')
    const lines = content.trim().split('\n')

    assert.equal(lines.length, 1)
    assert.equal(record.totalCollectedPoints, 30)
    assert.equal(record.failedCount, 1)
    assert.equal(JSON.parse(lines[0]).accounts[1].error, '流程失败')
})

test('readEarningsReport aggregates days, accounts, failures, and risk stops', async () => {
    const projectRoot = await makeProjectRoot()

    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-22T01:00:00.000Z',
        runFinishedAt: '2026-04-22T01:04:00.000Z',
        accountStats: [{ email: 'old@example.com', collectedPoints: 99, duration: 1, success: true }]
    })
    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-23T01:00:00.000Z',
        runFinishedAt: '2026-04-23T01:04:00.000Z',
        accountStats: [
            { email: 'a@example.com', collectedPoints: 10, duration: 10, success: true },
            { email: 'b@example.com', collectedPoints: 0, duration: 8, success: false, error: '登录失败' }
        ]
    })
    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T01:00:00.000Z',
        runFinishedAt: '2026-04-24T01:03:00.000Z',
        riskControlStopped: true,
        accountStats: [{ email: 'a@example.com', collectedPoints: 20, duration: 9, success: true }]
    })

    const report = readEarningsReport(projectRoot, {
        days: 2,
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.equal(report.totals.runs, 2)
    assert.equal(report.totals.accounts, 3)
    assert.equal(report.totals.collectedPoints, 30)
    assert.equal(report.totals.failedAccounts, 1)
    assert.equal(report.totals.riskControlStops, 1)
    assert.equal(report.totals.successRate, 66.7)
    assert.deepEqual(report.daily.map(item => item.date), ['2026-04-23', '2026-04-24'])
    assert.equal(report.accounts.find(item => item.email === 'a@example.com').collectedPoints, 30)
    assert.equal(report.accounts.find(item => item.email === 'b@example.com').lastError, '登录失败')
})

test('readEarningsReport returns empty summary when no report exists', async () => {
    const projectRoot = await makeProjectRoot()
    const report = readEarningsReport(projectRoot, { days: 14 })

    assert.equal(report.days, 14)
    assert.equal(report.totals.runs, 0)
    assert.deepEqual(report.daily, [])
    assert.deepEqual(report.accounts, [])
})
