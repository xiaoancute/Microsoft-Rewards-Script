import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-failed-run-'))

    bot.config = { clusters: 1 }
    bot.projectRoot = projectRoot
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
    bot.appendEarningsReport = async () => {}
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

test('flushPartialEarningsReport writes completed stats once during interrupted shutdown', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const bot = Object.create(MicrosoftRewardsBot.prototype)

    const calls = []
    bot.logger = { info() {}, warn() {}, error() {}, debug() {}, alert() {} }
    bot.currentRunStartTime = 1760000000000
    bot.completedAccountStats = [
        {
            email: 'done@example.com',
            initialPoints: 100,
            finalPoints: 125,
            collectedPoints: 25,
            duration: 30,
            success: true
        }
    ]
    bot.riskControlStopping = false
    bot.appendEarningsReport = async (stats, runStartTime, hadWorkerFailure) => {
        calls.push({ stats, runStartTime, hadWorkerFailure })
    }

    await bot.flushPartialEarningsReport('SIGTERM')
    await bot.flushPartialEarningsReport('SIGTERM again')

    assert.equal(calls.length, 1)
    assert.equal(calls[0].runStartTime, 1760000000000)
    assert.equal(calls[0].hadWorkerFailure, true)
    assert.equal(calls[0].stats[0].email, 'done@example.com')
})

test('flushPartialEarningsReport includes active account progress during interrupted shutdown', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const bot = Object.create(MicrosoftRewardsBot.prototype)

    const calls = []
    bot.logger = { info() {}, warn() {}, error() {}, debug() {}, alert() {} }
    bot.currentRunStartTime = 1760000000000
    bot.currentAccountEmail = 'active@example.com'
    bot.currentAccountStartTime = 1760000005000
    bot.currentAccountProgressReady = true
    bot.completedAccountStats = []
    bot.userData = {
        initialPoints: 100,
        currentPoints: 135
    }
    bot.riskControlStopping = false
    bot.appendEarningsReport = async (stats, runStartTime, hadWorkerFailure) => {
        calls.push({ stats, runStartTime, hadWorkerFailure })
    }

    await bot.flushPartialEarningsReport('SIGTERM')

    assert.equal(calls.length, 1)
    assert.equal(calls[0].stats.length, 1)
    assert.equal(calls[0].stats[0].email, 'active@example.com')
    assert.equal(calls[0].stats[0].initialPoints, 100)
    assert.equal(calls[0].stats[0].finalPoints, 135)
    assert.equal(calls[0].stats[0].collectedPoints, 35)
    assert.equal(calls[0].stats[0].success, false)
    assert.match(calls[0].stats[0].error, /SIGTERM/)
})

test('runTasks keeps completed account stats available for later interrupt flushing', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const bot = Object.create(MicrosoftRewardsBot.prototype)
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-interrupt-'))

    bot.config = { clusters: 1 }
    bot.projectRoot = projectRoot
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
    bot.appendEarningsReport = async () => {}
    bot.Main = async () => ({ initialPoints: 50, collectedPoints: 15 })

    const originalExit = process.exit
    process.exit = code => {
        throw new Error(`process.exit:${code}`)
    }

    try {
        await assert.rejects(
            () => bot.runTasks([createAccount('partial@example.com')], 1760000000000),
            /process\.exit:0/
        )
    } finally {
        process.exit = originalExit
    }

    assert.equal(bot.completedAccountStats.length, 1)
    assert.equal(bot.completedAccountStats[0].email, 'partial@example.com')
    assert.equal(bot.completedAccountStats[0].collectedPoints, 15)

    await bot.earningsCheckpointPromise
    const checkpoint = JSON.parse(await fs.readFile(path.join(projectRoot, 'reports', 'earnings.pending.json'), 'utf8'))
    assert.equal(checkpoint.accountStats[0].email, 'partial@example.com')
    assert.equal(checkpoint.accountStats[0].collectedPoints, 15)
})

test('earnings checkpoint persists active account progress before account completes', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const bot = Object.create(MicrosoftRewardsBot.prototype)
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-active-progress-'))

    bot.projectRoot = projectRoot
    bot.logger = { info() {}, warn() {}, error() {}, debug() {}, alert() {} }
    bot.userData = {
        initialPoints: 200,
        currentPoints: 260
    }
    bot.beginEarningsRun(1760000000000)
    bot.currentAccountEmail = 'active@example.com'
    bot.currentAccountStartTime = 1760000005000
    bot.currentAccountProgressReady = true

    bot.queueEarningsCheckpoint('progress')
    await bot.earningsCheckpointPromise

    const checkpoint = JSON.parse(await fs.readFile(path.join(projectRoot, 'reports', 'earnings.pending.json'), 'utf8'))
    assert.equal(checkpoint.accountStats.length, 1)
    assert.equal(checkpoint.accountStats[0].email, 'active@example.com')
    assert.equal(checkpoint.accountStats[0].initialPoints, 200)
    assert.equal(checkpoint.accountStats[0].finalPoints, 260)
    assert.equal(checkpoint.accountStats[0].collectedPoints, 60)
    assert.equal(checkpoint.accountStats[0].success, false)
})

test('earnings checkpoint ignores account progress until the initial balance is loaded', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const bot = Object.create(MicrosoftRewardsBot.prototype)
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-progress-gate-'))

    bot.projectRoot = projectRoot
    bot.logger = { info() {}, warn() {}, error() {}, debug() {}, alert() {} }
    bot.userData = {
        initialPoints: 999,
        currentPoints: 1010
    }
    bot.beginEarningsRun(1760000000000)
    bot.completedAccountStats = [
        {
            email: 'done@example.com',
            initialPoints: 100,
            finalPoints: 110,
            collectedPoints: 10,
            duration: 5,
            success: true
        }
    ]
    bot.currentAccountEmail = 'active@example.com'
    bot.currentAccountStartTime = 1760000005000

    bot.queueEarningsCheckpoint('account-start')
    await bot.earningsCheckpointPromise

    const checkpoint = JSON.parse(await fs.readFile(path.join(projectRoot, 'reports', 'earnings.pending.json'), 'utf8'))
    assert.equal(checkpoint.accountStats.length, 1)
    assert.equal(checkpoint.accountStats[0].email, 'done@example.com')
})

test('mergeAccountStats keeps worker progress when final stats are missing', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const bot = Object.create(MicrosoftRewardsBot.prototype)

    const merged = bot.mergeAccountStats(
        [
            {
                email: 'done@example.com',
                initialPoints: 10,
                finalPoints: 15,
                collectedPoints: 5,
                duration: 1,
                success: true
            }
        ],
        [
            {
                email: 'active@example.com',
                initialPoints: 100,
                finalPoints: 130,
                collectedPoints: 30,
                duration: 20,
                success: false,
                error: 'worker disconnected'
            }
        ]
    )

    assert.equal(merged.length, 2)
    assert.equal(merged.find(item => item.email === 'active@example.com').collectedPoints, 30)
})

test('mergeAccountStats lets final worker stats replace older progress stats', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const bot = Object.create(MicrosoftRewardsBot.prototype)

    const merged = bot.mergeAccountStats(
        [
            {
                email: 'same@example.com',
                initialPoints: 100,
                finalPoints: 150,
                collectedPoints: 50,
                duration: 40,
                success: true
            }
        ],
        [
            {
                email: 'same@example.com',
                initialPoints: 100,
                finalPoints: 120,
                collectedPoints: 20,
                duration: 20,
                success: false,
                error: 'progress'
            }
        ]
    )

    assert.equal(merged.length, 1)
    assert.equal(merged[0].collectedPoints, 50)
    assert.equal(merged[0].success, true)
})
