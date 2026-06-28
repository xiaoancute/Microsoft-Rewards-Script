const fs = require('fs')
const path = require('path')

const REPORT_DIR = 'reports'
const EARNINGS_FILE = 'earnings.jsonl'
const EARNINGS_CHECKPOINT_FILE = 'earnings.pending.json'
const FAILURE_SNAPSHOTS_FILE = 'failure-snapshots.jsonl'
const TASK_DISCOVERY_FILE = 'task-discovery.jsonl'
const DAY_MS = 24 * 60 * 60 * 1000
const FAILURE_BUCKET_ORDER = ['risk_control', 'login', 'session', 'network', 'flow', 'unknown']
const FAILURE_BUCKET_LABELS = {
    risk_control: '风控拦截',
    login: '登录失败',
    session: '会话失效',
    network: '网络异常',
    flow: '流程异常',
    unknown: '未归类'
}
const TASK_LABELS = {
    'app-promotions': 'App 活动',
    'daily-set': '每日任务',
    'special-promotions': '特殊活动',
    'more-promotions': '更多活动',
    'daily-check-in': '每日签到',
    'read-to-earn': '阅读赚取',
    'punch-cards': 'Punch Cards',
    'modern-panel': '现代面板',
    searches: '搜索'
}

function reportsDir(projectRoot) {
    return path.join(projectRoot, REPORT_DIR)
}

function earningsFile(projectRoot) {
    return path.join(reportsDir(projectRoot), EARNINGS_FILE)
}

function earningsCheckpointFile(projectRoot) {
    return path.join(reportsDir(projectRoot), EARNINGS_CHECKPOINT_FILE)
}

function failureSnapshotsFile(projectRoot) {
    return path.join(reportsDir(projectRoot), FAILURE_SNAPSHOTS_FILE)
}

function taskDiscoveryFile(projectRoot) {
    return path.join(reportsDir(projectRoot), TASK_DISCOVERY_FILE)
}

function toIso(value) {
    return new Date(value || Date.now()).toISOString()
}

function dateKey(value) {
    return toIso(value).slice(0, 10)
}

function normalizeAccountStat(stat) {
    const taskStats = Array.isArray(stat.taskStats)
        ? stat.taskStats.map(normalizeTaskStat).filter(Boolean)
        : []
    return {
        email: String(stat.email || ''),
        initialPoints: Number(stat.initialPoints) || 0,
        finalPoints: Number(stat.finalPoints) || 0,
        collectedPoints: Number(stat.collectedPoints) || 0,
        duration: Number(stat.duration) || 0,
        success: Boolean(stat.success),
        error: stat.error ? String(stat.error) : undefined,
        riskControlStopped: Boolean(stat.riskControlStopped),
        taskStats
    }
}

function normalizeTaskStat(task) {
    if (!task?.key) return null
    const key = String(task.key)
    const status = ['success', 'failed', 'skipped'].includes(task.status) ? task.status : 'success'
    return {
        key,
        label: String(task.label || TASK_LABELS[key] || key),
        status,
        initialPoints: Number(task.initialPoints) || 0,
        finalPoints: Number(task.finalPoints) || 0,
        collectedPoints: Number(task.collectedPoints) || 0,
        duration: Number(task.duration) || 0,
        error: task.error ? String(task.error) : undefined
    }
}

function redactSensitiveText(value) {
    let text = String(value || '')
    text = text.replace(
        /([?&](?:code|access_token|refresh_token|id_token|client_secret|password|passwd|pwd|__RequestVerificationToken)=)([^&#\s]+)/gi,
        '$1[REDACTED]'
    )
    text = text.replace(
        /\b((?:access_token|refresh_token|id_token|client_secret|password|passwd|pwd|__RequestVerificationToken)\s*[:=]\s*)(["']?)[^\s"',;&]+/gi,
        '$1$2[REDACTED]'
    )
    text = text.replace(/\b(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    text = text.replace(/\b(cookie|set-cookie)\s*:\s*[^\r\n]+/gi, '$1: [REDACTED]')
    text = text.replace(/(["']?cookie["']?\s*[:=]\s*["'])[^"']+(["'])/gi, '$1[REDACTED]$2')
    return text
}

function normalizeFailureSnapshot(input) {
    const capturedAt = toIso(input?.capturedAt || Date.now())
    const error = input?.error ? redactSensitiveText(input.error) : undefined
    const riskControlStopped = Boolean(input?.riskControlStopped)
    const stat = {
        error,
        riskControlStopped
    }

    return {
        schemaVersion: 1,
        runId: input?.runId ? String(input.runId) : undefined,
        account: String(input?.account || input?.email || 'unknown'),
        stage: input?.stage ? String(input.stage) : 'unknown',
        error,
        failureBucket: input?.failureBucket ? String(input.failureBucket) : classifyFailure(stat),
        riskControlStopped,
        url: input?.url ? redactSensitiveText(input.url) : undefined,
        pageTitle: input?.pageTitle ? redactSensitiveText(input.pageTitle) : undefined,
        capturedAt
    }
}

async function appendFailureSnapshot(projectRoot, input) {
    const snapshot = normalizeFailureSnapshot(input)
    await fs.promises.mkdir(reportsDir(projectRoot), { recursive: true })
    await fs.promises.appendFile(failureSnapshotsFile(projectRoot), `${JSON.stringify(snapshot)}\n`, 'utf8')
    return snapshot
}

async function appendTaskDiscoverySamples(projectRoot, input) {
    const capturedAt = toIso(input?.capturedAt || Date.now())
    const records = (Array.isArray(input?.tasks) ? input.tasks : [])
        .filter(task => task?.decision === 'unknown')
        .map(task => ({
            schemaVersion: 1,
            account: String(input?.account || 'unknown'),
            geoLocale: input?.geoLocale ? String(input.geoLocale) : undefined,
            source: String(task.source || 'unknown'),
            kind: String(task.kind || 'unknown'),
            title: redactSensitiveText(task.title || ''),
            offerId: task.offerId ? String(task.offerId) : null,
            points: Number(task.points) || 0,
            reason: String(task.reason || 'unknown'),
            capturedAt
        }))

    if (records.length === 0) return []

    await fs.promises.mkdir(reportsDir(projectRoot), { recursive: true })
    await fs.promises.appendFile(taskDiscoveryFile(projectRoot), `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8')
    return records
}

function readFailureSnapshots(projectRoot, { account = 'all', limit = 50 } = {}) {
    const normalizedAccount = account && account !== 'all' ? String(account).toLowerCase() : null
    const max = Math.max(1, Math.min(Number(limit) || 50, 500))
    return readJsonLines(failureSnapshotsFile(projectRoot))
        .map(item => normalizeFailureSnapshot(item))
        .filter(item => !normalizedAccount || item.account.toLowerCase() === normalizedAccount)
        .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
        .slice(0, max)
}

function buildRunRecord({
    runId,
    runStartedAt,
    runFinishedAt,
    accountStats,
    hadWorkerFailure = false,
    riskControlStopped = false
}) {
    const startedAt = toIso(runStartedAt)
    const finishedAt = toIso(runFinishedAt)
    const accounts = Array.isArray(accountStats) ? accountStats.map(normalizeAccountStat) : []
    const totalCollectedPoints = accounts.reduce((sum, item) => sum + item.collectedPoints, 0)
    const totalDuration = accounts.reduce((sum, item) => sum + item.duration, 0)
    const failedAccounts = accounts.filter(item => !item.success).length

    return {
        schemaVersion: 1,
        runId: runId || `${startedAt}-${process.pid}`,
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

function normalizeCheckpoint(input) {
    const startedAtMs = new Date(input?.runStartedAt || input?.startedAt).getTime()
    if (!Number.isFinite(startedAtMs)) {
        throw new Error('Invalid earnings checkpoint runStartedAt')
    }

    const runStartedAt = toIso(startedAtMs)
    const updatedAt = toIso(input?.updatedAt || Date.now())
    const accountStats = Array.isArray(input?.accountStats) ? input.accountStats.map(normalizeAccountStat) : []

    return {
        schemaVersion: 1,
        runId: String(input?.runId || `${runStartedAt}-${input?.pid || process.pid}`),
        runStartedAt,
        updatedAt,
        accountStats,
        hadWorkerFailure: input?.hadWorkerFailure === undefined ? true : Boolean(input.hadWorkerFailure),
        riskControlStopped: Boolean(input?.riskControlStopped || accountStats.some(item => item.riskControlStopped)),
        reason: input?.reason ? String(input.reason) : undefined
    }
}

async function writeEarningsCheckpoint(projectRoot, input) {
    const checkpoint = normalizeCheckpoint(input)
    await fs.promises.mkdir(reportsDir(projectRoot), { recursive: true })

    const filePath = earningsCheckpointFile(projectRoot)
    const tmpPath = `${filePath}.${process.pid}.tmp`
    await fs.promises.writeFile(tmpPath, `${JSON.stringify(checkpoint)}\n`, 'utf8')
    await fs.promises.rename(tmpPath, filePath)
    return checkpoint
}

async function readEarningsCheckpoint(projectRoot) {
    try {
        const raw = await fs.promises.readFile(earningsCheckpointFile(projectRoot), 'utf8')
        return normalizeCheckpoint(JSON.parse(raw))
    } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
    }
}

async function clearEarningsCheckpoint(projectRoot, runId) {
    if (runId) {
        const checkpoint = await readEarningsCheckpoint(projectRoot)
        if (!checkpoint || checkpoint.runId !== runId) {
            return false
        }
    }

    try {
        await fs.promises.unlink(earningsCheckpointFile(projectRoot))
        return true
    } catch (error) {
        if (error?.code === 'ENOENT') return false
        throw error
    }
}

function hasEarningsRun(projectRoot, runId) {
    if (!runId) return false
    return readJsonLines(earningsFile(projectRoot)).some(record => record?.runId === runId)
}

async function recoverEarningsCheckpoint(projectRoot) {
    const checkpoint = await readEarningsCheckpoint(projectRoot)
    if (!checkpoint) {
        return { recovered: false, reason: 'missing' }
    }

    if (checkpoint.accountStats.length === 0) {
        await clearEarningsCheckpoint(projectRoot, checkpoint.runId)
        return { recovered: false, reason: 'empty', checkpoint }
    }

    if (hasEarningsRun(projectRoot, checkpoint.runId)) {
        await clearEarningsCheckpoint(projectRoot, checkpoint.runId)
        return { recovered: false, reason: 'already-recorded', checkpoint }
    }

    const record = await appendEarningsRun(projectRoot, {
        runId: checkpoint.runId,
        runStartedAt: checkpoint.runStartedAt,
        runFinishedAt: checkpoint.updatedAt,
        accountStats: checkpoint.accountStats,
        hadWorkerFailure: true,
        riskControlStopped: checkpoint.riskControlStopped
    })
    await clearEarningsCheckpoint(projectRoot, checkpoint.runId)

    return { recovered: true, reason: 'recovered', checkpoint, record }
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

function createTotals() {
    return {
        runs: 0,
        accounts: 0,
        collectedPoints: 0,
        successRate: 0,
        failedAccounts: 0,
        riskControlStops: 0,
        totalDuration: 0
    }
}

function createDailyRow(date) {
    return {
        date,
        runs: 0,
        accounts: 0,
        collectedPoints: 0,
        successCount: 0,
        failedCount: 0,
        riskControlStops: 0,
        totalDuration: 0
    }
}

function normalizeNow(value) {
    const ms = new Date(value || Date.now()).getTime()
    return Number.isFinite(ms) ? ms : Date.now()
}

function normalizeRange(range, days) {
    if (range === 'today') return { days: 1, range: 'today' }
    if (range === '7d') return { days: 7, range: '7d' }
    if (range === '30d') return { days: 30, range: '30d' }

    const normalizedDays = Math.max(1, Math.min(Number(days) || 7, 365))
    return {
        days: normalizedDays,
        range: normalizedDays === 1 ? 'today' : `${normalizedDays}d`
    }
}

function normalizeTimezoneOffsetMinutes(value, nowMs) {
    const num = Number(value)
    return Number.isFinite(num) ? num : new Date(nowMs).getTimezoneOffset()
}

function shiftMs(ms, timezoneOffsetMinutes) {
    return ms - timezoneOffsetMinutes * 60 * 1000
}

function dayStartShiftedMs(ms) {
    const shifted = new Date(ms)
    shifted.setUTCHours(0, 0, 0, 0)
    return shifted.getTime()
}

function shiftedDayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10)
}

function buildWindow({ range, days, timezoneOffsetMinutes, now }) {
    const nowMs = normalizeNow(now)
    const { days: normalizedDays, range: normalizedRange } = normalizeRange(range, days)
    const offsetMinutes = normalizeTimezoneOffsetMinutes(timezoneOffsetMinutes, nowMs)
    const shiftedNowMs = shiftMs(nowMs, offsetMinutes)
    const shiftedTodayStartMs = dayStartShiftedMs(shiftedNowMs)
    const startShiftedMs = shiftedTodayStartMs - (normalizedDays - 1) * DAY_MS
    const endShiftedMs = shiftedTodayStartMs + DAY_MS
    const dayKeys = []

    for (let i = 0; i < normalizedDays; i++) {
        dayKeys.push(shiftedDayKey(startShiftedMs + i * DAY_MS))
    }

    return {
        days: normalizedDays,
        range: normalizedRange,
        timezoneOffsetMinutes: offsetMinutes,
        startShiftedMs,
        endShiftedMs,
        startDate: dayKeys[0],
        endDate: dayKeys[dayKeys.length - 1],
        dayKeys
    }
}

function createFailureBucketSummary() {
    return FAILURE_BUCKET_ORDER.map(key => ({
        key,
        label: FAILURE_BUCKET_LABELS[key],
        count: 0,
        accountCount: 0
    }))
}

function createTaskSummaryItem(key, label) {
    return {
        key,
        label: label || TASK_LABELS[key] || key,
        runs: 0,
        accountCount: 0,
        collectedPoints: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        totalDuration: 0
    }
}

function emptySummary(window) {
    return {
        days: window.days,
        totals: createTotals(),
        daily: window.dayKeys.map(createDailyRow),
        accounts: [],
        recentRuns: [],
        failureBuckets: createFailureBucketSummary(),
        taskSummary: [],
        window: {
            range: window.range,
            startDate: window.startDate,
            endDate: window.endDate,
            timezoneOffsetMinutes: window.timezoneOffsetMinutes
        },
    }
}

function normalizeRecord(record) {
    const startedAtMs = new Date(record?.startedAt).getTime()
    if (!Number.isFinite(startedAtMs)) return null

    const startedAt = toIso(record.startedAt)
    const finishedAt = record?.finishedAt ? toIso(record.finishedAt) : startedAt
    const accounts = Array.isArray(record?.accounts) ? record.accounts.map(normalizeAccountStat) : []
    const totalCollectedPoints = accounts.reduce((sum, item) => sum + item.collectedPoints, 0)
    const totalDuration = accounts.reduce((sum, item) => sum + item.duration, 0)
    const failedCount = accounts.filter(item => !item.success).length

    return {
        runId: record?.runId || `${startedAt}-${accounts.length}`,
        date: record?.date || dateKey(startedAt),
        startedAt,
        startedAtMs,
        finishedAt,
        accountCount: accounts.length,
        totalCollectedPoints,
        totalDuration,
        successCount: accounts.length - failedCount,
        failedCount,
        hadWorkerFailure: Boolean(record?.hadWorkerFailure),
        riskControlStopped: Boolean(record?.riskControlStopped || accounts.some(item => item.riskControlStopped)),
        accounts
    }
}

function classifyFailure(stat) {
    const text = String(stat?.error || '').toLowerCase()
    if (stat?.riskControlStopped || /风控|暂停|risk|suspend|suspicious/.test(text)) return 'risk_control'
    if (/login|登录|密码|验证码|totp|2fa|auth|身份验证|oauth|授权/.test(text)) return 'login'
    if (/session|cookie|token|令牌|会话|requestverificationtoken/.test(text)) return 'session'
    if (/timeout|timed out|etimedout|network|socket|fetch|连接|dns|proxy|econn|enotfound|chromewebdata|net::/.test(text)) return 'network'
    if (/流程|dashboard|panel|任务|activity|活动|search|搜索|页面|状态|unknown/.test(text)) return 'flow'
    return 'unknown'
}

function summarizeStatus({ riskControlStopped, failedCount, hadWorkerFailure }, scoped) {
    if (riskControlStopped) return 'risk_control'
    if (failedCount > 0) return 'failed'
    if (!scoped && hadWorkerFailure) return 'failed'
    return 'success'
}

function scopeRecord(record, accountFilter) {
    const scoped = accountFilter && accountFilter !== 'all'
    const normalizedFilter = scoped ? accountFilter.toLowerCase() : null
    const accounts = scoped
        ? record.accounts.filter(item => item.email.toLowerCase() === normalizedFilter)
        : record.accounts.slice()

    if (accounts.length === 0) return null

    const totalCollectedPoints = accounts.reduce((sum, item) => sum + item.collectedPoints, 0)
    const totalDuration = accounts.reduce((sum, item) => sum + item.duration, 0)
    const failedCount = accounts.filter(item => !item.success).length
    const riskControlStopped = accounts.some(item => item.riskControlStopped) || (!scoped && record.riskControlStopped)
    const hadWorkerFailure = !scoped && Boolean(record.hadWorkerFailure)

    return {
        runId: record.runId,
        date: record.date,
        startedAt: record.startedAt,
        startedAtMs: record.startedAtMs,
        finishedAt: record.finishedAt,
        accountCount: accounts.length,
        totalCollectedPoints,
        totalDuration,
        successCount: accounts.length - failedCount,
        failedCount,
        hadWorkerFailure,
        riskControlStopped,
        accounts,
        status: summarizeStatus({ riskControlStopped, failedCount, hadWorkerFailure }, scoped)
    }
}

function listHistoricalAccounts(projectRoot) {
    const emails = new Set()
    for (const record of readJsonLines(earningsFile(projectRoot))) {
        for (const stat of Array.isArray(record?.accounts) ? record.accounts : []) {
            const email = String(stat?.email || '').trim()
            if (email) emails.add(email)
        }
    }
    return Array.from(emails).sort((a, b) => a.localeCompare(b))
}

function readEarningsReport(
    projectRoot,
    { days = 7, range, account = 'all', timezoneOffsetMinutes, now = Date.now() } = {}
) {
    const window = buildWindow({ range, days, timezoneOffsetMinutes, now })
    const daily = new Map(window.dayKeys.map(day => [day, createDailyRow(day)]))
    const totals = createTotals()
    const accounts = new Map()
    const taskSummary = new Map()
    const failureBuckets = new Map(
        FAILURE_BUCKET_ORDER.map(key => [key, { key, label: FAILURE_BUCKET_LABELS[key], count: 0, emails: new Set() }])
    )

    const records = readJsonLines(earningsFile(projectRoot))
        .map(normalizeRecord)
        .filter(Boolean)
        .map(record => scopeRecord(record, account))
        .filter(Boolean)
        .filter(record => {
            const shiftedStartedAtMs = shiftMs(record.startedAtMs, window.timezoneOffsetMinutes)
            return shiftedStartedAtMs >= window.startShiftedMs && shiftedStartedAtMs < window.endShiftedMs
        })
        .sort((a, b) => a.startedAtMs - b.startedAtMs)

    for (const record of records) {
        totals.runs += 1
        totals.accounts += record.accountCount
        totals.collectedPoints += record.totalCollectedPoints
        totals.failedAccounts += record.failedCount
        totals.riskControlStops += record.status === 'risk_control' ? 1 : 0
        totals.totalDuration += record.totalDuration

        const day = shiftedDayKey(shiftMs(record.startedAtMs, window.timezoneOffsetMinutes))
        const dayItem = daily.get(day) || createDailyRow(day)
        dayItem.runs += 1
        dayItem.accounts += record.accountCount
        dayItem.collectedPoints += record.totalCollectedPoints
        dayItem.successCount += record.successCount
        dayItem.failedCount += record.failedCount
        dayItem.riskControlStops += record.status === 'risk_control' ? 1 : 0
        dayItem.totalDuration += record.totalDuration
        daily.set(day, dayItem)

        for (const stat of record.accounts) {
            const email = stat.email || 'unknown'
            const runAt = record.finishedAt || record.startedAt
            const status = stat.riskControlStopped ? 'risk_control' : stat.success ? 'success' : 'failed'
            const failureBucket = status === 'success' ? null : classifyFailure(stat)
            const accountItem = accounts.get(email) || {
                email,
                runs: 0,
                collectedPoints: 0,
                successCount: 0,
                failedCount: 0,
                riskControlStops: 0,
                totalDuration: 0,
                lastRunAt: null,
                lastError: null,
                lastStatus: 'success',
                consecutiveFailures: 0,
                lastSuccessAt: null,
                lastFailureAt: null,
                primaryFailureBucket: null,
                _history: []
            }

            accountItem.runs += 1
            accountItem.collectedPoints += stat.collectedPoints
            accountItem.successCount += stat.success ? 1 : 0
            accountItem.failedCount += stat.success ? 0 : 1
            accountItem.riskControlStops += stat.riskControlStopped ? 1 : 0
            accountItem.totalDuration += stat.duration
            accountItem.lastRunAt = runAt
            accountItem.lastError = stat.error || accountItem.lastError
            accountItem._history.push({
                status,
                runAt,
                error: stat.error || null,
                failureBucket
            })

            if (failureBucket) {
                const bucket = failureBuckets.get(failureBucket)
                bucket.count += 1
                bucket.emails.add(email)
            }

            for (const task of stat.taskStats || []) {
                const item = taskSummary.get(task.key) || createTaskSummaryItem(task.key, task.label)
                item.runs += 1
                item.accountCount += 1
                item.collectedPoints += task.collectedPoints
                item.successCount += task.status === 'success' ? 1 : 0
                item.failedCount += task.status === 'failed' ? 1 : 0
                item.skippedCount += task.status === 'skipped' ? 1 : 0
                item.totalDuration += task.duration
                taskSummary.set(task.key, item)
            }

            accounts.set(email, accountItem)
        }
    }

    const finishedAccounts = totals.accounts || 0
    totals.successRate = finishedAccounts ? Math.round(((finishedAccounts - totals.failedAccounts) / finishedAccounts) * 1000) / 10 : 0

    const summarizedAccounts = Array.from(accounts.values()).map(accountItem => {
        const history = accountItem._history
        const lastEvent = history[history.length - 1] || null
        let consecutiveFailures = 0

        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].status === 'success') break
            consecutiveFailures += 1
        }

        const lastSuccessAt = [...history].reverse().find(item => item.status === 'success')?.runAt || null
        const lastFailureEvent = [...history].reverse().find(item => item.status !== 'success') || null

        return {
            email: accountItem.email,
            runs: accountItem.runs,
            collectedPoints: accountItem.collectedPoints,
            successCount: accountItem.successCount,
            failedCount: accountItem.failedCount,
            riskControlStops: accountItem.riskControlStops,
            totalDuration: accountItem.totalDuration,
            lastRunAt: accountItem.lastRunAt,
            lastError: accountItem.lastError,
            lastStatus: lastEvent?.status || 'success',
            consecutiveFailures,
            lastSuccessAt,
            lastFailureAt: lastFailureEvent?.runAt || null,
            primaryFailureBucket: lastFailureEvent?.failureBucket || null
        }
    })

    return {
        days: window.days,
        totals,
        daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
        accounts: summarizedAccounts.sort((a, b) => b.collectedPoints - a.collectedPoints || a.email.localeCompare(b.email)),
        recentRuns: records
            .slice(-10)
            .reverse()
            .map(record => ({
                runId: record.runId,
                date: shiftedDayKey(shiftMs(record.startedAtMs, window.timezoneOffsetMinutes)),
                startedAt: record.startedAt,
                finishedAt: record.finishedAt,
                accountCount: record.accountCount,
                totalCollectedPoints: record.totalCollectedPoints,
                totalDuration: record.totalDuration,
                successCount: record.successCount,
                failedCount: record.failedCount,
                riskControlStopped: record.riskControlStopped,
                hadWorkerFailure: record.hadWorkerFailure,
                status: record.status
            })),
        failureBuckets: FAILURE_BUCKET_ORDER.map(key => ({
            key,
            label: FAILURE_BUCKET_LABELS[key],
            count: failureBuckets.get(key).count,
            accountCount: failureBuckets.get(key).emails.size
        })),
        taskSummary: Array.from(taskSummary.values()).sort(
            (a, b) => b.collectedPoints - a.collectedPoints || a.label.localeCompare(b.label)
        ),
        window: {
            range: window.range,
            startDate: window.startDate,
            endDate: window.endDate,
            timezoneOffsetMinutes: window.timezoneOffsetMinutes
        }
    }
}

module.exports = {
    earningsFile,
    earningsCheckpointFile,
    failureSnapshotsFile,
    taskDiscoveryFile,
    buildRunRecord,
    appendEarningsRun,
    appendFailureSnapshot,
    appendTaskDiscoverySamples,
    readFailureSnapshots,
    writeEarningsCheckpoint,
    readEarningsCheckpoint,
    clearEarningsCheckpoint,
    recoverEarningsCheckpoint,
    readEarningsReport,
    listHistoricalAccounts
}
