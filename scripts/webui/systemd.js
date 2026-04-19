import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

// ─────────────────────────────────────────────────────────────────────────────
// systemd --user 管理
// 封装：reward (定时任务本身) + webui (管理页自启)
// ─────────────────────────────────────────────────────────────────────────────

const USER_UNIT_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user')

// ─────────────────────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────────────────────

function ensureLinux() {
    if (os.platform() !== 'linux') {
        throw Object.assign(new Error('仅 Linux 支持 systemd 管理'), { status: 400 })
    }
}

async function sctl(args) {
    ensureLinux()
    try {
        const { stdout, stderr } = await execFileP('systemctl', ['--user', ...args], {
            timeout: 10000,
            encoding: 'utf8'
        })
        return { ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() }
    } catch (err) {
        return {
            ok: false,
            code: err.code,
            stdout: (err.stdout || '').trim(),
            stderr: (err.stderr || err.message).trim()
        }
    }
}

function atomicWrite(filePath, content) {
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, filePath)
}

function findNpm() {
    try {
        return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['npm'], { encoding: 'utf8' })
            .split('\n')[0]
            .trim()
    } catch {
        return 'npm'
    }
}

function findNode() {
    return process.execPath
}

function findBash() {
    try {
        return execFileSync('which', ['bash'], { encoding: 'utf8' }).trim() || '/bin/bash'
    } catch {
        return '/bin/bash'
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模板
// ─────────────────────────────────────────────────────────────────────────────

function renderRewardService(projectRoot) {
    const npm = findNpm()
    const bash = findBash()
    return `[Unit]
Description=Microsoft Rewards Script (一次性运行任务)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${projectRoot}
ExecStart=${bash} -lc '${npm} start'
TimeoutStartSec=4h
Nice=10
CPUWeight=60
IOWeight=60
Restart=no
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`
}

function renderRewardTimer(onCalendar) {
    const cal = onCalendar || '*-*-* 07:00:00'
    return `[Unit]
Description=每日触发 Microsoft Rewards Script

[Timer]
OnCalendar=${cal}
Persistent=true
RandomizedDelaySec=30min
AccuracySec=1min

[Install]
WantedBy=timers.target
`
}

function renderWebuiService(projectRoot, { host = '127.0.0.1', port = 3000, token = '' } = {}) {
    const node = findNode()
    const entry = path.join(projectRoot, 'scripts', 'webui', 'server.js')
    const envLines = [`WEBUI_HOST=${host}`, `WEBUI_PORT=${port}`]
    if (token) envLines.push(`WEBUI_TOKEN=${token}`)
    return `[Unit]
Description=Microsoft Rewards 管理页 (Web UI)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${projectRoot}
ExecStart=${node} ${entry}
${envLines.map(e => `Environment=${e}`).join('\n')}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`
}

// ─────────────────────────────────────────────────────────────────────────────
// reward 定时 API
// ─────────────────────────────────────────────────────────────────────────────

const REWARD_SERVICE = 'microsoft-rewards.service'
const REWARD_TIMER = 'microsoft-rewards.timer'
const WEBUI_SERVICE = 'microsoft-rewards-webui.service'

export async function getSystemdStatus() {
    ensureLinux()
    const rewardServiceFile = path.join(USER_UNIT_DIR, REWARD_SERVICE)
    const rewardTimerFile = path.join(USER_UNIT_DIR, REWARD_TIMER)
    const webuiServiceFile = path.join(USER_UNIT_DIR, WEBUI_SERVICE)

    const [enabledTimer, activeTimer, enabledWebui, activeWebui, listTimers, showTimer] = await Promise.all([
        sctl(['is-enabled', REWARD_TIMER]),
        sctl(['is-active', REWARD_TIMER]),
        sctl(['is-enabled', WEBUI_SERVICE]),
        sctl(['is-active', WEBUI_SERVICE]),
        sctl(['list-timers', REWARD_TIMER, '--no-pager', '--no-legend']),
        sctl(['show', REWARD_TIMER, '--no-pager', '-p', 'NextElapseUSecRealtime', '-p', 'LastTriggerUSec', '-p', 'OnCalendarTimersCalendar'])
    ])

    // Try to parse current OnCalendar from the timer file
    let onCalendar = null
    if (fs.existsSync(rewardTimerFile)) {
        try {
            const raw = fs.readFileSync(rewardTimerFile, 'utf8')
            const m = raw.match(/^OnCalendar\s*=\s*(.+)$/m)
            if (m) onCalendar = m[1].trim()
        } catch {}
    }

    return {
        reward: {
            serviceInstalled: fs.existsSync(rewardServiceFile),
            timerInstalled: fs.existsSync(rewardTimerFile),
            enabled: enabledTimer.ok && enabledTimer.stdout === 'enabled',
            active: activeTimer.ok && activeTimer.stdout === 'active',
            onCalendar,
            nextRun: parseNextRun(listTimers.stdout),
            showDump: showTimer.stdout
        },
        webui: {
            installed: fs.existsSync(webuiServiceFile),
            enabled: enabledWebui.ok && enabledWebui.stdout === 'enabled',
            active: activeWebui.ok && activeWebui.stdout === 'active'
        },
        unitDir: USER_UNIT_DIR
    }
}

function parseNextRun(listTimersOutput) {
    // systemctl list-timers 输出: "NEXT LEFT LAST PASSED UNIT ACTIVATES"
    if (!listTimersOutput) return null
    const first = listTimersOutput.split('\n').find(l => l.trim().length > 0)
    if (!first) return null
    return first.trim()
}

export async function installRewardTimer(projectRoot, { onCalendar } = {}) {
    ensureLinux()
    fs.mkdirSync(USER_UNIT_DIR, { recursive: true })
    atomicWrite(path.join(USER_UNIT_DIR, REWARD_SERVICE), renderRewardService(projectRoot))
    atomicWrite(path.join(USER_UNIT_DIR, REWARD_TIMER), renderRewardTimer(onCalendar))
    const reload = await sctl(['daemon-reload'])
    const enable = await sctl(['enable', '--now', REWARD_TIMER])
    if (!enable.ok) {
        throw Object.assign(new Error(enable.stderr || '启用 timer 失败'), {
            status: 500,
            details: { reload, enable }
        })
    }
    return { installed: true }
}

export async function uninstallRewardTimer() {
    ensureLinux()
    await sctl(['disable', '--now', REWARD_TIMER])
    for (const name of [REWARD_TIMER, REWARD_SERVICE]) {
        const p = path.join(USER_UNIT_DIR, name)
        if (fs.existsSync(p)) fs.unlinkSync(p)
    }
    await sctl(['daemon-reload'])
    return { uninstalled: true }
}

export async function updateRewardSchedule(onCalendar) {
    ensureLinux()
    if (!onCalendar || typeof onCalendar !== 'string') {
        throw Object.assign(new Error('缺少 onCalendar'), { status: 400 })
    }
    if (onCalendar.length > 120 || /[\n\r`$]/.test(onCalendar)) {
        throw Object.assign(new Error('非法的 OnCalendar 表达式'), { status: 400 })
    }
    const file = path.join(USER_UNIT_DIR, REWARD_TIMER)
    if (!fs.existsSync(file)) {
        throw Object.assign(new Error('timer 尚未安装'), { status: 404 })
    }
    atomicWrite(file, renderRewardTimer(onCalendar))
    const reload = await sctl(['daemon-reload'])
    if (!reload.ok) throw Object.assign(new Error(reload.stderr || 'daemon-reload 失败'), { status: 500 })
    await sctl(['restart', REWARD_TIMER])
    return { updated: true, onCalendar }
}

export async function triggerRewardNow() {
    ensureLinux()
    const r = await sctl(['start', REWARD_SERVICE])
    if (!r.ok) throw Object.assign(new Error(r.stderr || '触发失败'), { status: 500 })
    return { triggered: true }
}

export async function rewardServiceLogs(lines = 200) {
    ensureLinux()
    try {
        const { stdout } = await execFileP(
            'journalctl',
            ['--user', '-u', REWARD_SERVICE, '-n', String(Math.min(lines, 1000)), '--no-pager', '-o', 'short-iso'],
            { timeout: 5000, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }
        )
        return { stdout }
    } catch (err) {
        return { stdout: '', error: err.message }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Web UI 自启
// ─────────────────────────────────────────────────────────────────────────────

export async function installWebuiAutostart(projectRoot, { host = '127.0.0.1', port = 3000, token = '' } = {}) {
    ensureLinux()
    fs.mkdirSync(USER_UNIT_DIR, { recursive: true })
    atomicWrite(path.join(USER_UNIT_DIR, WEBUI_SERVICE), renderWebuiService(projectRoot, { host, port, token }))
    await sctl(['daemon-reload'])
    const enable = await sctl(['enable', '--now', WEBUI_SERVICE])
    if (!enable.ok) {
        throw Object.assign(new Error(enable.stderr || '启用 webui service 失败'), { status: 500 })
    }
    return { installed: true }
}

export async function uninstallWebuiAutostart() {
    ensureLinux()
    await sctl(['disable', '--now', WEBUI_SERVICE])
    const file = path.join(USER_UNIT_DIR, WEBUI_SERVICE)
    if (fs.existsSync(file)) fs.unlinkSync(file)
    await sctl(['daemon-reload'])
    return { uninstalled: true }
}

export async function lingerStatus() {
    if (os.platform() !== 'linux') return { linger: false, reason: '非 Linux' }
    try {
        const { stdout } = await execFileP('loginctl', ['show-user', os.userInfo().username], {
            timeout: 3000,
            encoding: 'utf8'
        })
        const m = stdout.match(/^Linger=(\w+)/m)
        return { linger: m?.[1] === 'yes' }
    } catch {
        return { linger: false }
    }
}
