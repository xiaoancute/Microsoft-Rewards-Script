import test from 'node:test'
import assert from 'node:assert/strict'

async function loadWorkers() {
    const mod = await import('../../dist/functions/Workers.js')
    return mod.Workers
}

function makePromotion(overrides = {}) {
    return {
        offerId: 'special-offer-1',
        title: 'Special promotion',
        name: 'special-promotion',
        promotionType: 'urlreward',
        destinationUrl: 'https://rewards.bing.com/special',
        pointProgressMax: 10,
        activityProgressMax: 10,
        hash: 'promo-hash',
        activityType: 'activity',
        complete: false,
        exclusiveLockedFeatureStatus: 'unlocked',
        ...overrides
    }
}

function createBot(overrides = {}) {
    const logs = []
    const dispatchCalls = []

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
            async wait() {},
            randomDelay() {
                return 0
            }
        },
        activities: {
            async doDoubleSearchPoints(promotion) {
                dispatchCalls.push(['double-search', promotion.offerId])
            },
            async doDaily(promotion) {
                dispatchCalls.push(['urlreward', promotion.offerId])
            },
            async doQuiz(promotion, page) {
                dispatchCalls.push(['quiz', promotion.offerId, page])
            },
            async doSearchOnBing(promotion, page) {
                dispatchCalls.push(['search-on-bing', promotion.offerId, page])
            },
            async doFindClippy(promotion) {
                dispatchCalls.push(['findclippy', promotion.offerId])
            }
        },
        ...overrides
    }

    return { bot, logs, dispatchCalls }
}

test('Workers.doSpecialPromotions dispatches supported non-double-search promotional items through existing handlers', async () => {
    const Workers = await loadWorkers()
    const { bot, dispatchCalls } = createBot()
    const workers = new Workers(bot)
    const page = { tag: 'special-page' }

    await workers.doSpecialPromotions(
        {
            promotionalItems: [
                makePromotion({
                    offerId: 'special-double-1',
                    name: 'ww_banner_optin_2x_bonus',
                    promotionType: 'urlreward'
                }),
                makePromotion({
                    offerId: 'special-url-1',
                    name: 'generic-urlreward',
                    promotionType: 'urlreward'
                }),
                makePromotion({
                    offerId: 'special-quiz-1',
                    name: 'generic-quiz',
                    promotionType: 'quiz',
                    pointProgressMax: 30,
                    activityProgressMax: 30,
                    destinationUrl: 'https://rewards.bing.com/special-quiz'
                }),
                makePromotion({
                    offerId: 'special-search-1',
                    name: 'exploreonbingbonus',
                    promotionType: 'urlreward',
                    destinationUrl: 'https://rewards.bing.com/explore-on-bing'
                }),
                makePromotion({
                    offerId: 'special-clippy-1',
                    name: 'clippy-special',
                    promotionType: 'findclippy'
                }),
                makePromotion({
                    offerId: 'special-unsupported-1',
                    name: 'mystery-special',
                    promotionType: 'mystery'
                })
            ]
        },
        page
    )

    assert.deepEqual(dispatchCalls, [
        ['double-search', 'special-double-1'],
        ['urlreward', 'special-url-1'],
        ['quiz', 'special-quiz-1', page],
        ['search-on-bing', 'special-search-1', page],
        ['findclippy', 'special-clippy-1']
    ])
})
