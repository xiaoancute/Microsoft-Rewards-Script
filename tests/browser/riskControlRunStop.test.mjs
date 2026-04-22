import test from 'node:test'
import assert from 'node:assert/strict'

async function loadBotModule() {
    return await import('../../dist/index.js')
}

function createAccount(email) {
    return {
        email,
        password: '',
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

test('runTasks rethrows RiskControlDetectedError instead of continuing to the next account', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const { RiskControlDetectedError } = await import('../../dist/browser/RiskControlDetector.js')

    const bot = Object.create(MicrosoftRewardsBot.prototype)
    bot.config = { clusters: 2, riskControlStop: { enabled: true } }
    bot.logger = { info() {}, warn() {}, error() {}, debug() {}, alert() {} }
    bot.userData = { userName: '' }
    bot.utils = {
        getEmailUsername(email) {
            return email.split('@')[0]
        },
        shuffleArray(items) {
            return items
        }
    }

    const processed = []

    bot.Main = async account => {
        processed.push(account.email)

        if (account.email === 'first@example.com') {
            throw new RiskControlDetectedError({
                accountEmail: account.email,
                stage: 'dashboard-after-login',
                matchedSelector: '#suspendedAccountHeader',
                matchedText: null,
                message: 'stop now'
            })
        }

        return { initialPoints: 0, collectedPoints: 0 }
    }

    await assert.rejects(
        () => bot.runTasks([createAccount('first@example.com'), createAccount('second@example.com')], Date.now()),
        /stop now/
    )

    assert.deepEqual(processed, ['first@example.com'])
})

test('beginRiskControlShutdown kills sibling workers only once', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod

    const bot = Object.create(MicrosoftRewardsBot.prototype)
    bot.logger = { info() {}, warn() {}, error() {}, debug() {}, alert() {} }
    bot.riskControlStopping = false

    const kills = []
    const workerA = {
        process: { pid: 111 },
        kill(signal) {
            kills.push(['a', signal])
        }
    }
    const workerB = {
        process: { pid: 222 },
        kill(signal) {
            kills.push(['b', signal])
        }
    }

    bot.beginRiskControlShutdown(
        {
            accountEmail: 'risk@example.com',
            stage: 'search-after-run',
            matchedSelector: null,
            matchedText: 'unusual activity',
            message: 'risk hit'
        },
        [workerA, workerB]
    )

    bot.beginRiskControlShutdown(
        {
            accountEmail: 'risk@example.com',
            stage: 'search-after-run',
            matchedSelector: null,
            matchedText: 'unusual activity',
            message: 'risk hit'
        },
        [workerA, workerB]
    )

    assert.deepEqual(kills, [
        ['a', 'SIGTERM'],
        ['b', 'SIGTERM']
    ])
})
