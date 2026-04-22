import test from 'node:test'
import assert from 'node:assert/strict'

async function loadWorkers() {
    const mod = await import('../../dist/functions/Workers.js')
    return mod.Workers
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
            async doAppReward(promotion) {
                dispatchCalls.push([promotion.attributes.offerid, promotion.attributes.type])
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

test('Workers.doAppPromotions dispatches unfinished non-dedicated app promotion types with offer ids', async () => {
    const Workers = await loadWorkers()
    const { bot, dispatchCalls, getWaitCalls, getRandomDelayCalls } = createBot()
    const workers = new Workers(bot)

    await workers.doAppPromotions({
        response: {
            promotions: [
                {
                    name: 'Sapphire App Promo',
                    priority: 1,
                    attributes: {
                        complete: 'false',
                        offerid: 'offer-sapphire',
                        type: 'sapphire'
                    },
                    tags: []
                },
                {
                    name: 'Emerald App Promo',
                    priority: 2,
                    attributes: {
                        complete: 'false',
                        offerid: 'offer-emerald',
                        type: 'emerald'
                    },
                    tags: []
                },
                {
                    name: 'Checkin Promo',
                    priority: 3,
                    attributes: {
                        complete: 'false',
                        offerid: 'offer-checkin',
                        type: 'checkin'
                    },
                    tags: []
                },
                {
                    name: 'Read Promo',
                    priority: 4,
                    attributes: {
                        complete: 'false',
                        offerid: 'offer-read',
                        type: 'msnreadearn'
                    },
                    tags: []
                },
                {
                    name: 'Completed Promo',
                    priority: 5,
                    attributes: {
                        complete: 'true',
                        offerid: 'offer-complete',
                        type: 'emerald'
                    },
                    tags: []
                },
                {
                    name: 'Missing Offer Promo',
                    priority: 6,
                    attributes: {
                        complete: 'false',
                        type: 'emerald'
                    },
                    tags: []
                }
            ]
        }
    })

    assert.deepEqual(dispatchCalls, [
        ['offer-sapphire', 'sapphire'],
        ['offer-emerald', 'emerald']
    ])
    assert.equal(getWaitCalls(), 2)
    assert.equal(getRandomDelayCalls(), 2)
})
