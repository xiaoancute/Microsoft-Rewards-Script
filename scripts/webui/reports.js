import { createRequire } from 'module'

import { listAccounts } from './api.js'

const require = createRequire(import.meta.url)
const { readEarningsReport, listHistoricalAccounts } = require('../../earnings-report.cjs')
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
    const filters = {
        accounts: uniqueSortedEmails([
            ...configuredAccountEmails(projectRoot),
            ...listHistoricalAccounts(projectRoot)
        ])
    }

    return {
        ...report,
        filters
    }
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
