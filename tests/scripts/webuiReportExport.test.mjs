import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
    buildEarningsExportCsvFiles,
    buildEarningsExportZip
} from '../../scripts/webui/reports.js'

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-webui-export-'))
}

async function writeAccounts(projectRoot, accounts) {
    const dir = path.join(projectRoot, 'config')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'accounts.json'), JSON.stringify(accounts, null, 4))
}

async function appendRun(projectRoot, run) {
    const reportFile = path.join(projectRoot, 'reports', 'earnings.jsonl')
    await fs.mkdir(path.dirname(reportFile), { recursive: true })
    await fs.appendFile(reportFile, `${JSON.stringify(run)}\n`, 'utf8')
}

function parseCsv(content) {
    const text = content.toString('utf8').replace(/^\ufeff/, '')
    return text.trimEnd().split('\r\n')
}

test('buildEarningsExportCsvFiles converts the current filtered report into three CSV files', async () => {
    const projectRoot = await makeProjectRoot()
    await writeAccounts(projectRoot, [{ email: 'active@example.com', password: 'secret' }])

    await appendRun(projectRoot, {
        runId: 'run-1',
        date: '2026-04-24',
        startedAt: '2026-04-24T01:00:00.000Z',
        finishedAt: '2026-04-24T01:02:00.000Z',
        accountCount: 2,
        totalCollectedPoints: 12,
        totalDuration: 15,
        successCount: 1,
        failedCount: 1,
        hadWorkerFailure: false,
        riskControlStopped: false,
        accounts: [
            {
                email: 'active@example.com',
                collectedPoints: 12,
                duration: 10,
                success: true
            },
            {
                email: 'other@example.com',
                collectedPoints: 0,
                duration: 5,
                success: false,
                error: '登录失败, 提示 "验证码错误"\n请重试'
            }
        ]
    })
    await appendRun(projectRoot, {
        runId: 'run-2',
        date: '2026-04-25',
        startedAt: '2026-04-25T01:00:00.000Z',
        finishedAt: '2026-04-25T01:03:00.000Z',
        accountCount: 1,
        totalCollectedPoints: 0,
        totalDuration: 12,
        successCount: 0,
        failedCount: 1,
        hadWorkerFailure: false,
        riskControlStopped: true,
        accounts: [
            {
                email: 'active@example.com',
                collectedPoints: 0,
                duration: 12,
                success: false,
                error: '命中风控, 暂停',
                riskControlStopped: true
            }
        ]
    })

    const files = await buildEarningsExportCsvFiles(projectRoot, {
        range: '7d',
        account: 'active@example.com',
        timezoneOffsetMinutes: 0,
        now: '2026-04-25T12:00:00.000Z'
    })

    assert.deepEqual(files.map(item => item.name), ['daily.csv', 'accounts.csv', 'runs.csv'])
    files.forEach(file => {
        assert.equal(file.content[0], 0xef)
        assert.equal(file.content[1], 0xbb)
        assert.equal(file.content[2], 0xbf)
    })

    const dailyLines = parseCsv(files[0].content)
    const accountLines = parseCsv(files[1].content)
    const runLines = parseCsv(files[2].content)

    assert.equal(dailyLines[0], 'date,runs,accounts,collected_points,success_count,failed_count,risk_control_stops,total_duration_seconds')
    assert.ok(dailyLines.some(line => line.includes('2026-04-24,1,1,12,1,0,0,10')))
    assert.ok(dailyLines.some(line => line.includes('2026-04-25,1,1,0,0,1,1,12')))

    assert.equal(accountLines[0], 'email,runs,collected_points,success_count,failed_count,risk_control_stops,total_duration_seconds,last_status,consecutive_failures,last_success_at,last_failure_at,last_run_at,primary_failure_bucket,last_error')
    assert.ok(accountLines.some(line => line.includes('active@example.com,2,12,1,1,1,22,risk_control,1,2026-04-24T01:02:00.000Z,2026-04-25T01:03:00.000Z,2026-04-25T01:03:00.000Z,risk_control,"命中风控, 暂停"')))

    assert.equal(runLines[0], 'started_at,finished_at,date,account_count,collected_points,success_count,failed_count,risk_control_stopped,status,total_duration_seconds')
    assert.ok(runLines.some(line => line.includes('2026-04-24T01:00:00.000Z,2026-04-24T01:02:00.000Z,2026-04-24,1,12,1,0,false,success,10')))
    assert.ok(runLines.some(line => line.includes('2026-04-25T01:00:00.000Z,2026-04-25T01:03:00.000Z,2026-04-25,1,0,0,1,true,risk_control,12')))
})

test('buildEarningsExportCsvFiles returns header-only files for empty ranges', async () => {
    const projectRoot = await makeProjectRoot()
    await writeAccounts(projectRoot, [{ email: 'active@example.com', password: 'secret' }])

    const files = await buildEarningsExportCsvFiles(projectRoot, {
        range: 'today',
        account: 'active@example.com',
        timezoneOffsetMinutes: 0,
        now: '2026-04-25T12:00:00.000Z'
    })

    assert.equal(parseCsv(files[0].content).length, 1)
    assert.equal(parseCsv(files[1].content).length, 1)
    assert.equal(parseCsv(files[2].content).length, 1)
})

test('buildEarningsExportZip returns zip metadata and the expected CSV entry names', async () => {
    const projectRoot = await makeProjectRoot()
    await writeAccounts(projectRoot, [{ email: 'active@example.com', password: 'secret' }])
    await appendRun(projectRoot, {
        runId: 'run-1',
        date: '2026-04-25',
        startedAt: '2026-04-25T01:00:00.000Z',
        finishedAt: '2026-04-25T01:01:00.000Z',
        accountCount: 1,
        totalCollectedPoints: 8,
        totalDuration: 4,
        successCount: 1,
        failedCount: 0,
        hadWorkerFailure: false,
        riskControlStopped: false,
        accounts: [
            {
                email: 'active@example.com',
                collectedPoints: 8,
                duration: 4,
                success: true
            }
        ]
    })

    const exportPayload = await buildEarningsExportZip(projectRoot, {
        range: 'today',
        account: 'all',
        timezoneOffsetMinutes: 0,
        now: '2026-04-25T12:00:00.000Z'
    })

    assert.equal(exportPayload.contentType, 'application/zip')
    assert.equal(exportPayload.filename, 'earnings-report-2026-04-25-to-2026-04-25-all-accounts.zip')
    assert.ok(Buffer.isBuffer(exportPayload.body))
    assert.ok(exportPayload.body.includes(Buffer.from('daily.csv')))
    assert.ok(exportPayload.body.includes(Buffer.from('accounts.csv')))
    assert.ok(exportPayload.body.includes(Buffer.from('runs.csv')))
})
