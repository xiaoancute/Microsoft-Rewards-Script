import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const DAY_MS = 24 * 60 * 60 * 1000

function normalizeRetentionDays(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    const number = Number(value)
    if (!Number.isFinite(number)) return fallback
    return Math.max(0, Math.floor(number))
}

function sanitizeInstanceId(value) {
    const normalized = String(value || 'default')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

    return normalized || 'default'
}

export function resolveDockerLockFile(env = process.env, { tmpDir = '/tmp' } = {}) {
    if (env.MRS_DOCKER_LOCKFILE) {
        return env.MRS_DOCKER_LOCKFILE
    }

    const instanceId = sanitizeInstanceId(env.MRS_INSTANCE_ID || env.HOSTNAME || 'default')
    return path.join(tmpDir, `run_daily-${instanceId}.lock`)
}

function cutoffMs(now, days) {
    return new Date(now).getTime() - days * DAY_MS
}

async function pruneLogs(projectRoot, { now, retentionDays }) {
    const dir = path.join(projectRoot, 'logs')
    const summary = { kept: 0, deleted: 0 }

    if (retentionDays <= 0 || !fs.existsSync(dir)) {
        return summary
    }

    const cutoff = cutoffMs(now, retentionDays)
    const names = await fs.promises.readdir(dir)

    for (const name of names) {
        const match = name.match(/^(\d{4}-\d{2}-\d{2})\.log$/)
        if (!match) continue

        const fileMs = new Date(`${match[1]}T00:00:00.000Z`).getTime()
        if (!Number.isFinite(fileMs)) continue

        if (fileMs < cutoff) {
            await fs.promises.unlink(path.join(dir, name)).catch(() => {})
            summary.deleted++
        } else {
            summary.kept++
        }
    }

    return summary
}

function shouldKeepReportLine(line, cutoff) {
    try {
        const record = JSON.parse(line)
        const startedAtMs = new Date(record?.startedAt || record?.date).getTime()
        if (!Number.isFinite(startedAtMs)) return true
        return startedAtMs >= cutoff
    } catch {
        return true
    }
}

async function pruneReports(projectRoot, { now, retentionDays }) {
    const file = path.join(projectRoot, 'reports', 'earnings.jsonl')
    const summary = { kept: 0, deleted: 0 }

    if (retentionDays <= 0 || !fs.existsSync(file)) {
        return summary
    }

    const cutoff = cutoffMs(now, retentionDays)
    const raw = await fs.promises.readFile(file, 'utf8')
    const lines = raw.split(/\r?\n/).filter(Boolean)
    const keptLines = []

    for (const line of lines) {
        if (shouldKeepReportLine(line, cutoff)) {
            keptLines.push(line)
            summary.kept++
        } else {
            summary.deleted++
        }
    }

    await fs.promises.writeFile(file, keptLines.length ? `${keptLines.join('\n')}\n` : '', 'utf8')
    return summary
}

export async function pruneRuntimeData(projectRoot, options = {}) {
    const now = options.now || new Date()
    const logRetentionDays = normalizeRetentionDays(options.logRetentionDays, 90)
    const reportRetentionDays = normalizeRetentionDays(options.reportRetentionDays, 365)

    const [logs, reports] = await Promise.all([
        pruneLogs(projectRoot, { now, retentionDays: logRetentionDays }),
        pruneReports(projectRoot, { now, retentionDays: reportRetentionDays })
    ])

    return { logs, reports }
}

async function main() {
    const command = process.argv[2]
    const projectRoot = process.argv[3] || process.cwd()

    if (command === 'lockfile') {
        console.log(resolveDockerLockFile(process.env))
        return
    }

    if (command === 'prune') {
        const result = await pruneRuntimeData(projectRoot, {
            logRetentionDays: process.env.LOG_RETENTION_DAYS,
            reportRetentionDays: process.env.REPORT_RETENTION_DAYS
        })
        console.log(
            `[runtime-maintenance] logs kept=${result.logs.kept} deleted=${result.logs.deleted}; reports kept=${result.reports.kept} deleted=${result.reports.deleted}`
        )
        return
    }

    throw new Error(`Unsupported command: ${command || '(empty)'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(`[runtime-maintenance] ${error.message}`)
        process.exit(1)
    })
}
