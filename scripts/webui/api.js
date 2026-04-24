import fs from 'fs'
import path from 'path'
import {
    getProjectRoot,
    log,
    loadJsonFile,
    loadConfig as baseLoadConfig,
    loadAccounts as baseLoadAccounts,
    getCanonicalAccountsFile,
    getCanonicalConfigFile,
    getAccountsExampleFile,
    getConfigExampleFile,
    getSessionPath,
    getSessionPathCandidates,
    getSessionRootPaths,
    loadCookies,
    loadFingerprint,
    safeRemoveDirectory,
    validateDeletionPath
} from '../utils.js'

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

export function findProjectRoot(startDir) {
    return getProjectRoot(startDir)
}

function accountsPath(projectRoot) {
    return getCanonicalAccountsFile(projectRoot)
}

function accountsExamplePath(projectRoot) {
    return getAccountsExampleFile(projectRoot)
}

function configPath(projectRoot) {
    return getCanonicalConfigFile(projectRoot)
}

function configExamplePath(projectRoot) {
    return getConfigExampleFile(projectRoot)
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic JSON write (tmp + rename)
// ─────────────────────────────────────────────────────────────────────────────

async function writeJsonAtomic(filePath, data) {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
    }
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
    const content = JSON.stringify(data, null, 4)
    await fs.promises.writeFile(tmp, content, 'utf8')
    await fs.promises.rename(tmp, filePath)
}

// ─────────────────────────────────────────────────────────────────────────────
// Email sanitation — 拆两层：
//   assertSafeEmailKey  只阻止路径遍历/控制字符，允许 email_1 这类占位符
//                       用途：删/改账号、删 session、打开浏览器（拼路径前守门）
//   assertValidEmail    严格要求 @（看起来像邮箱）
//                       用途：新增账号时强制用户填真实邮箱
// ─────────────────────────────────────────────────────────────────────────────

function assertSafeEmailKey(email) {
    if (!email || typeof email !== 'string') {
        throw Object.assign(new Error('邮箱必填'), { status: 400 })
    }
    if (/[/\\\0]|\.\./.test(email)) {
        throw Object.assign(new Error(`邮箱包含非法字符: ${email}`), { status: 400 })
    }
    if (email.length === 0 || email.length > 254) {
        throw Object.assign(new Error('邮箱长度非法'), { status: 400 })
    }
    // 禁止控制字符（换行、回车、制表符等）
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(email)) {
        throw Object.assign(new Error('邮箱包含控制字符'), { status: 400 })
    }
}

function assertValidEmail(email) {
    assertSafeEmailKey(email)
    if (!email.includes('@')) {
        throw Object.assign(new Error(`邮箱格式无效: ${email}`), { status: 400 })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

function readAccountsRaw(projectRoot) {
    const target = baseLoadAccounts(projectRoot, false)
    if (target.path !== accountsExamplePath(projectRoot)) {
        return target.data
    }

    // First run: seed from example so the UI always has something editable.
    if (fs.existsSync(accountsExamplePath(projectRoot))) {
        return []
    }
    throw new Error('accounts.json 与 accounts.example.json 都不存在')
}

function sanitizeAccountForWire(account) {
    if (!account || typeof account !== 'object') return account
    const { password, proxy, totpSecret, ...rest } = account
    return {
        ...rest,
        hasPassword: Boolean(password),
        hasTotpSecret: Boolean(totpSecret),
        proxy: proxy ? { ...proxy, password: proxy.password ? '***' : '' } : undefined
    }
}

export function listAccounts(projectRoot) {
    const accounts = readAccountsRaw(projectRoot)
    return accounts.map(sanitizeAccountForWire)
}

function defaultAccount(email, password) {
    return {
        email,
        password,
        totpSecret: '',
        recoveryEmail: '',
        geoLocale: 'auto',
        langCode: 'zh',
        proxy: {
            proxyAxios: false,
            url: '',
            port: 0,
            username: '',
            password: ''
        },
        saveFingerprint: {
            mobile: true,
            desktop: true
        }
    }
}

function mergeAccountUpdate(existing, patch) {
    const merged = { ...existing }
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue
        if (key === 'password' && (value === '' || value === '***')) continue
        if (key === 'totpSecret' && value === '***') continue
        if (key === 'proxy' && value && typeof value === 'object') {
            merged.proxy = { ...(existing.proxy || {}), ...value }
            if (value.password === '' || value.password === '***') {
                merged.proxy.password = existing.proxy?.password || ''
            }
            continue
        }
        merged[key] = value
    }
    return merged
}

export async function addAccount(projectRoot, payload) {
    assertValidEmail(payload?.email)
    if (!payload.password || typeof payload.password !== 'string') {
        throw Object.assign(new Error('密码必填'), { status: 400 })
    }

    const accounts = readAccountsRaw(projectRoot)
    if (accounts.find(a => a?.email?.toLowerCase() === payload.email.toLowerCase())) {
        throw new Error('该邮箱已存在')
    }
    const next = defaultAccount(payload.email, payload.password)
    const merged = mergeAccountUpdate(next, payload)
    accounts.push(merged)
    await writeJsonAtomic(accountsPath(projectRoot), accounts)
    return sanitizeAccountForWire(merged)
}

export async function updateAccount(projectRoot, email, patch) {
    assertSafeEmailKey(email)
    const accounts = readAccountsRaw(projectRoot)
    const idx = accounts.findIndex(a => a?.email?.toLowerCase() === email.toLowerCase())
    if (idx === -1) throw Object.assign(new Error(`未找到账户: ${email}`), { status: 404 })
    accounts[idx] = mergeAccountUpdate(accounts[idx], patch)
    await writeJsonAtomic(accountsPath(projectRoot), accounts)
    return sanitizeAccountForWire(accounts[idx])
}

export async function removeAccount(projectRoot, email) {
    assertSafeEmailKey(email)
    const accounts = readAccountsRaw(projectRoot)
    const next = accounts.filter(a => a?.email?.toLowerCase() !== email.toLowerCase())
    if (next.length === accounts.length) throw Object.assign(new Error(`未找到账户: ${email}`), { status: 404 })
    await writeJsonAtomic(accountsPath(projectRoot), next)
    return { email }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

function resolveSessionBaseCandidates(projectRoot, sessionPath, email) {
    return getSessionPathCandidates(projectRoot, sessionPath, email)
}

function pickExistingSessionBase(projectRoot, sessionPath, email) {
    const candidates = resolveSessionBaseCandidates(projectRoot, sessionPath, email)
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    return candidates[0]
}

function statSafe(filePath) {
    try {
        return fs.statSync(filePath)
    } catch {
        return null
    }
}

export async function listSessions(projectRoot) {
    const config = readConfig(projectRoot)
    const accounts = readAccountsRaw(projectRoot)
    const sessionPath = config.sessionPath || 'sessions'

    return await Promise.all(
        accounts.map(async account => {
            const email = account?.email
            if (!email) return null
            const base = pickExistingSessionBase(projectRoot, sessionPath, email)
            const desktopCookies = await loadCookies(base, 'desktop')
            const mobileCookies = await loadCookies(base, 'mobile')
            const desktopFp = await loadFingerprint(base, 'desktop')
            const mobileFp = await loadFingerprint(base, 'mobile')
            const canonicalBase = getSessionPath(projectRoot, sessionPath, email)

            const cookieFile = (type) => path.join(base, `session_${type}.json`)
            const latestMtime = ['desktop', 'mobile']
                .map(t => statSafe(cookieFile(t))?.mtimeMs || 0)
                .reduce((a, b) => Math.max(a, b), 0)

            return {
                email,
                baseDir: canonicalBase,
                sourceBaseDir: base,
                exists: fs.existsSync(base),
                desktop: {
                    cookies: desktopCookies.length,
                    fingerprint: Boolean(desktopFp)
                },
                mobile: {
                    cookies: mobileCookies.length,
                    fingerprint: Boolean(mobileFp)
                },
                lastLoginAt: latestMtime ? new Date(latestMtime).toISOString() : null,
                isLoggedIn: desktopCookies.length > 0 || mobileCookies.length > 0
            }
        })
    ).then(items => items.filter(Boolean))
}

export function removeOneSession(projectRoot, email) {
    assertSafeEmailKey(email)
    const config = readConfig(projectRoot)
    const sessionPath = config.sessionPath || 'sessions'
    const bases = resolveSessionBaseCandidates(projectRoot, sessionPath, email)
    let removedAny = false
    for (const base of bases) {
        const validation = validateDeletionPath(base, projectRoot)
        if (!validation.valid) {
            throw new Error(`路径校验失败: ${validation.error}`)
        }
        if (fs.existsSync(base)) {
            const ok = safeRemoveDirectory(base, projectRoot)
            if (!ok) throw new Error(`删除失败: ${base}`)
            removedAny = true
        }
    }
    return { email, removed: removedAny }
}

export function removeAllSessions(projectRoot) {
    const config = readConfig(projectRoot)
    const sessionPath = config.sessionPath || 'sessions'
    const roots = getSessionRootPaths(projectRoot, sessionPath)
    let removed = 0
    for (const root of roots) {
        if (!fs.existsSync(root)) continue
        const validation = validateDeletionPath(root, projectRoot)
        if (!validation.valid) {
            throw new Error(`路径校验失败: ${validation.error}`)
        }
        const ok = safeRemoveDirectory(root, projectRoot)
        if (!ok) throw new Error(`删除失败: ${root}`)
        removed += 1
    }
    return { removed }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

function readConfig(projectRoot) {
    const result = baseLoadConfig(projectRoot, false)
    if (result.path) {
        return result.data
    }
    throw new Error('config.json 与 config.example.json 都不存在')
}

export function getConfig(projectRoot) {
    return readConfig(projectRoot)
}

function validateConfigShape(config) {
    if (!config || typeof config !== 'object') throw new Error('config 必须是对象')
    const required = ['baseURL', 'sessionPath', 'headless', 'workers', 'searchSettings']
    for (const key of required) {
        if (!(key in config)) throw new Error(`config 缺少字段: ${key}`)
    }
    if (typeof config.baseURL !== 'string') throw new Error('baseURL 必须是字符串')
    if (typeof config.sessionPath !== 'string') throw new Error('sessionPath 必须是字符串')
    if (typeof config.headless !== 'boolean') throw new Error('headless 必须是布尔')
    if (config.clusters !== undefined && typeof config.clusters !== 'number')
        throw new Error('clusters 必须是数字')
    if (!config.workers || typeof config.workers !== 'object') throw new Error('workers 必须是对象')
    if (!config.searchSettings || typeof config.searchSettings !== 'object')
        throw new Error('searchSettings 必须是对象')
}

export async function saveConfig(projectRoot, next) {
    validateConfigShape(next)
    await writeJsonAtomic(configPath(projectRoot), next)
    return next
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

export function getStatus(projectRoot, runner) {
    const distBuilt = fs.existsSync(path.join(projectRoot, 'dist', 'index.js'))
    const accounts = baseLoadAccounts(projectRoot, false)
    const config = baseLoadConfig(projectRoot, false)
    const canonicalAccounts = accountsPath(projectRoot)
    const canonicalConfig = configPath(projectRoot)
    const accountsSource = accounts?.path && accounts.path !== accountsExamplePath(projectRoot) ? accounts.path : null
    const configSource = config?.path && config.path !== configExamplePath(projectRoot) ? config.path : null
    return {
        nodeVersion: process.version,
        projectRoot,
        distBuilt,
        accountsExists: Boolean(accountsSource),
        configExists: Boolean(configSource),
        accountsPath: accountsSource,
        configPath: configSource,
        canonicalAccountsExists: fs.existsSync(canonicalAccounts),
        canonicalConfigExists: fs.existsSync(canonicalConfig),
        canonicalAccountsPath: canonicalAccounts,
        canonicalConfigPath: canonicalConfig,
        jobs: runner.snapshot()
    }
}

// Re-export utility helpers for server.js
export { log, baseLoadConfig, baseLoadAccounts }
