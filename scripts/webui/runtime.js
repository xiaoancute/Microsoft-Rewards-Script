import fs from 'fs'

const DEFAULT_LOCK_FILE = '/tmp/run_daily.lock'

function envFlag(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue
    return /^(1|true|yes|on)$/i.test(String(value))
}

export function detectRuntime(env = process.env, { existsSync = fs.existsSync } = {}) {
    const isDocker =
        env.MRS_RUNTIME_MODE === 'docker' ||
        env.MRS_DOCKER === '1' ||
        existsSync('/.dockerenv')

    return {
        mode: isDocker ? 'docker' : 'local',
        isDocker,
        webuiEnabled: isDocker ? envFlag(env.WEBUI_ENABLED, false) : true
    }
}

export function buildCapabilities(runtime, { platform = process.platform } = {}) {
    const isDocker = Boolean(runtime?.isDocker)

    return {
        canOpenBrowserSession: !isDocker,
        canManageSystemd: !isDocker && platform === 'linux',
        canBuildProject: !isDocker,
        canRunNow: true,
        canViewReports: true,
        canViewLogHistory: true
    }
}

export function readExternalRunStatus(
    runtime = detectRuntime(),
    {
        lockFile = process.env.MRS_DOCKER_LOCKFILE || DEFAULT_LOCK_FILE,
        existsSync = fs.existsSync,
        readFileSync = fs.readFileSync,
        signalCheck = pid => {
            try {
                process.kill(pid, 0)
                return true
            } catch {
                return false
            }
        }
    } = {}
) {
    if (!runtime?.isDocker) {
        return { active: false, source: null, pid: null }
    }

    if (!existsSync(lockFile)) {
        return { active: false, source: 'docker-lockfile', pid: null }
    }

    let pidText = ''
    try {
        pidText = String(readFileSync(lockFile, 'utf8') || '').trim()
    } catch {
        return { active: false, source: 'docker-lockfile', pid: null }
    }

    if (!/^\d+$/.test(pidText)) {
        return { active: false, source: 'docker-lockfile', pid: null }
    }

    const pid = Number(pidText)
    return {
        active: signalCheck(pid),
        source: 'docker-lockfile',
        pid
    }
}

export function buildDockerScheduleStatus({
    env = process.env,
    runtime = detectRuntime(env),
    externalRun = readExternalRunStatus(runtime),
    host = env.WEBUI_HOST || '0.0.0.0',
    port = Number(env.WEBUI_PORT) || 3000
} = {}) {
    const onCalendar = env.CRON_SCHEDULE || null
    const runOnStart = envFlag(env.RUN_ON_START, false)
    const tokenProtected = Boolean(env.WEBUI_TOKEN)

    return {
        mode: 'docker',
        reward: {
            kind: 'docker-cron',
            timerInstalled: true,
            enabled: Boolean(onCalendar),
            active: externalRun.active,
            onCalendar,
            nextRun: null,
            runOnStart
        },
        webui: {
            installed: runtime.webuiEnabled,
            enabled: runtime.webuiEnabled,
            active: runtime.webuiEnabled,
            host,
            port,
            tokenProtected
        },
        docker: {
            runOnStart,
            webuiEnabled: runtime.webuiEnabled,
            tokenProtected
        },
        capabilities: buildCapabilities(runtime)
    }
}

export function dockerUnsupported(message) {
    return Object.assign(new Error(message), {
        status: 400,
        code: 'DOCKER_UNSUPPORTED'
    })
}
