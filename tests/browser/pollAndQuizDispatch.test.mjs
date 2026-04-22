import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

function makeStandardQuizPromotion() {
    return {
        offerId: 'quiz-1',
        title: 'quiz card',
        promotionType: 'quiz',
        destinationUrl: 'https://rewards.bing.com/quiz',
        pointProgressMax: 30,
        activityProgressMax: 30,
        pointProgress: 0,
        complete: false,
        exclusiveLockedFeatureStatus: 'unlocked'
    }
}

function createBot(overrides = {}) {
    return {
        isMobile: false,
        currentAccountEmail: 'dispatch@example.com',
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        },
        utils: {
            getFormattedDate() {
                return '04/21/2026'
            },
            async wait() {},
            randomDelay() {
                return 0
            }
        },
        activities: {
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

function makePollPromotion() {
    return {
        offerId: 'poll-1',
        title: 'poll card',
        promotionType: 'quiz',
        destinationUrl: 'https://rewards.bing.com/?pollScenarioId=123',
        pointProgressMax: 10,
        pointProgress: 0,
        complete: false,
        exclusiveLockedFeatureStatus: 'unlocked'
    }
}

async function loadWorkers() {
    const mod = await import('../../dist/functions/Workers.js')
    return mod.Workers
}

async function loadPoll() {
    const mod = await import('../../dist/functions/activities/browser/Poll.js')
    return mod.Poll
}

test('Activities.doQuiz forwards page context for browser-capable quiz flows', async () => {
    const require = createRequire(import.meta.url)
    const indexPath = require.resolve('../../dist/index.js')
    const previousIndexCache = require.cache[indexPath]
    require.cache[indexPath] = {
        id: indexPath,
        filename: indexPath,
        loaded: true,
        exports: {
            getCurrentContext() {
                return {}
            }
        }
    }

    const activitiesModule = await import('../../dist/functions/Activities.js')
    const quizModule = await import('../../dist/functions/activities/api/Quiz.js')
    const Activities = activitiesModule.default.default ?? activitiesModule.default
    const Quiz = quizModule.Quiz ?? quizModule.default.Quiz
    const calls = []
    const bot = {
        isMobile: false,
        userData: {
            currentPoints: 0
        },
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        }
    }
    const activities = new Activities(bot)

    const originalQuizDoQuiz = Quiz.prototype.doQuiz
    let receivedPage = null
    Quiz.prototype.doQuiz = async function doQuiz(promotion, page) {
        calls.push(promotion.offerId)
        receivedPage = page
    }

    const promotion = makeStandardQuizPromotion()
    const page = { tag: 'quiz-page' }

    try {
        await activities.doQuiz(promotion, page)
    } finally {
        Quiz.prototype.doQuiz = originalQuizDoQuiz
        if (previousIndexCache) {
            require.cache[indexPath] = previousIndexCache
        } else {
            delete require.cache[indexPath]
        }
    }

    assert.deepEqual(calls, ['quiz-1'])
    assert.equal(receivedPage, page)
})

test('Workers.doMorePromotions routes poll-shaped quiz promotions to doPoll', async () => {
    const Workers = await loadWorkers()
    let pollCalls = 0
    let quizCalls = 0

    const bot = createBot({
        activities: {
            async doPoll(promotion, page) {
                pollCalls++
                assert.equal(promotion.offerId, 'poll-1')
                assert.equal(page.tag, 'page')
            },
            async doQuiz() {
                quizCalls++
            },
            async doSearchOnBing() {},
            async doDaily() {},
            async doFindClippy() {},
            async doDoubleSearchPoints() {}
        }
    })

    const workers = new Workers(bot)

    await workers.doMorePromotions(
        {
            morePromotions: [makePollPromotion()],
            morePromotionsWithoutPromotionalItems: []
        },
        { tag: 'page' }
    )

    assert.equal(pollCalls, 1)
    assert.equal(quizCalls, 0)
})

test('Workers.doMorePromotions forwards page to doQuiz for non-poll quiz promotions', async () => {
    const Workers = await loadWorkers()
    let receivedPage = null
    let quizCalls = 0

    const bot = createBot({
        activities: {
            async doPoll() {
                throw new Error('unexpected poll path')
            },
            async doQuiz(promotion, page) {
                quizCalls++
                receivedPage = page
                assert.equal(promotion.offerId, 'quiz-8-worker')
            },
            async doSearchOnBing() {},
            async doDaily() {},
            async doFindClippy() {},
            async doDoubleSearchPoints() {}
        }
    })

    const workers = new Workers(bot)
    const page = { tag: 'quiz-page' }

    await workers.doMorePromotions(
        {
            morePromotions: [
                {
                    offerId: 'quiz-8-worker',
                    title: '8-question quiz worker dispatch',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/quiz-eight',
                    pointProgressMax: 10,
                    activityProgressMax: 80,
                    pointProgress: 0,
                    complete: false,
                    exclusiveLockedFeatureStatus: 'unlocked'
                }
            ],
            morePromotionsWithoutPromotionalItems: []
        },
        page
    )

    assert.equal(quizCalls, 1)
    assert.equal(receivedPage, page)
})

test('Poll.doPoll opens destination, clicks first option, and refreshes points with confirmation reads', async () => {
    const Poll = await loadPoll()
    const navigations = []
    let clickCalls = 0
    let balanceReads = 0

    const bot = createBot({
        userData: {
            currentPoints: 100,
            gainedPoints: 0,
            geoLocale: 'us'
        },
        browser: {
            func: {
                async getCurrentPoints() {
                    balanceReads++
                    if (balanceReads === 1) return 100
                    return 110
                }
            },
            utils: {
                async assertNoRiskControlPrompt() {}
            }
        }
    })

    const poll = new Poll(bot)
    const page = {
        async goto(url) {
            navigations.push(url)
        },
        locator() {
            return {
                count: async () => 1,
                first() {
                    return {
                        async click() {
                            clickCalls++
                        }
                    }
                }
            }
        }
    }

    const promotion = makePollPromotion()
    await poll.doPoll(promotion, page)

    assert.deepEqual(navigations, [promotion.destinationUrl])
    assert.equal(clickCalls, 1)
    assert.equal(balanceReads, 2)
    assert.equal(bot.userData.currentPoints, 110)
})

test('Poll.doPoll retries click attempts when first confirmation cycle has no points', async () => {
    const Poll = await loadPoll()
    let clickCalls = 0
    let balanceReads = 0

    const bot = createBot({
        userData: {
            currentPoints: 100,
            gainedPoints: 0,
            geoLocale: 'us'
        },
        browser: {
            func: {
                async getCurrentPoints() {
                    balanceReads++
                    if (balanceReads < 4) return 100
                    return 110
                }
            },
            utils: {
                async assertNoRiskControlPrompt() {}
            }
        }
    })

    const poll = new Poll(bot)
    const page = {
        async goto() {},
        locator() {
            return {
                count: async () => 1,
                first() {
                    return {
                        async click() {
                            clickCalls++
                        }
                    }
                }
            }
        }
    }

    await poll.doPoll(makePollPromotion(), page)

    assert.equal(clickCalls, 2)
    assert.equal(balanceReads, 4)
    assert.equal(bot.userData.currentPoints, 110)
})
