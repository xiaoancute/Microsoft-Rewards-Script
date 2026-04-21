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
