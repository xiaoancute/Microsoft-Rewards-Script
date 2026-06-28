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
    readEarningsReport,
    earningsCheckpointFile,
    failureSnapshotsFile,
    writeEarningsCheckpoint,
    recoverEarningsCheckpoint,
    appendFailureSnapshot,
    readFailureSnapshots,
    taskDiscoveryFile,
    appendTaskDiscoverySamples
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
                success: true,
                taskStats: [
                    {
                        key: 'daily-set',
                        label: '每日任务',
                        status: 'success',
                        initialPoints: 100,
                        finalPoints: 110,
                        collectedPoints: 10,
                        duration: 3.5
                    },
                    {
                        key: 'searches',
                        label: '搜索',
                        status: 'success',
                        initialPoints: 110,
                        finalPoints: 130,
                        collectedPoints: 20,
                        duration: 39
                    }
                ]
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
    assert.equal(JSON.parse(lines[0]).accounts[0].taskStats[0].key, 'daily-set')
    assert.equal(JSON.parse(lines[0]).accounts[0].taskStats[1].collectedPoints, 20)
})

test('appendTaskDiscoverySamples writes only unknown task samples', async () => {
    const projectRoot = await makeProjectRoot()

    const records = await appendTaskDiscoverySamples(projectRoot, {
        account: 'unknown@example.com',
        geoLocale: 'us',
        capturedAt: '2026-06-28T01:00:00.000Z',
        tasks: [
            {
                source: 'dashboard',
                kind: 'more-promotion',
                title: 'Mystery, "quoted"',
                offerId: 'offer-1',
                points: 0,
                decision: 'unknown',
                reason: 'unsupported-promotion-type'
            },
            {
                source: 'dashboard',
                kind: 'daily-set',
                title: 'Known',
                offerId: 'offer-2',
                points: 10,
                decision: 'auto',
                reason: 'auto-executable'
            }
        ]
    })

    const lines = (await fs.readFile(taskDiscoveryFile(projectRoot), 'utf8')).trim().split('\n')

    assert.equal(records.length, 1)
    assert.equal(lines.length, 1)
    assert.deepEqual(JSON.parse(lines[0]), {
        schemaVersion: 1,
        account: 'unknown@example.com',
        geoLocale: 'us',
        source: 'dashboard',
        kind: 'more-promotion',
        title: 'Mystery, "quoted"',
        offerId: 'offer-1',
        points: 0,
        reason: 'unsupported-promotion-type',
        capturedAt: '2026-06-28T01:00:00.000Z'
    })
})

test('readEarningsReport aggregates task-level earning summaries', async () => {
    const projectRoot = await makeProjectRoot()

    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T01:00:00.000Z',
        runFinishedAt: '2026-04-24T01:05:00.000Z',
        accountStats: [
            {
                email: 'ok@example.com',
                initialPoints: 100,
                finalPoints: 135,
                collectedPoints: 35,
                duration: 60,
                success: true,
                taskStats: [
                    {
                        key: 'daily-set',
                        label: '每日任务',
                        status: 'success',
                        initialPoints: 100,
                        finalPoints: 110,
                        collectedPoints: 10,
                        duration: 10
                    },
                    {
                        key: 'searches',
                        label: '搜索',
                        status: 'success',
                        initialPoints: 110,
                        finalPoints: 135,
                        collectedPoints: 25,
                        duration: 50
                    }
                ]
            },
            {
                email: 'bad@example.com',
                initialPoints: 50,
                finalPoints: 50,
                collectedPoints: 0,
                duration: 20,
                success: false,
                error: '搜索失败',
                taskStats: [
                    {
                        key: 'searches',
                        label: '搜索',
                        status: 'failed',
                        initialPoints: 50,
                        finalPoints: 50,
                        collectedPoints: 0,
                        duration: 20,
                        error: '搜索失败'
                    }
                ]
            }
        ]
    })

    const report = readEarningsReport(projectRoot, {
        range: 'today',
        timezoneOffsetMinutes: 0,
        now: '2026-04-24T12:00:00.000Z'
    })

    const dailySet = report.taskSummary.find(item => item.key === 'daily-set')
    const searches = report.taskSummary.find(item => item.key === 'searches')

    assert.equal(dailySet.collectedPoints, 10)
    assert.equal(dailySet.successCount, 1)
    assert.equal(dailySet.failedCount, 0)
    assert.equal(searches.collectedPoints, 25)
    assert.equal(searches.successCount, 1)
    assert.equal(searches.failedCount, 1)
    assert.equal(searches.accountCount, 2)
})

test('appendFailureSnapshot writes redacted lightweight failure context', async () => {
    const projectRoot = await makeProjectRoot()

    const snapshot = await appendFailureSnapshot(projectRoot, {
        runId: 'run-secret',
        account: 'bad@example.com',
        stage: 'login',
        error: 'OAuth failed with access_token=SECRET_TOKEN',
        url: 'https://login.live.com/oauth20?code=SECRET_CODE&state=ok',
        pageTitle: '登录页',
        riskControlStopped: false,
        capturedAt: '2026-04-24T01:02:00.000Z'
    })

    const content = await fs.readFile(failureSnapshotsFile(projectRoot), 'utf8')
    const snapshots = readFailureSnapshots(projectRoot)

    assert.equal(snapshot.account, 'bad@example.com')
    assert.equal(snapshot.failureBucket, 'login')
    assert.equal(content.includes('SECRET_TOKEN'), false)
    assert.equal(content.includes('SECRET_CODE'), false)
    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0].url, 'https://login.live.com/oauth20?code=[REDACTED]&state=ok')
    assert.equal(snapshots[0].error, 'OAuth failed with access_token=[REDACTED]')
})

test('recoverEarningsCheckpoint appends interrupted completed accounts once', async () => {
    const projectRoot = await makeProjectRoot()

    await writeEarningsCheckpoint(projectRoot, {
        runId: 'interrupted-run-1',
        runStartedAt: '2026-04-24T01:00:00.000Z',
        updatedAt: '2026-04-24T01:03:00.000Z',
        accountStats: [
            {
                email: 'done@example.com',
                initialPoints: 100,
                finalPoints: 140,
                collectedPoints: 40,
                duration: 60,
                success: true
            }
        ],
        reason: 'SIGTERM',
        hadWorkerFailure: true
    })

    const recovered = await recoverEarningsCheckpoint(projectRoot)
    const content = await fs.readFile(earningsFile(projectRoot), 'utf8')
    const lines = content.trim().split('\n')

    assert.equal(recovered.recovered, true)
    assert.equal(lines.length, 1)
    assert.equal(JSON.parse(lines[0]).runId, 'interrupted-run-1')
    assert.equal(JSON.parse(lines[0]).hadWorkerFailure, true)
    await assert.rejects(() => fs.stat(earningsCheckpointFile(projectRoot)), /ENOENT/)
})

test('recoverEarningsCheckpoint clears already recorded checkpoints without duplicating', async () => {
    const projectRoot = await makeProjectRoot()

    await appendEarningsRun(projectRoot, {
        runId: 'already-recorded-run',
        runStartedAt: '2026-04-24T01:00:00.000Z',
        runFinishedAt: '2026-04-24T01:03:00.000Z',
        accountStats: [{ email: 'done@example.com', collectedPoints: 10, duration: 10, success: true }]
    })
    await writeEarningsCheckpoint(projectRoot, {
        runId: 'already-recorded-run',
        runStartedAt: '2026-04-24T01:00:00.000Z',
        updatedAt: '2026-04-24T01:04:00.000Z',
        accountStats: [{ email: 'done@example.com', collectedPoints: 10, duration: 10, success: true }]
    })

    const recovered = await recoverEarningsCheckpoint(projectRoot)
    const content = await fs.readFile(earningsFile(projectRoot), 'utf8')

    assert.equal(recovered.recovered, false)
    assert.equal(content.trim().split('\n').length, 1)
    await assert.rejects(() => fs.stat(earningsCheckpointFile(projectRoot)), /ENOENT/)
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

test('readEarningsReport supports local-day windows and timezone-aware today range', async () => {
    const projectRoot = await makeProjectRoot()

    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-23T15:30:00.000Z',
        runFinishedAt: '2026-04-23T15:33:00.000Z',
        accountStats: [{ email: 'before@example.com', collectedPoints: 3, duration: 5, success: true }]
    })
    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-23T16:30:00.000Z',
        runFinishedAt: '2026-04-23T16:35:00.000Z',
        accountStats: [{ email: 'edge@example.com', collectedPoints: 7, duration: 6, success: true }]
    })
    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T01:10:00.000Z',
        runFinishedAt: '2026-04-24T01:14:00.000Z',
        accountStats: [{ email: 'edge@example.com', collectedPoints: 10, duration: 8, success: true }]
    })

    const localToday = readEarningsReport(projectRoot, {
        range: 'today',
        timezoneOffsetMinutes: -480,
        now: '2026-04-24T12:00:00.000Z'
    })
    const utcToday = readEarningsReport(projectRoot, {
        range: 'today',
        timezoneOffsetMinutes: 0,
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.equal(localToday.window.range, 'today')
    assert.equal(localToday.window.startDate, '2026-04-24')
    assert.equal(localToday.window.endDate, '2026-04-24')
    assert.equal(localToday.totals.runs, 2)
    assert.equal(localToday.totals.accounts, 2)
    assert.equal(localToday.totals.collectedPoints, 17)
    assert.equal(localToday.daily.length, 1)
    assert.equal(localToday.daily[0].date, '2026-04-24')
    assert.equal(localToday.daily[0].runs, 2)

    assert.equal(utcToday.totals.runs, 1)
    assert.equal(utcToday.totals.accounts, 1)
    assert.equal(utcToday.totals.collectedPoints, 10)
})

test('readEarningsReport supports account-scoped summaries, filled daily rows, and failure buckets', async () => {
    const projectRoot = await makeProjectRoot()

    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-22T00:20:00.000Z',
        runFinishedAt: '2026-04-22T00:25:00.000Z',
        accountStats: [
            { email: 'a@example.com', collectedPoints: 12, duration: 11, success: true },
            { email: 'b@example.com', collectedPoints: 5, duration: 8, success: true }
        ]
    })
    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-23T00:20:00.000Z',
        runFinishedAt: '2026-04-23T00:25:00.000Z',
        accountStats: [
            { email: 'a@example.com', collectedPoints: 0, duration: 9, success: false, error: '登录失败' },
            { email: 'b@example.com', collectedPoints: 0, duration: 7, success: false, error: 'connect ETIMEDOUT proxy' }
        ]
    })
    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T00:20:00.000Z',
        runFinishedAt: '2026-04-24T00:23:00.000Z',
        riskControlStopped: true,
        accountStats: [
            {
                email: 'a@example.com',
                collectedPoints: 0,
                duration: 6,
                success: false,
                error: '命中风控暂停',
                riskControlStopped: true
            },
            { email: 'c@example.com', collectedPoints: 4, duration: 5, success: true }
        ]
    })

    const report = readEarningsReport(projectRoot, {
        range: '7d',
        account: 'a@example.com',
        timezoneOffsetMinutes: 0,
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.equal(report.days, 7)
    assert.equal(report.window.range, '7d')
    assert.equal(report.window.startDate, '2026-04-18')
    assert.equal(report.window.endDate, '2026-04-24')
    assert.equal(report.daily.length, 7)
    assert.deepEqual(report.daily.map(item => item.date), [
        '2026-04-18',
        '2026-04-19',
        '2026-04-20',
        '2026-04-21',
        '2026-04-22',
        '2026-04-23',
        '2026-04-24'
    ])
    assert.equal(report.totals.runs, 3)
    assert.equal(report.totals.accounts, 3)
    assert.equal(report.totals.collectedPoints, 12)
    assert.equal(report.totals.failedAccounts, 2)
    assert.equal(report.totals.riskControlStops, 1)
    assert.equal(report.totals.successRate, 33.3)
    assert.equal(report.totals.totalDuration, 26)

    assert.equal(report.accounts.length, 1)
    assert.equal(report.accounts[0].email, 'a@example.com')
    assert.equal(report.accounts[0].lastStatus, 'risk_control')
    assert.equal(report.accounts[0].consecutiveFailures, 2)
    assert.equal(report.accounts[0].lastSuccessAt, '2026-04-22T00:25:00.000Z')
    assert.equal(report.accounts[0].lastFailureAt, '2026-04-24T00:23:00.000Z')
    assert.equal(report.accounts[0].primaryFailureBucket, 'risk_control')
    assert.equal(report.accounts[0].lastError, '命中风控暂停')

    assert.deepEqual(report.recentRuns.map(item => item.status), ['risk_control', 'failed', 'success'])
    assert.deepEqual(report.recentRuns.map(item => item.accountCount), [1, 1, 1])

    const bucketMap = Object.fromEntries(report.failureBuckets.map(item => [item.key, item]))
    assert.equal(bucketMap.risk_control.count, 1)
    assert.equal(bucketMap.risk_control.accountCount, 1)
    assert.equal(bucketMap.login.count, 1)
    assert.equal(bucketMap.login.accountCount, 1)
    assert.equal(bucketMap.network.count, 0)
})

test('readEarningsReport returns empty summary when no report exists', async () => {
    const projectRoot = await makeProjectRoot()
    const report = readEarningsReport(projectRoot, { days: 14, now: '2026-04-24T12:00:00.000Z' })

    assert.equal(report.days, 14)
    assert.equal(report.totals.runs, 0)
    assert.equal(report.daily.length, 14)
    assert.equal(report.daily[0].date, '2026-04-11')
    assert.equal(report.daily[13].date, '2026-04-24')
    assert.deepEqual(report.accounts, [])
    assert.equal(report.window.startDate, '2026-04-11')
    assert.equal(report.window.endDate, '2026-04-24')
    assert.equal(report.failureBuckets.length, 6)
})
