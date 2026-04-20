import test from 'node:test'
import assert from 'node:assert/strict'

async function loadAdapter() {
    return await import('../../dist/browser/modernDashboardAdapter.js')
}

function makePromotion(offerId, title, pointProgressMax = 10, pointProgress = 0) {
    return {
        offerId,
        title,
        pointProgressMax,
        pointProgress,
        complete: false,
        promotionType: 'urlreward'
    }
}

test('adaptModernDashboardData maps modern main-flow data into dashboard shape', async () => {
    const { adaptModernDashboardData } = await loadAdapter()

    const panel = {
        userInfo: {
            rewardsCountry: 'CN'
        },
        flyoutResult: {
            userStatus: {
                availablePoints: 1234,
                lifetimePoints: 5678,
                lifetimeGivingPoints: 25,
                counters: {
                    PCSearch: [{ pointProgress: 6, pointProgressMax: 15 }],
                    MobileSearch: [{ pointProgress: 3, pointProgressMax: 12 }],
                    ActivityAndQuiz: [],
                    DailyPoint: []
                }
            },
            dailySetPromotions: {
                '04/20/2026': [makePromotion('daily-1', 'daily-task')]
            },
            morePromotions: [makePromotion('more-1', 'more-task', 30, 10)]
        }
    }

    const result = adaptModernDashboardData(panel, null, 'sg')

    assert.equal(result.userStatus.availablePoints, 1234)
    assert.equal(result.userStatus.lifetimePoints, 5678)
    assert.equal(result.userStatus.lifetimeGivingPoints, 25)
    assert.equal(result.userProfile.attributes.country, 'CN')
    assert.equal(result.dailySetPromotions['04/20/2026'][0].offerId, 'daily-1')
    assert.equal(result.morePromotions[0].offerId, 'more-1')
    assert.equal(result.userStatus.counters.pcSearch[0].pointProgressMax, 15)
    assert.equal(result.userStatus.counters.mobileSearch[0].pointProgressMax, 12)
})

test('adaptModernDashboardData prefers legacy counters when supplement is provided', async () => {
    const { adaptModernDashboardData } = await loadAdapter()

    const panel = {
        userInfo: {
            rewardsCountry: 'CN'
        },
        flyoutResult: {
            userStatus: {
                availablePoints: 1234,
                lifetimePoints: 5678,
                lifetimeGivingPoints: 25,
                counters: {
                    PCSearch: [{ pointProgress: 6, pointProgressMax: 15 }],
                    ActivityAndQuiz: [],
                    DailyPoint: []
                }
            },
            dailySetPromotions: {},
            morePromotions: []
        }
    }

    const legacySupplement = {
        userStatus: {
            counters: {
                pcSearch: [{ pointProgress: 30, pointProgressMax: 90 }],
                mobileSearch: [{ pointProgress: 20, pointProgressMax: 60 }],
                activityAndQuiz: [],
                dailyPoint: []
            }
        }
    }

    const result = adaptModernDashboardData(panel, legacySupplement, 'sg')

    assert.equal(result.userStatus.counters.pcSearch[0].pointProgressMax, 90)
    assert.equal(result.userStatus.counters.mobileSearch[0].pointProgressMax, 60)
})

test('createEmptyLegacyDashboardSubset returns safe defaults for phase-1 unsupported modules', async () => {
    const { createEmptyLegacyDashboardSubset } = await loadAdapter()

    const result = createEmptyLegacyDashboardSubset('sg')

    assert.equal(result.userProfile.attributes.country, 'sg')
    assert.deepEqual(result.punchCards, [])
    assert.deepEqual(result.promotionalItems, [])
    assert.deepEqual(result.morePromotionsWithoutPromotionalItems, [])
    assert.deepEqual(result.userStatus.counters.pcSearch, [])
    assert.deepEqual(result.userStatus.counters.mobileSearch, [])
})

test('adaptModernDashboardData inherits legacy-only modules when supplement is provided', async () => {
    const { adaptModernDashboardData } = await loadAdapter()

    const panel = {
        userInfo: {
            rewardsCountry: 'CN'
        },
        flyoutResult: {
            userStatus: {
                availablePoints: 100,
                lifetimePoints: 200,
                lifetimeGivingPoints: 10,
                counters: {}
            },
            dailySetPromotions: {},
            morePromotions: []
        }
    }

    const legacySupplement = {
        userStatus: {
            counters: {
                pcSearch: [],
                mobileSearch: [],
                activityAndQuiz: [],
                dailyPoint: []
            }
        },
        punchCards: [{ offerId: 'legacy-punch' }],
        promotionalItems: [{ offerId: 'legacy-special' }],
        morePromotionsWithoutPromotionalItems: [{ offerId: 'legacy-extra' }],
        findClippyPromotion: { offerId: 'legacy-clippy' }
    }

    const result = adaptModernDashboardData(panel, legacySupplement, 'sg')

    assert.deepEqual(result.punchCards, [{ offerId: 'legacy-punch' }])
    assert.deepEqual(result.promotionalItems, [{ offerId: 'legacy-special' }])
    assert.deepEqual(result.morePromotionsWithoutPromotionalItems, [])
    assert.deepEqual(result.findClippyPromotion, { offerId: 'legacy-clippy' })
})
