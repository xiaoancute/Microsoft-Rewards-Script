const fs = require('fs')
const path = require('path')

const REPORT_DIR = 'reports'
const EARNINGS_FILE = 'earnings.jsonl'

function reportsDir(projectRoot) {
    return path.join(projectRoot, REPORT_DIR)
}

function earningsFile(projectRoot) {
    return path.join(reportsDir(projectRoot), EARNINGS_FILE)
}

function toIso(value) {
    return new Date(value || Date.now()).toISOString()
}

function dateKey(value) {
    return toIso(value).slice(0, 10)
}

function normalizeAccountStat(stat) {
    return {
        email: String(stat.email || ''),
        initialPoints: Number(stat.initialPoints) || 0,
        finalPoints: Number(stat.finalPoints) || 0,
        collectedPoints: Number(stat.collectedPoints) || 0,
        duration: Number(stat.duration) || 0,
        success: Boolean(stat.success),
        error: stat.error ? String(stat.error) : undefined,
        riskControlStopped: Boolean(stat.riskControlStopped)
    }
}

function buildRunRecord({ runStartedAt, runFinishedAt, accountStats, hadWorkerFailure = false, riskControlStopped = false }) {
    const startedAt = toIso(runStartedAt)
    const finishedAt = toIso(runFinishedAt)
    const accounts = Array.isArray(accountStats) ? accountStats.map(normalizeAccountStat) : []
    const totalCollectedPoints = accounts.reduce((sum, item) => sum + item.collectedPoints, 0)
    const totalDuration = accounts.reduce((sum, item) => sum + item.duration, 0)
    const failedAccounts = accounts.filter(item => !item.success).length

    return {
        schemaVersion: 1,
        runId: `${startedAt}-${process.pid}`,
        date: dateKey(startedAt),
        startedAt,
        finishedAt,
        accountCount: accounts.length,
        totalCollectedPoints,
        totalDuration,
        successCount: accounts.length - failedAccounts,
        failedCount: failedAccounts,
        hadWorkerFailure: Boolean(hadWorkerFailure),
        riskControlStopped: Boolean(riskControlStopped || accounts.some(item => item.riskControlStopped)),
        accounts
    }
}

async function appendEarningsRun(projectRoot, input) {
    const record = buildRunRecord(input)
    await fs.promises.mkdir(reportsDir(projectRoot), { recursive: true })
    await fs.promises.appendFile(earningsFile(projectRoot), `${JSON.stringify(record)}\n`, 'utf8')
    return record
}

function readJsonLines(filePath) {
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8')
    return content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            try {
                return JSON.parse(line)
            } catch {
                return null
            }
        })
        .filter(Boolean)
}

function emptySummary(days) {
    return {
        days,
        totals: {
            runs: 0,
            accounts: 0,
            collectedPoints: 0,
            successRate: 0,
            failedAccounts: 0,
            riskControlStops: 0,
            totalDuration: 0
        },
        daily: [],
        accounts: [],
        recentRuns: []
    }
}

function readEarningsReport(projectRoot, { days = 7, now = Date.now() } = {}) {
    const normalizedDays = Math.max(1, Math.min(Number(days) || 7, 365))
    const since = new Date(now)
    since.setUTCHours(0, 0, 0, 0)
    since.setUTCDate(since.getUTCDate() - normalizedDays + 1)

    const records = readJsonLines(earningsFile(projectRoot))
        .filter(record => new Date(record.startedAt).getTime() >= since.getTime())
        .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())

    if (records.length === 0) return emptySummary(normalizedDays)

    const daily = new Map()
    const accounts = new Map()
    const totals = emptySummary(normalizedDays).totals

    for (const record of records) {
        totals.runs += 1
        totals.accounts += Number(record.accountCount) || 0
        totals.collectedPoints += Number(record.totalCollectedPoints) || 0
        totals.failedAccounts += Number(record.failedCount) || 0
        totals.riskControlStops += record.riskControlStopped ? 1 : 0
        totals.totalDuration += Number(record.totalDuration) || 0

        const day = record.date || dateKey(record.startedAt)
        const dayItem = daily.get(day) || {
            date: day,
            runs: 0,
            accounts: 0,
            collectedPoints: 0,
            successCount: 0,
            failedCount: 0,
            riskControlStops: 0,
            totalDuration: 0
        }
        dayItem.runs += 1
        dayItem.accounts += Number(record.accountCount) || 0
        dayItem.collectedPoints += Number(record.totalCollectedPoints) || 0
        dayItem.successCount += Number(record.successCount) || 0
        dayItem.failedCount += Number(record.failedCount) || 0
        dayItem.riskControlStops += record.riskControlStopped ? 1 : 0
        dayItem.totalDuration += Number(record.totalDuration) || 0
        daily.set(day, dayItem)

        for (const stat of record.accounts || []) {
            const email = stat.email || 'unknown'
            const accountItem = accounts.get(email) || {
                email,
                runs: 0,
                collectedPoints: 0,
                successCount: 0,
                failedCount: 0,
                riskControlStops: 0,
                totalDuration: 0,
                lastRunAt: null,
                lastError: null
            }
            accountItem.runs += 1
            accountItem.collectedPoints += Number(stat.collectedPoints) || 0
            accountItem.successCount += stat.success ? 1 : 0
            accountItem.failedCount += stat.success ? 0 : 1
            accountItem.riskControlStops += stat.riskControlStopped ? 1 : 0
            accountItem.totalDuration += Number(stat.duration) || 0
            accountItem.lastRunAt = record.finishedAt || record.startedAt
            accountItem.lastError = stat.error || accountItem.lastError
            accounts.set(email, accountItem)
        }
    }

    const finishedAccounts = totals.accounts || 0
    totals.successRate = finishedAccounts ? Math.round(((finishedAccounts - totals.failedAccounts) / finishedAccounts) * 1000) / 10 : 0

    return {
        days: normalizedDays,
        totals,
        daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
        accounts: Array.from(accounts.values()).sort((a, b) => b.collectedPoints - a.collectedPoints || a.email.localeCompare(b.email)),
        recentRuns: records.slice(-10).reverse()
    }
}

module.exports = {
    earningsFile,
    buildRunRecord,
    appendEarningsRun,
    readEarningsReport
}
