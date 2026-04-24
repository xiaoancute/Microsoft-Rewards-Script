import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const readline = require('node:readline')

async function loadLogin() {
    const mod = await import('../../dist/browser/auth/Login.js')
    return mod.Login
}

async function loadTotpLogin() {
    const mod = await import('../../dist/browser/auth/methods/Totp2FALogin.js')
    return mod.TotpLogin
}

async function loadCodeLogin() {
    const mod = await import('../../dist/browser/auth/methods/GetACodeLogin.js')
    return mod.CodeLogin
}

async function loadRecoveryLogin() {
    const mod = await import('../../dist/browser/auth/methods/RecoveryEmailLogin.js')
    return mod.RecoveryLogin
}

async function loadPasswordlessLogin() {
    const mod = await import('../../dist/browser/auth/methods/PasswordlessLogin.js')
    return mod.PasswordlessLogin
}

async function loadMobileAccessLogin() {
    const mod = await import('../../dist/browser/auth/methods/MobileAccessLogin.js')
    return mod.MobileAccessLogin
}

function createBot(overrides = {}) {
    return {
        isMobile: true,
        config: {
            baseURL: 'https://rewards.bing.com',
            sessionPath: 'sessions'
        },
        logger: {
            info() {},
            warn() {},
            error() {},
            debug() {},
            alert() {}
        },
        browser: {
            utils: {
                async ghostClick() {},
                async disableFido() {},
                async reloadBadPage() {},
                async tryDismissAllMessages() {},
                async loadInCheerio() {
                    return () => ({ attr() { return null } })
                }
            }
        },
        utils: {
            async wait() {}
        },
        axios: {
            async request() {
                return { data: {} }
            }
        },
        ...overrides
    }
}

function createAccount(overrides = {}) {
    return {
        email: 'test@example.com',
        password: 'pw',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        recoveryEmail: 'recovery@example.com',
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
        },
        ...overrides
    }
}

async function withMockedReadline(answers, fn) {
    const original = readline.createInterface
    let index = 0

    readline.createInterface = () => ({
        question(_question, callback) {
            callback(answers[index++] ?? '')
        },
        close() {}
    })

    try {
        return await fn()
    } finally {
        readline.createInterface = original
    }
}

test('TotpLogin.handle fails when submitted code does not advance the page', async () => {
    const TotpLogin = await loadTotpLogin()
    const bot = createBot({
        browser: {
            utils: {
                async ghostClick() {}
            }
        }
    })
    const login = new TotpLogin(bot)

    const totpInput = {
        async fill() {}
    }

    const page = {
        url() {
            return 'https://login.live.com/ppsecure/post.srf'
        },
        async waitForSelector(selector) {
            if (
                selector === 'form[name="OneTimeCodeViewForm"] input[type="text"], input#floatingLabelInput5' ||
                selector === 'input[name="otc"]'
            ) {
                return totpInput
            }
            throw new Error(`unexpected selector ${selector}`)
        },
        async $(selector) {
            if (selector === 'input[id="otc-confirmation-input"], input[name="otc"]') {
                return totpInput
            }
            return null
        },
        async waitForLoadState() {}
    }

    await assert.rejects(() => login.handle(page, 'JBSWY3DPEHPK3PXP'), /未推进|失败|未找到/)
})

test('CodeLogin.handle uses mobile-safe select-all shortcut before retrying', async () => {
    const CodeLogin = await loadCodeLogin()
    const keyboardCalls = []
    let errorReads = 0
    let currentUrl = 'https://login.live.com/code-entry'

    const bot = createBot({
        browser: {
            utils: {
                async humanType() {}
            }
        }
    })

    const answers = ['123456', '654321']
    class TestCodeLogin extends CodeLogin {
        async requestManualCode() {
            return answers.shift() ?? null
        }
    }
    const login = new TestCodeLogin(bot)

    const input = {
        async click() {}
    }

    const page = {
        url() {
            return currentUrl
        },
        async waitForSelector(selector) {
            if (selector === '[data-testid="codeInputWrapper"]') {
                if (errorReads >= 2) throw new Error('input gone')
                return input
            }
            if (selector === 'div[role="alert"]') {
                if (errorReads++ === 0) {
                    return {
                        async innerText() {
                            return 'wrong code'
                        }
                    }
                }
                throw new Error('no alert')
            }
            throw new Error(`unexpected selector ${selector}`)
        },
        async $(selector) {
            if (selector === '[data-testid="codeInputWrapper"]') return input
            return null
        },
        async waitForLoadState() {},
        keyboard: {
            async press(key) {
                keyboardCalls.push(key)
            }
        }
    }

    await login.handle(page)

    assert.equal(keyboardCalls.includes('Meta+A'), true)
    assert.equal(keyboardCalls.includes('Backspace'), true)
})

test('RecoveryLogin.handle uses mobile-safe select-all shortcut before retrying', async () => {
    const RecoveryLogin = await loadRecoveryLogin()
    const keyboardCalls = []
    let errorReads = 0
    let currentUrl = 'https://login.live.com/recovery-email'

    const bot = createBot({
        browser: {
            utils: {
                async humanType() {}
            }
        }
    })

    const answers = ['recovery@example.com', 'recovery@example.com']
    class TestRecoveryLogin extends RecoveryLogin {
        async requestManualEmail() {
            return answers.shift() ?? null
        }
    }
    const login = new TestRecoveryLogin(bot)

    const input = {
        async click() {}
    }

    const page = {
        url() {
            return currentUrl
        },
        async waitForSelector(selector) {
            if (selector === '[data-testid="proof-confirmation"]') {
                if (errorReads >= 2) throw new Error('input gone')
                return input
            }
            if (selector === 'div[role="alert"]') {
                if (errorReads++ === 0) {
                    return {
                        async innerText() {
                            return 'wrong email'
                        }
                    }
                }
                throw new Error('no alert')
            }
            throw new Error(`unexpected selector ${selector}`)
        },
        async $(selector) {
            if (selector === '[data-testid="proof-confirmation"]') return input
            return null
        },
        async waitForLoadState() {},
        keyboard: {
            async press(key) {
                keyboardCalls.push(key)
            }
        }
    }

    await login.handle(page, '')

    assert.equal(keyboardCalls.includes('Meta+A'), true)
    assert.equal(keyboardCalls.includes('Backspace'), true)
})

test('PasswordlessLogin.handle accepts approval when the waiting prompt disappears', async () => {
    const PasswordlessLogin = await loadPasswordlessLogin()
    let waitCalls = 0
    let displayVisible = true

    const bot = createBot({
        utils: {
            async wait() {
                waitCalls++
                if (waitCalls >= 2) displayVisible = false
            }
        }
    })

    const login = new PasswordlessLogin(bot)

    const page = {
        url() {
            return 'https://login.live.com/approve?challenge=1'
        },
        async waitForSelector(selector) {
            if (selector === 'div[data-testid="displaySign"]' && displayVisible) {
                return {
                    async textContent() {
                        return '42'
                    }
                }
            }
            throw new Error(`selector not found: ${selector}`)
        },
        async waitForLoadState() {}
    }

    await login.handle(page)
})

test('MobileAccessLogin.get stops polling immediately on explicit OAuth error redirects', async () => {
    const MobileAccessLogin = await loadMobileAccessLogin()
    let waitCalls = 0
    let tokenRequests = 0

    const bot = createBot({
        browser: {
            utils: {
                async disableFido() {},
                async ghostClick() {}
            }
        },
        utils: {
            async wait() {
                waitCalls++
            }
        },
        axios: {
            async request() {
                tokenRequests++
                return { data: {} }
            }
        }
    })

    const page = {
        async goto() {},
        url() {
            return 'https://login.live.com/oauth20_desktop.srf?error=access_denied&error_description=Denied'
        },
        async waitForSelector() {
            throw new Error('not found')
        },
        async waitForLoadState() {}
    }

    const login = new MobileAccessLogin(bot, page)
    login.maxTimeout = 20

    const token = await login.get('test@example.com')

    assert.equal(token, '')
    assert.equal(waitCalls, 0)
    assert.equal(tokenRequests, 0)
})

test('Login.login stops after repeated welcome-page recovery loops', async () => {
    const Login = await loadLogin()
    const bot = createBot()
    const login = new Login(bot)

    login.detectCurrentState = async () => 'REWARDS_WELCOME'

    const page = {
        isClosed() {
            return false
        },
        url() {
            return 'https://rewards.bing.com/welcome'
        },
        async goto() {},
        async reload() {},
        async waitForLoadState() {},
        context() {
            return {
                async cookies() {
                    return []
                }
            }
        }
    }

    await assert.rejects(() => login.login(page, createAccount()), /欢迎页恢复次数过多|恢复循环/)
})
