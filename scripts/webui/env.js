import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'

// ─────────────────────────────────────────────────────────────────────────────
// 环境诊断 —— 纯只读。返回一组 check，每项 { name, ok, value, hint }
// ─────────────────────────────────────────────────────────────────────────────

function run(command, args, opts = {}) {
    try {
        const out = execFileSync(command, args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
            ...opts
        })
        return { ok: true, stdout: String(out).trim() }
    } catch (err) {
        return { ok: false, error: err.message, stdout: err.stdout ? String(err.stdout).trim() : '' }
    }
}

function detectDistro() {
    try {
        const text = fs.readFileSync('/etc/os-release', 'utf8')
        const map = Object.fromEntries(
            text
                .split('\n')
                .filter(Boolean)
                .map(line => {
                    const eq = line.indexOf('=')
                    if (eq === -1) return null
                    const key = line.slice(0, eq)
                    const value = line.slice(eq + 1).replace(/^"|"$/g, '')
                    return [key, value]
                })
                .filter(Boolean)
        )
        return { id: map.ID, pretty: map.PRETTY_NAME || map.NAME, idLike: map.ID_LIKE }
    } catch {
        return { id: 'unknown', pretty: os.platform(), idLike: '' }
    }
}

function checkNode() {
    const version = process.version
    const major = Number(version.replace('v', '').split('.')[0])
    return {
        name: 'Node.js',
        ok: major >= 24,
        value: version,
        hint: major >= 24 ? null : '需要 Node >= 24。升级后请重启管理页。'
    }
}

function checkDistBuilt(projectRoot) {
    const builtPath = path.join(projectRoot, 'dist', 'index.js')
    const exists = fs.existsSync(builtPath)
    return {
        name: '项目已构建 (dist/)',
        ok: exists,
        value: exists ? '存在' : '缺失',
        hint: exists ? null : '点「重新构建」编译 TypeScript。'
    }
}

function checkAccounts(projectRoot) {
    const p = path.join(projectRoot, 'src', 'accounts.json')
    if (!fs.existsSync(p)) {
        return { name: 'accounts.json', ok: false, value: '未创建', hint: '到「账号」Tab 添加第一个账号。' }
    }
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
        const count = Array.isArray(raw) ? raw.length : 0
        return {
            name: 'accounts.json',
            ok: count > 0,
            value: `${count} 个账号`,
            hint: count === 0 ? '文件为空，到「账号」Tab 添加账号。' : null
        }
    } catch (e) {
        return { name: 'accounts.json', ok: false, value: '解析失败', hint: e.message }
    }
}

function checkConfig(projectRoot) {
    const p = path.join(projectRoot, 'src', 'config.json')
    const exists = fs.existsSync(p)
    return {
        name: 'config.json',
        ok: exists,
        value: exists ? '存在' : '未创建',
        hint: exists ? null : '到「配置」Tab 保存一次即自动创建。'
    }
}

function checkPatchrightChromium() {
    // patchright 把浏览器放在 ~/.cache/ms-playwright/chromium*/ 或按 PLAYWRIGHT_BROWSERS_PATH
    const env = process.env.PLAYWRIGHT_BROWSERS_PATH
    const candidates = []
    if (env && env !== '0') candidates.push(env)
    candidates.push(path.join(os.homedir(), '.cache', 'ms-playwright'))
    for (const base of candidates) {
        if (!fs.existsSync(base)) continue
        try {
            const entries = fs.readdirSync(base)
            const chromium = entries.find(e => /^chromium/i.test(e))
            if (chromium) {
                return {
                    name: 'Chromium 浏览器',
                    ok: true,
                    value: path.join(base, chromium),
                    hint: null
                }
            }
        } catch {}
    }
    return {
        name: 'Chromium 浏览器',
        ok: false,
        value: '未找到',
        hint: '点「修复 Chromium」重装。'
    }
}

function checkNpm() {
    const r = run('npm', ['--version'])
    return {
        name: 'npm',
        ok: r.ok,
        value: r.ok ? r.stdout : '未找到',
        hint: r.ok ? null : 'npm 不在 PATH，升级/安装功能不可用。'
    }
}

function checkGit() {
    const r = run('git', ['--version'])
    return {
        name: 'git',
        ok: r.ok,
        value: r.ok ? r.stdout : '未找到',
        hint: r.ok ? null : 'git 不在 PATH，「一键升级」功能不可用。'
    }
}

function checkSystemd() {
    if (os.platform() !== 'linux') {
        return { name: 'systemd (用户级)', ok: false, value: '非 Linux', hint: '仅 Linux 可用。' }
    }
    const r = run('systemctl', ['--user', 'show-environment'])
    return {
        name: 'systemd (用户级)',
        ok: r.ok,
        value: r.ok ? '可用' : '不可用',
        hint: r.ok ? null : '当前用户会话未启动 systemd --user，定时任务功能不可用。'
    }
}

function checkSessionsDir(projectRoot) {
    const candidates = [
        path.join(projectRoot, 'src', 'browser', 'sessions'),
        path.join(projectRoot, 'dist', 'browser', 'sessions')
    ]
    let totalBytes = 0
    let accountCount = 0
    for (const base of candidates) {
        if (!fs.existsSync(base)) continue
        for (const entry of fs.readdirSync(base)) {
            const sub = path.join(base, entry)
            try {
                const stat = fs.statSync(sub)
                if (!stat.isDirectory()) continue
                accountCount++
                for (const f of fs.readdirSync(sub)) {
                    try {
                        totalBytes += fs.statSync(path.join(sub, f)).size
                    } catch {}
                }
            } catch {}
        }
    }
    return {
        name: 'Sessions 目录',
        ok: true,
        value: `${accountCount} 个账号，${prettyBytes(totalBytes)}`,
        hint: null
    }
}

function checkLogsDir(projectRoot) {
    const base = path.join(projectRoot, 'logs')
    if (!fs.existsSync(base)) return { name: '日志目录', ok: true, value: '空', hint: null }
    try {
        const files = fs.readdirSync(base).filter(f => f.endsWith('.log'))
        let total = 0
        for (const f of files) {
            try {
                total += fs.statSync(path.join(base, f)).size
            } catch {}
        }
        return { name: '日志目录', ok: true, value: `${files.length} 个文件，${prettyBytes(total)}`, hint: null }
    } catch {
        return { name: '日志目录', ok: true, value: '无法读取', hint: null }
    }
}

function prettyBytes(n) {
    if (!n) return '0 B'
    const u = ['B', 'KB', 'MB', 'GB']
    let i = 0
    while (n >= 1024 && i < u.length - 1) {
        n /= 1024
        i++
    }
    return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`
}

export function diagnoseEnvironment(projectRoot) {
    const distro = detectDistro()
    const checks = [
        checkNode(),
        checkNpm(),
        checkGit(),
        checkPatchrightChromium(),
        checkDistBuilt(projectRoot),
        checkAccounts(projectRoot),
        checkConfig(projectRoot),
        checkSessionsDir(projectRoot),
        checkLogsDir(projectRoot),
        checkSystemd()
    ]
    return {
        platform: {
            os: os.platform(),
            arch: os.arch(),
            kernel: os.release(),
            distro: distro.pretty,
            distroId: distro.id,
            user: os.userInfo().username,
            homedir: os.homedir(),
            projectRoot
        },
        checks
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 修复动作 —— 这些都是**异步长任务**，必须通过 runner 跑并流式日志
// 这里只返回「要怎么 spawn」的描述，实际 spawn 在 server.js 里
// ─────────────────────────────────────────────────────────────────────────────

export function fixActionsFor(distroId) {
    const isDebian = /^(debian|ubuntu|linuxmint|pop)/.test(distroId || '') || /debian|ubuntu/.test(distroId || '')
    const isArch = /^(arch|manjaro|endeavouros)/.test(distroId || '')
    const isFedora = /^(fedora|rhel|centos|rocky|almalinux)/.test(distroId || '')

    const actions = {
        'install-chromium': {
            label: '重装 Chromium',
            command: 'npx',
            args: ['patchright', 'install', 'chromium']
        },
        'npm-install': {
            label: 'npm install（重装依赖）',
            command: 'npm',
            args: ['install']
        },
        'build': {
            label: 'npm run build',
            command: 'npm',
            args: ['run', 'build']
        },
        upgrade: {
            label: '一键升级（git pull + install + build）',
            command: 'bash',
            args: ['-c', 'git pull --ff-only && npm install && npm run build']
        }
    }

    if (isDebian) {
        actions['install-deps'] = {
            label: 'Chromium 系统库 (Debian/Ubuntu，需 sudo)',
            command: 'bash',
            args: ['-c', 'sudo -n npx patchright install-deps chromium 2>&1 || pkexec npx patchright install-deps chromium']
        }
    } else if (isArch) {
        actions['install-deps'] = {
            label: 'Chromium 系统库 (Arch，需 sudo)',
            command: 'bash',
            args: [
                '-c',
                'sudo -n pacman -S --needed --noconfirm nss atk at-spi2-atk libdrm libxkbcommon mesa libxcomposite libxdamage libxrandr libgbm libxss alsa-lib gtk3'
            ]
        }
    } else if (isFedora) {
        actions['install-deps'] = {
            label: 'Chromium 系统库 (Fedora，需 sudo)',
            command: 'bash',
            args: [
                '-c',
                'sudo -n dnf install -y nss atk at-spi2-atk libdrm libxkbcommon mesa-libgbm libXcomposite libXdamage libXrandr libXScrnSaver alsa-lib gtk3'
            ]
        }
    }

    return actions
}
