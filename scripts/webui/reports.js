import { createRequire } from 'module'

import { listAccounts } from './api.js'

const require = createRequire(import.meta.url)
const {
    readEarningsReport,
    listHistoricalAccounts,
    readFailureSnapshots
} = require('../../earnings-report.cjs')
const { ZipFile } = require('yazl')

function uniqueSortedEmails(values) {
    return Array.from(
        new Set(
            values
                .map(value => String(value || '').trim())
                .filter(Boolean)
        )
    ).sort((a, b) => a.localeCompare(b))
}

function configuredAccountEmails(projectRoot) {
    try {
        return listAccounts(projectRoot).map(item => item?.email).filter(Boolean)
    } catch {
        return []
    }
}

export function buildEarningsReport(projectRoot, options = {}) {
    const report = readEarningsReport(projectRoot, options)
    const allAccountEmails = uniqueSortedEmails([
        ...configuredAccountEmails(projectRoot),
        ...listHistoricalAccounts(projectRoot)
    ])
    const scopedAccount = options.account && options.account !== 'all' ? String(options.account) : null
    const accountEmails = scopedAccount ? allAccountEmails.filter(email => email.toLowerCase() === scopedAccount.toLowerCase()) : allAccountEmails
    const filters = {
        accounts: allAccountEmails
    }
    const failureSnapshots = filterSnapshotsForReportWindow(
        readFailureSnapshots(projectRoot, {
            account: options.account || 'all',
            limit: 200
        }),
        report.window
    ).slice(0, 20)

    return {
        ...report,
        filters,
        health: buildAccountHealth(report, accountEmails),
        failureSnapshots
    }
}

function filterSnapshotsForReportWindow(snapshots, window) {
    if (!window?.startDate || !window?.endDate) return snapshots
    const offset = Number(window.timezoneOffsetMinutes) || 0
    return snapshots.filter(item => {
        const capturedAtMs = new Date(item.capturedAt).getTime()
        if (!Number.isFinite(capturedAtMs)) return false
        const localDay = new Date(capturedAtMs - offset * 60 * 1000).toISOString().slice(0, 10)
        return localDay >= window.startDate && localDay <= window.endDate
    })
}

function buildAccountHealth(report, accountEmails) {
    const byEmail = new Map((report.accounts || []).map(item => [item.email.toLowerCase(), item]))
    const accounts = accountEmails.map(email => {
        const item = byEmail.get(email.toLowerCase())
        if (!item) {
            return {
                email,
                level: 'unknown',
                score: 50,
                status: 'no_data',
                consecutiveFailures: 0,
                lastRunAt: null,
                lastSuccessAt: null,
                lastFailureAt: null,
                primaryFailureBucket: null,
                lastError: null,
                suggestion: '当前范围内没有运行记录，建议先完整运行一次。'
            }
        }

        const risk = item.lastStatus === 'risk_control'
        const failing = risk || (item.consecutiveFailures || 0) > 0
        const score = Math.max(
            0,
            100 -
                (risk ? 60 : 0) -
                Math.min(45, (item.consecutiveFailures || 0) * 15) -
                Math.min(20, (item.riskControlStops || 0) * 10)
        )

        return {
            email,
            level: risk ? 'risk' : failing ? 'warning' : 'healthy',
            score,
            status: item.lastStatus || 'success',
            consecutiveFailures: item.consecutiveFailures || 0,
            lastRunAt: item.lastRunAt || null,
            lastSuccessAt: item.lastSuccessAt || null,
            lastFailureAt: item.lastFailureAt || null,
            primaryFailureBucket: item.primaryFailureBucket || null,
            lastError: item.lastError || null,
            suggestion: healthSuggestion(item)
        }
    })

    accounts.sort((a, b) =>
        Number(b.level === 'risk') - Number(a.level === 'risk') ||
        Number(b.level === 'warning') - Number(a.level === 'warning') ||
        a.score - b.score ||
        a.email.localeCompare(b.email)
    )

    return {
        summary: {
            totalAccounts: accounts.length,
            healthyAccounts: accounts.filter(item => item.level === 'healthy').length,
            attentionAccounts: accounts.filter(item => item.level === 'risk' || item.level === 'warning').length,
            unknownAccounts: accounts.filter(item => item.level === 'unknown').length
        },
        accounts
    }
}

function healthSuggestion(item) {
    if (item.lastStatus === 'risk_control' || item.primaryFailureBucket === 'risk_control') {
        return '建议暂停该账号，人工检查 Rewards 页面和搜索限制后再恢复运行。'
    }
    if ((item.consecutiveFailures || 0) >= 2) {
        return '建议先检查登录会话、代理和最近失败现场，确认后再继续自动运行。'
    }
    if (item.primaryFailureBucket === 'login' || item.primaryFailureBucket === 'session') {
        return '建议重新打开浏览器确认登录状态，必要时刷新 session。'
    }
    if (item.primaryFailureBucket === 'network') {
        return '建议检查代理、DNS 或服务器网络稳定性。'
    }
    if ((item.consecutiveFailures || 0) > 0) {
        return '建议观察下一次运行，如继续失败再处理。'
    }
    return '近期运行正常，保持当前配置。'
}

function csvEscape(value) {
    const normalized = value === undefined || value === null ? '' : String(value)
    if (/[",\r\n]/.test(normalized)) {
        return `"${normalized.replace(/"/g, '""')}"`
    }
    return normalized
}

function toCsvBuffer(headers, rows) {
    const lines = [
        headers.join(','),
        ...rows.map(row => row.map(csvEscape).join(','))
    ]
    return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8')
}

function sanitizeFilenamePart(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'all-accounts'
}

function filenameForReport(report, account) {
    const accountPart = account && account !== 'all' ? sanitizeFilenamePart(account) : 'all-accounts'
    return `earnings-report-${report.window.startDate}-to-${report.window.endDate}-${accountPart}.zip`
}

function buildEarningsExportData(projectRoot, options = {}) {
    const report = buildEarningsReport(projectRoot, options)
    const dailyRows = (report.totals?.runs || 0) === 0 ? [] : (report.daily || [])

    const dailyHeaders = [
        'date',
        'runs',
        'accounts',
        'collected_points',
        'success_count',
        'failed_count',
        'risk_control_stops',
        'total_duration_seconds'
    ]
    const accountsHeaders = [
        'email',
        'runs',
        'collected_points',
        'success_count',
        'failed_count',
        'risk_control_stops',
        'total_duration_seconds',
        'last_status',
        'consecutive_failures',
        'last_success_at',
        'last_failure_at',
        'last_run_at',
        'primary_failure_bucket',
        'last_error'
    ]
    const runsHeaders = [
        'started_at',
        'finished_at',
        'date',
        'account_count',
        'collected_points',
        'success_count',
        'failed_count',
        'risk_control_stopped',
        'status',
        'total_duration_seconds'
    ]

    return {
        report,
        files: [
            {
                name: 'daily.csv',
                content: toCsvBuffer(
                    dailyHeaders,
                    dailyRows.map(item => [
                        item.date,
                        item.runs,
                        item.accounts,
                        item.collectedPoints,
                        item.successCount,
                        item.failedCount,
                        item.riskControlStops,
                        item.totalDuration
                    ])
                )
            },
            {
                name: 'accounts.csv',
                content: toCsvBuffer(
                    accountsHeaders,
                    (report.accounts || []).map(item => [
                        item.email,
                        item.runs,
                        item.collectedPoints,
                        item.successCount,
                        item.failedCount,
                        item.riskControlStops,
                        item.totalDuration,
                        item.lastStatus,
                        item.consecutiveFailures,
                        item.lastSuccessAt,
                        item.lastFailureAt,
                        item.lastRunAt,
                        item.primaryFailureBucket,
                        item.lastError
                    ])
                )
            },
            {
                name: 'runs.csv',
                content: toCsvBuffer(
                    runsHeaders,
                    (report.recentRuns || []).map(item => [
                        item.startedAt,
                        item.finishedAt,
                        item.date,
                        item.accountCount,
                        item.totalCollectedPoints,
                        item.successCount,
                        item.failedCount,
                        item.riskControlStopped,
                        item.status,
                        item.totalDuration
                    ])
                )
            }
        ]
    }
}

export function buildEarningsExportCsvFiles(projectRoot, options = {}) {
    return buildEarningsExportData(projectRoot, options).files
}

function zipFiles(files) {
    return new Promise((resolve, reject) => {
        const zipfile = new ZipFile()
        const chunks = []

        zipfile.outputStream.on('data', chunk => chunks.push(chunk))
        zipfile.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
        zipfile.outputStream.on('error', reject)

        for (const file of files) {
            zipfile.addBuffer(file.content, file.name)
        }
        zipfile.end()
    })
}

export async function buildEarningsExportZip(projectRoot, options = {}) {
    const { report, files } = buildEarningsExportData(projectRoot, options)
    return {
        filename: filenameForReport(report, options.account),
        contentType: 'application/zip',
        body: await zipFiles(files)
    }
}
