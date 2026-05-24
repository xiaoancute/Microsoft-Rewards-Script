import fs from 'fs'
import path from 'path'
import runtimePaths from '../../runtime-paths.cjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { selectRunnableAccounts } = require('../../account-run-policy.cjs')

const {
    getAccountsCandidatePaths,
    getConfigCandidatePaths,
    getCanonicalAccountsPath,
    getCanonicalConfigPath,
    getSessionCandidateDirs
} = runtimePaths

function check(id, label, status, detail, hint = '') {
    return { id, label, status, detail, hint }
}

function readFirstJson(paths) {
    for (const filePath of paths) {
        if (!fs.existsSync(filePath)) continue
        try {
            return {
                path: filePath,
                data: JSON.parse(fs.readFileSync(filePath, 'utf8')),
                error: null
            }
        } catch (error) {
            return {
                path: filePath,
                data: null,
                error
            }
        }
    }
    return null
}

function relative(projectRoot, filePath) {
    if (!filePath) return ''
    return path.relative(projectRoot, filePath) || path.basename(filePath)
}

function isLikelyEmail(value) {
    return typeof value === 'string' && value.includes('@') && !/[/\\\0]|\.\./.test(value)
}

function accountHasProxy(account) {
    return Boolean(account?.proxy?.url && Number(account?.proxy?.port || 0) > 0)
}

function countCookies(filePath) {
    if (!fs.existsSync(filePath)) return 0
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        return Array.isArray(parsed) ? parsed.length : 0
    } catch {
        return 0
    }
}

function sessionSummary(projectRoot, sessionPath, email) {
    const candidates = getSessionCandidateDirs(projectRoot, sessionPath || 'sessions', email)

    for (const base of candidates) {
        const desktop = countCookies(path.join(base, 'session_desktop.json'))
        const mobile = countCookies(path.join(base, 'session_mobile.json'))
        if (desktop > 0 || mobile > 0) {
            return { ok: true, desktop, mobile, base }
        }
    }

    return { ok: false, desktop: 0, mobile: 0, base: candidates[0] }
}

function pathExists(filePath) {
    return fs.existsSync(filePath)
}

function directoryState(projectRoot, name) {
    const dir = path.join(projectRoot, name)
    if (!fs.existsSync(dir)) {
        return { name, exists: false, writable: false }
    }

    try {
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK)
        return { name, exists: true, writable: true }
    } catch {
        return { name, exists: true, writable: false }
    }
}

function summarize(checks) {
    const fail = checks.filter(item => item.status === 'fail').length
    const warn = checks.filter(item => item.status === 'warn').length
    const ok = checks.filter(item => item.status === 'ok').length
    return {
        status: fail > 0 ? 'blocked' : warn > 0 ? 'warning' : 'ready',
        canRun: fail === 0,
        ok,
        warn,
        fail
    }
}

export function buildPreflightReport(
    projectRoot,
    {
        runtime = { isDocker: false, mode: 'local' },
        capabilities = { canOpenBrowserSession: true },
        externalRun = { active: false },
        nodeVersion = process.version
    } = {}
) {
    const checks = []

    const nodeMajor = Number(String(nodeVersion).replace(/^v/, '').split('.')[0])
    checks.push(
        check(
            'node',
            'Node.js 版本',
            nodeMajor >= 24 ? 'ok' : 'fail',
            String(nodeVersion),
            nodeMajor >= 24 ? '' : '需要 Node.js >= 24，否则脚本启动会直接退出。'
        )
    )

    const distPath = path.join(projectRoot, 'dist', 'index.js')
    checks.push(
        check(
            'dist',
            '编译产物',
            pathExists(distPath) ? 'ok' : 'fail',
            pathExists(distPath) ? 'dist/index.js 存在' : 'dist/index.js 缺失',
            pathExists(distPath) ? '' : '先执行 npm run build；Docker 用户需要重新构建镜像。'
        )
    )

    const configResult = readFirstJson(getConfigCandidatePaths(projectRoot))
    const canonicalConfig = getCanonicalConfigPath(projectRoot)
    let config = null
    if (!configResult) {
        checks.push(check('config', '配置文件', 'fail', '未找到 config.json', '需要 config/config.json。'))
    } else if (configResult.error) {
        checks.push(check('config', '配置文件', 'fail', `解析失败: ${configResult.error.message}`, relative(projectRoot, configResult.path)))
    } else {
        config = configResult.data
        const missing = ['baseURL', 'sessionPath', 'workers', 'searchSettings'].filter(key => !(key in config))
        const usingCanonical = configResult.path === canonicalConfig
        checks.push(
            check(
                'config',
                '配置文件',
                missing.length ? 'fail' : usingCanonical ? 'ok' : 'warn',
                missing.length
                    ? `缺少字段: ${missing.join(', ')}`
                    : usingCanonical
                        ? 'config/config.json 可用'
                        : `兼容读取 ${relative(projectRoot, configResult.path)}`,
                missing.length
                    ? '到「配置」Tab 保存一次，或按 config.example.json 补齐。'
                    : usingCanonical
                        ? ''
                        : '建议保存一次配置，收口到 config/config.json。'
            )
        )
    }

    const accountsResult = readFirstJson(getAccountsCandidatePaths(projectRoot, false))
    const canonicalAccounts = getCanonicalAccountsPath(projectRoot)
    let accounts = []
    let runnableAccounts = []
    if (!accountsResult) {
        checks.push(check('accounts', '账号文件', 'fail', '未找到 accounts.json', '需要 config/accounts.json。'))
    } else if (accountsResult.error) {
        checks.push(check('accounts', '账号文件', 'fail', `解析失败: ${accountsResult.error.message}`, relative(projectRoot, accountsResult.path)))
    } else if (!Array.isArray(accountsResult.data) || accountsResult.data.length === 0) {
        checks.push(check('accounts', '账号文件', 'fail', '没有可运行账号', '到「账号」Tab 添加账号。'))
    } else {
        accounts = accountsResult.data.filter(Boolean)
        const invalidEmails = accounts.map(item => item.email).filter(email => !isLikelyEmail(email))
        const missingPasswords = accounts.filter(item => !item.password).map(item => item.email || '(空邮箱)')
        const usingCanonical = accountsResult.path === canonicalAccounts
        const status = invalidEmails.length || missingPasswords.length ? 'fail' : usingCanonical ? 'ok' : 'warn'
        const detail = invalidEmails.length
            ? `邮箱格式异常: ${invalidEmails.join(', ')}`
            : missingPasswords.length
                ? `缺少密码: ${missingPasswords.join(', ')}`
                : usingCanonical
                    ? `${accounts.length} 个账号`
                    : `${accounts.length} 个账号，兼容读取 ${relative(projectRoot, accountsResult.path)}`
        checks.push(
            check(
                'accounts',
                '账号文件',
                status,
                detail,
                status === 'fail'
                    ? '请修正账号邮箱/密码后再运行。'
                    : usingCanonical
                        ? ''
                        : '建议保存一次账号，收口到 config/accounts.json。'
            )
        )
    }

    if (accounts.length > 0 && config) {
        const selection = selectRunnableAccounts({
            projectRoot,
            accounts,
            config,
            now: Date.now()
        })
        runnableAccounts = selection.runnable
        const skipped = selection.skipped
        const status = runnableAccounts.length === 0 ? 'fail' : skipped.length > 0 ? 'warn' : 'ok'
        checks.push(
            check(
                'account-policy',
                '账号运行策略',
                status,
                `${runnableAccounts.length}/${accounts.length} 个账号可运行`,
                skipped.length
                    ? `已跳过: ${skipped
                          .slice(0, 5)
                          .map(item => `${item.email}(${item.reason})`)
                          .join(', ')}${skipped.length > 5 ? '...' : ''}`
                    : ''
            )
        )
    } else {
        runnableAccounts = accounts
    }

    const sessionPath = config?.sessionPath || 'sessions'
    if (runnableAccounts.length > 0) {
        const missingSessions = []
        let availableSessions = 0
        for (const account of runnableAccounts) {
            if (!isLikelyEmail(account.email)) continue
            const session = sessionSummary(projectRoot, sessionPath, account.email)
            if (session.ok) availableSessions++
            else missingSessions.push(account.email)
        }

        if (missingSessions.length === 0) {
            checks.push(check('sessions', '登录 Session', 'ok', `${availableSessions}/${runnableAccounts.length} 个可运行账号已有 cookies`))
        } else {
            const dockerBlocked = Boolean(runtime?.isDocker) && !capabilities.canOpenBrowserSession
            checks.push(
                check(
                    'sessions',
                    '登录 Session',
                    dockerBlocked ? 'fail' : 'warn',
                    `缺少 ${missingSessions.length} 个账号: ${missingSessions.slice(0, 5).join(', ')}${missingSessions.length > 5 ? '...' : ''}`,
                    dockerBlocked
                        ? 'Docker 里不能弹浏览器登录，请先在本地生成 session 后挂载 sessions/。'
                        : '本地模式可以到 Session Tab 打开浏览器完成登录。'
                )
            )
        }
    }

    if (externalRun?.active) {
        const runLabel = externalRun.source === 'local-run-lock' ? '本地脚本' : '容器任务'
        checks.push(
            check(
                'external-run',
                '运行互斥',
                'fail',
                `已有${runLabel}运行中${externalRun.pid ? `，PID ${externalRun.pid}` : ''}`,
                '等当前任务结束后再手动运行。'
            )
        )
    } else {
        checks.push(check('external-run', '运行互斥', 'ok', '没有检测到外部运行锁'))
    }

    if ((config?.clusters || 1) > 1) {
        const noProxy = accounts.filter(account => isLikelyEmail(account.email) && !accountHasProxy(account))
        checks.push(
            check(
                'proxy-spread',
                '多账号出口',
                noProxy.length >= 2 ? 'warn' : 'ok',
                noProxy.length >= 2
                    ? `${noProxy.length} 个账号未配置代理`
                    : '多账号出口配置未发现明显风险',
                noProxy.length >= 2 ? '多账号并发共用同一出口更容易触发风控。' : ''
            )
        )
    } else {
        checks.push(check('proxy-spread', '多账号出口', 'ok', '单账号/单集群运行'))
    }

    const storage = ['config', sessionPath, 'logs', 'reports'].map(name => directoryState(projectRoot, name))
    const blockedStorage = storage.filter(item => item.exists && !item.writable)
    const missingStorage = storage.filter(item => !item.exists)
    checks.push(
        check(
            'storage',
            '运行目录',
            blockedStorage.length ? 'fail' : missingStorage.length ? 'warn' : 'ok',
            blockedStorage.length
                ? `不可写: ${blockedStorage.map(item => item.name).join(', ')}`
                : missingStorage.length
                    ? `尚未创建: ${missingStorage.map(item => item.name).join(', ')}`
                    : 'config / sessions / logs / reports 可访问',
            blockedStorage.length
                ? '修正目录权限后再运行。'
                : missingStorage.length
                    ? '脚本通常会自动创建缺失目录；Docker 用户建议确认宿主机挂载目录存在。'
                    : ''
        )
    )

    return {
        generatedAt: new Date().toISOString(),
        runtime: {
            mode: runtime?.mode || (runtime?.isDocker ? 'docker' : 'local'),
            isDocker: Boolean(runtime?.isDocker)
        },
        summary: summarize(checks),
        checks
    }
}
