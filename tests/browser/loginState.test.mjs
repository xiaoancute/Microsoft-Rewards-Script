import test from 'node:test'
import assert from 'node:assert/strict'

async function loadLogin() {
    const mod = await import('../../dist/browser/auth/Login.js')
    return mod.Login
}

function createBot() {
    return {
        isMobile: true,
        config: {
            baseURL: 'https://rewards.bing.com'
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
                async ghostClick() {}
            }
        },
        utils: {
            async wait() {}
        }
    }
}

function createPage(url, overrides = {}) {
    return {
        url() {
            return url
        },
        async waitForLoadState() {},
        async waitForSelector() {
            throw new Error('not found')
        },
        async goto() {},
        ...overrides
    }
}

test('Login.detectCurrentState treats rewards welcome as a separate anonymous state', async () => {
    const Login = await loadLogin()
    const login = new Login(createBot())

    const state = await login.detectCurrentState(createPage('https://rewards.bing.com/welcome'))

    assert.equal(state, 'REWARDS_WELCOME')
})

test('Login.detectCurrentState still treats dashboard pages as logged in', async () => {
    const Login = await loadLogin()
    const login = new Login(createBot())

    const state = await login.detectCurrentState(createPage('https://rewards.bing.com/dashboard'))

    assert.equal(state, 'LOGGED_IN')
})

test('Login.handleState navigates back into the sign-in flow from rewards welcome', async () => {
    const Login = await loadLogin()
    const bot = createBot()
    const login = new Login(bot)
    const navigations = []

    const page = createPage('https://rewards.bing.com/welcome', {
        async goto(target) {
            navigations.push(target)
        }
    })

    const result = await login.handleState('REWARDS_WELCOME', page, {
        email: 'test@example.com',
        password: 'pw',
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
    })

    assert.equal(result, true)
    assert.equal(
        navigations[0],
        'https://rewards.bing.com/createuser?idru=%2F&userScenarioId=anonsignin'
    )
})
