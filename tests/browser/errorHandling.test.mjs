import test from 'node:test'
import assert from 'node:assert/strict'

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

function makePromotion(overrides = {}) {
    return {
        offerId: 'offer-1',
        title: 'Promotion',
        promotionType: 'quiz',
        destinationUrl: 'https://rewards.bing.com/task?pollScenarioId=42',
        pointProgressMax: 10,
        activityProgressMax: 10,
        complete: false,
        exclusiveLockedFeatureStatus: 'unlocked',
        ...overrides
    }
}

function createWorkerBot(overrides = {}) {
    return {
        isMobile: false,
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {},
            alert() {}
        },
        utils: {
            getFormattedDate() {
                return '04/23/2026'
            },
            async wait() {},
            randomDelay() {
                return 0
            }
        },
        activities: {
            async doDailyCheckIn() {},
            async doOpenUrlReward() {},
            async doPoll() {},
            async doQuiz() {},
            async doSearchOnBing() {},
            async doDaily() {},
            async doFindClippy() {},
            async doDoubleSearchPoints() {}
        },
        ...overrides
    }
}

async function loadWorkers() {
    const mod = await import('../../dist/functions/Workers.js')
    return mod.Workers
}

async function loadBotModule() {
    return await import('../../dist/index.js')
}

async function loadRiskControlError() {
    const mod = await import('../../dist/browser/RiskControlDetector.js')
    return mod.RiskControlDetectedError
}

test('Workers.doModernPanelPromotions rethrows RiskControlDetectedError from auto activities', async () => {
    const Workers = await loadWorkers()
    const RiskControlDetectedError = await loadRiskControlError()

    const bot = createWorkerBot({
        activities: {
            async doDailyCheckIn() {},
            async doOpenUrlReward() {},
            async doPoll() {
                throw new RiskControlDetectedError({
                    accountEmail: 'modern@example.com',
                    stage: 'modern-panel-poll',
                    matchedSelector: '#risk-banner',
                    matchedText: 'pause',
                    message: 'modern risk stop'
                })
            },
            async doQuiz() {},
            async doSearchOnBing() {},
            async doDaily() {},
            async doFindClippy() {},
            async doDoubleSearchPoints() {}
        }
    })

    const workers = new Workers(bot)

    await assert.rejects(
        () =>
            workers.doModernPanelPromotions(
                {
                    flyoutResult: {
                        streakPromotion: makePromotion()
                    }
                },
                {
                    morePromotions: [],
                    dailySetPromotions: {},
                    morePromotionsWithoutPromotionalItems: []
                },
                { tag: 'modern-page' }
            ),
        /modern risk stop/
    )
})

test('Workers.doMorePromotions rethrows RiskControlDetectedError from legacy activities', async () => {
    const Workers = await loadWorkers()
    const RiskControlDetectedError = await loadRiskControlError()

    const bot = createWorkerBot({
        activities: {
            async doDailyCheckIn() {},
            async doOpenUrlReward() {},
            async doPoll() {
                throw new RiskControlDetectedError({
                    accountEmail: 'legacy@example.com',
                    stage: 'legacy-poll',
                    matchedSelector: '#risk-banner',
                    matchedText: 'pause',
                    message: 'legacy risk stop'
                })
            },
            async doQuiz() {},
            async doSearchOnBing() {},
            async doDaily() {},
            async doFindClippy() {},
            async doDoubleSearchPoints() {}
        }
    })

    const workers = new Workers(bot)

    await assert.rejects(
        () =>
            workers.doMorePromotions(
                {
                    morePromotions: [makePromotion({ offerId: 'legacy-risk-1' })],
                    morePromotionsWithoutPromotionalItems: [],
                    dailySetPromotions: {}
                },
                { tag: 'legacy-page' }
            ),
        /legacy risk stop/
    )
})

test('runTasks exits single-process mode with code 1 when any account fails', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const bot = Object.create(MicrosoftRewardsBot.prototype)

    bot.config = { clusters: 1 }
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
    bot.sendPushPlusSummary = async () => {}
    bot.Main = async () => {
        throw new Error('account flow failed')
    }

    const originalExit = process.exit
    const exitCalls = []
    process.exit = code => {
        exitCalls.push(code)
        throw new Error(`process.exit:${code}`)
    }

    try {
        await assert.rejects(
            () => bot.runTasks([createAccount('failed@example.com')], Date.now()),
            /process\.exit:1/
        )
    } finally {
        process.exit = originalExit
    }

    assert.deepEqual(exitCalls, [1])
})
