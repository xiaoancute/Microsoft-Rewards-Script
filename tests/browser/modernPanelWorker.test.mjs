import test from 'node:test'
import assert from 'node:assert/strict'

async function loadWorkers() {
    const mod = await import('../../dist/functions/Workers.js')
    return mod.Workers
}

function makePromotion(overrides = {}) {
    return {
        offerId: 'offer-1',
        title: 'Modern promotion',
        promotionType: 'urlreward',
        destinationUrl: 'https://rewards.bing.com/example',
        pointProgressMax: 10,
        activityProgressMax: 10,
        hash: 'promo-hash',
        activityType: 'activity',
        complete: false,
        ...overrides
    }
}

function createBot(overrides = {}) {
    const logs = []
    const dispatchCalls = []
    let waitCalls = 0
    let randomDelayCalls = 0

    const bot = {
        isMobile: false,
        logger: {
            info(...args) {
                logs.push(['info', ...args])
            },
            debug(...args) {
                logs.push(['debug', ...args])
            },
            warn(...args) {
                logs.push(['warn', ...args])
            },
            error(...args) {
                logs.push(['error', ...args])
            }
        },
        utils: {
            async wait() {
                waitCalls++
            },
            randomDelay() {
                randomDelayCalls++
                return 0
            }
        },
        activities: {
            async doPoll(promotion, page) {
                dispatchCalls.push(['poll', promotion.offerId, page])
            },
            async doQuiz(promotion, page) {
                dispatchCalls.push(['quiz', promotion.offerId, page])
            },
            async doDaily(promotion) {
                dispatchCalls.push(['urlreward', promotion.offerId])
            }
        },
        ...overrides
    }

    return {
        bot,
        logs,
        dispatchCalls,
        getWaitCalls() {
            return waitCalls
        },
        getRandomDelayCalls() {
            return randomDelayCalls
        }
    }
}

test('Workers.doModernPanelPromotions routes auto opportunities and logs skipped entries', async () => {
    const Workers = await loadWorkers()
    const { bot, logs, dispatchCalls, getWaitCalls, getRandomDelayCalls } = createBot()
    const workers = new Workers(bot)
    const page = { tag: 'modern-page' }

    assert.equal(typeof workers.doModernPanelPromotions, 'function')

    const panelData = {
        flyoutResult: {
            dailyCheckInPromotion: makePromotion({
                offerId: 'daily-checkin-1',
                promotionType: 'urlreward'
            }),
            streakPromotion: makePromotion({
                offerId: 'streak-poll-1',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/task?pollScenarioId=42'
            }),
            streakBonusPromotions: [
                makePromotion({
                    offerId: 'streak-quiz-1',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/streak-quiz'
                })
            ],
            levelInfoPromotion: makePromotion({
                offerId: 'level-info-1',
                promotionType: '',
                destinationUrl: '',
                pointProgressMax: 0,
                activityProgressMax: 0
            }),
            levelBenefitsPromotion: makePromotion({
                offerId: 'level-urlreward-1',
                promotionType: 'urlreward',
                destinationUrl: 'https://rewards.bing.com/level-benefits'
            })
        }
    }

    const dashboardData = {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    }

    await workers.doModernPanelPromotions(panelData, dashboardData, page)

    assert.deepEqual(dispatchCalls, [
        ['poll', 'streak-poll-1', page],
        ['quiz', 'streak-quiz-1', page],
        ['urlreward', 'level-urlreward-1']
    ])
    assert.equal(getWaitCalls(), 3)
    assert.equal(getRandomDelayCalls(), 3)

    const modernPanelSummaries = logs.filter((entry) => entry[1] === false && entry[2] === 'MODERN-PANEL')
    assert.ok(modernPanelSummaries.length >= 1)
    assert.match(modernPanelSummaries[0][3], /total=5/)
    assert.match(modernPanelSummaries[0][3], /auto=3/)
    assert.match(modernPanelSummaries[0][3], /skip=2/)

    const modernActivityLogs = logs
        .filter((entry) => entry[0] === 'info' && entry[1] === false && entry[2] === 'MODERN-ACTIVITY')
        .map((entry) => entry[3])

    assert.equal(modernActivityLogs.length, 5)
    assert.ok(
        modernActivityLogs.some((line) => line.includes('offerId=daily-checkin-1') && line.includes('decision=skip') && line.includes('reason=daily-check-in-web-entry-not-supported'))
    )
    assert.ok(
        modernActivityLogs.some((line) => line.includes('offerId=level-info-1') && line.includes('decision=skip') && line.includes('reason=info-card-without-action'))
    )
})

test('Workers.doModernPanelPromotions logs no-op MODERN-PANEL message when no opportunities are collected', async () => {
    const Workers = await loadWorkers()
    const { bot, logs, dispatchCalls, getWaitCalls } = createBot()
    const workers = new Workers(bot)

    await workers.doModernPanelPromotions(
        {
            flyoutResult: {}
        },
        {
            morePromotions: [],
            dailySetPromotions: {},
            morePromotionsWithoutPromotionalItems: []
        },
        { tag: 'modern-page' }
    )

    assert.deepEqual(dispatchCalls, [])
    assert.equal(getWaitCalls(), 0)

    const modernPanelLogs = logs
        .filter((entry) => entry[0] === 'info' && entry[1] === false && entry[2] === 'MODERN-PANEL')
        .map((entry) => entry[3])

    assert.equal(modernPanelLogs.length, 1)
    assert.match(modernPanelLogs[0], /未收集到可执行的现代面板活动/)
})
