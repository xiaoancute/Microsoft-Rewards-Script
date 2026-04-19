import fs from 'fs'
import path from 'path'
import { chromium } from 'patchright'
import { newInjectedContext } from 'fingerprint-injector'
import {
    getDirname,
    getProjectRoot,
    log,
    parseArgs,
    validateEmail,
    loadConfig,
    loadAccounts,
    findAccountByEmail,
    getRuntimeBase,
    buildProxyConfig
} from '../utils.js'
import { getBrowserSessionState } from './browserSessionSupport.js'

const __dirname = getDirname(import.meta.url)
const projectRoot = getProjectRoot(__dirname)

const args = parseArgs()
args.dev = args.dev || false

validateEmail(args.email)

const { data: config } = loadConfig(projectRoot, args.dev)
const { data: accounts } = loadAccounts(projectRoot, args.dev)

const account = findAccountByEmail(accounts, args.email)
if (!account) {
    log('ERROR', `未找到账户: ${args.email}`)
    log('ERROR', '可用账户:')
    accounts.forEach(acc => {
        if (acc?.email) log('ERROR', `  - ${acc.email}`)
    })
    process.exit(1)
}

async function main() {
    const runtimeBase = getRuntimeBase(projectRoot, args.dev)
    log('INFO', '验证会话数据...')

    if (!config.baseURL) {
        log('ERROR', 'baseURL 在 config.json 中未设置')
        process.exit(1)
    }

    const session = await getBrowserSessionState({
        runtimeBase,
        sessionPath: config.sessionPath,
        email: args.email,
        saveFingerprint: account.saveFingerprint
    }).catch(error => {
        log('ERROR', error.message)
        process.exit(1)
    })

    const { sessionBase, sessionType, isExistingSession, isMobile, fingerprintEnabled, cookies, fingerprint } = session

    if (isExistingSession) {
        if (sessionType === 'mobile') {
            log('INFO', `使用移动会话 (${cookies.length} 个 cookies)`)
        } else {
            log('INFO', `使用桌面会话 (${cookies.length} 个 cookies)`)
        }
        if (fingerprint) {
            log('INFO', `已加载 ${sessionType} 指纹`)
        } else if (fingerprintEnabled) {
            log('WARN', `${sessionType} 已启用指纹保存，但当前未找到指纹文件，将以默认上下文继续`)
        }
    } else {
        log('WARN', `未找到 ${args.email} 的现有 session，将启动全新浏览器用于首次登录`)
        log('INFO', `首次登录成功后会把 cookies 保存到: ${sessionBase}`)
    }

    const proxy = buildProxyConfig(account)

    if (account.proxy && account.proxy.url && (!proxy || !proxy.server)) {
        log('ERROR', '账户中配置了代理但代理数据无效或不完整')
        log('ERROR', '账户代理配置:', JSON.stringify(account.proxy, null, 2))
        log('ERROR', '必需字段: proxy.url, proxy.port')
        log('ERROR', '当明确配置代理时，无法在没有代理的情况下启动浏览器')
        process.exit(1)
    }

    const userAgent = fingerprint?.fingerprint?.navigator?.userAgent || fingerprint?.fingerprint?.userAgent || null

    log('INFO', `会话: ${args.email} (${sessionType})`)
    log('INFO', `  Cookies: ${cookies.length}${isExistingSession ? '' : ' (首次登录前为空)'}`)
    log('INFO', `  指纹: ${fingerprint ? '是' : '否'}`)
    log('INFO', `  用户代理: ${userAgent || '默认'}`)
    log('INFO', `  代理: ${proxy ? '是' : '否'}`)
    log('INFO', '正在启动浏览器...')

    const browser = await chromium.launch({
        headless: false,
        ...(proxy ? { proxy } : {}),
        args: [
            '--no-sandbox',
            '--mute-audio',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--ignore-ssl-errors',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-user-media-security=true',
            '--disable-blink-features=Attestation',
            '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys',
            '--disable-save-password-bubble'
        ]
    })

    let context
    if (fingerprint) {
        context = await newInjectedContext(browser, { fingerprint })

        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'credentials', {
                value: {
                    create: () => Promise.reject(new Error('WebAuthn disabled')),
                    get: () => Promise.reject(new Error('WebAuthn disabled'))
                }
            })
        })

        log('SUCCESS', '指纹已注入到浏览器上下文中')
    } else {
        context = await browser.newContext({
            viewport: isMobile ? { width: 375, height: 667 } : { width: 1366, height: 768 }
        })
    }

    if (cookies.length) {
        await context.addCookies(cookies)
        log('INFO', `添加了 ${cookies.length} 个 cookies 到上下文`)
    }

    const page = await context.newPage()
    const cookiesFile = path.join(sessionBase, `session_${sessionType}.json`)

    let shuttingDown = false
    let autosaveTimer
    const persistCookies = async (reason = 'autosave') => {
        try {
            if (!context) {
                return
            }

            const latestCookies = await context.cookies()
            if (!latestCookies.length) {
                return
            }

            await fs.promises.mkdir(sessionBase, { recursive: true })
            await fs.promises.writeFile(cookiesFile, JSON.stringify(latestCookies, null, 2), 'utf8')
            log('INFO', `[${reason}] 已保存 ${latestCookies.length} 个 cookies 到 ${cookiesFile}`)
        } catch (error) {
            log('WARN', `[${reason}] 保存 cookies 失败: ${error.message}`)
        }
    }

    const shutdown = async (signal = 'browser-closed') => {
        if (shuttingDown) {
            return
        }
        shuttingDown = true

        if (autosaveTimer) {
            clearInterval(autosaveTimer)
        }

        await persistCookies(signal)

        try {
            if (browser?.isConnected?.()) {
                await browser.close()
            }
        } catch {}

        process.exit(0)
    }

    page.on('framenavigated', () => {
        void persistCookies('navigation')
    })
    page.on('close', () => {
        void shutdown('page-close')
    })
    browser.on('disconnected', () => {
        void shutdown('browser-disconnected')
    })
    autosaveTimer = setInterval(() => {
        void persistCookies('interval')
    }, 5000)
    autosaveTimer.unref()

    await page.goto(config.baseURL, { waitUntil: 'domcontentloaded' })

    log('SUCCESS', '浏览器已打开并加载了会话')
    log('INFO', `导航至: ${config.baseURL}`)

    process.on('SIGINT', () => {
        void shutdown('SIGINT')
    })
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM')
    })
}

main()
