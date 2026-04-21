import test from 'node:test'
import assert from 'node:assert/strict'

async function loadCollector() {
    return await import('../../dist/functions/modernPanel/collectModernPanelOpportunities.js')
}

function makePromotion(overrides = {}) {
    return {
        offerId: 'offer-1',
        title: 'Promotion',
        promotionType: 'urlreward',
        destinationUrl: 'https://rewards.bing.com/example',
        pointProgressMax: 10,
        activityProgressMax: 10,
        ...overrides
    }
}

test('collectModernPanelOpportunities classifies modern cards and de-duplicates legacy worker offers', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            dailyCheckInPromotion: makePromotion({
                offerId: 'daily-checkin-1',
                promotionType: 'urlreward'
            }),
            streakPromotion: makePromotion({
                offerId: 'streak-poll-1',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/something?pollScenarioId=12345'
            }),
            levelInfoPromotion: makePromotion({
                offerId: 'level-info-1',
                promotionType: '',
                destinationUrl: '',
                pointProgressMax: 0,
                activityProgressMax: 0
            }),
            levelBenefitsPromotion: makePromotion({
                offerId: 'level-benefits-1',
                promotionType: 'urlreward',
                destinationUrl: 'https://rewards.bing.com/level-benefits'
            })
        }
    }

    const dashboardData = {
        morePromotions: [{ offerId: 'streak-poll-1' }],
        dailySetPromotions: {
            '04/21/2026': [{ offerId: 'daily-set-1' }]
        },
        morePromotionsWithoutPromotionalItems: [{ offerId: 'legacy-extra-1' }]
    }

    const opportunities = collectModernPanelOpportunities(panelData, dashboardData)
    const bySource = new Map(opportunities.map((item) => [item.source, item]))

    const daily = bySource.get('daily')
    assert.ok(daily)
    assert.equal(daily.kind, 'checkin')
    assert.equal(daily.decision, 'skip')
    assert.equal(daily.reason, 'daily-check-in-web-entry-not-supported')

    const streak = bySource.get('streak')
    assert.ok(streak)
    assert.equal(streak.kind, 'poll')
    assert.equal(streak.decision, 'skip')
    assert.equal(streak.reason, 'duplicate-with-legacy-worker')

    const levelInfo = opportunities.find((item) => item.offerId === 'level-info-1')
    assert.ok(levelInfo)
    assert.equal(levelInfo.source, 'level')
    assert.equal(levelInfo.kind, 'info-only')
    assert.equal(levelInfo.decision, 'skip')
    assert.equal(levelInfo.reason, 'info-card-without-action')

    const levelBenefits = opportunities.find((item) => item.offerId === 'level-benefits-1')
    assert.ok(levelBenefits)
    assert.equal(levelBenefits.kind, 'urlreward')
    assert.equal(levelBenefits.decision, 'auto')
    assert.equal(levelBenefits.reason, 'auto-executable')
})

test('collectModernPanelOpportunities marks streak poll as auto when not duplicated by legacy worker lists', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            streakPromotion: makePromotion({
                offerId: 'streak-poll-auto-1',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/something?pollScenarioId=abc'
            })
        }
    }

    const dashboardData = {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    }

    const [opportunity] = collectModernPanelOpportunities(panelData, dashboardData)

    assert.ok(opportunity)
    assert.equal(opportunity.source, 'streak')
    assert.equal(opportunity.kind, 'poll')
    assert.equal(opportunity.decision, 'auto')
    assert.equal(opportunity.reason, 'auto-executable')
})

test('collectModernPanelOpportunities includes streakBonusPromotions and classifies locked/unsupported entries', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            streakBonusPromotions: [
                makePromotion({
                    offerId: 'streak-bonus-locked-1',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/bonus-quiz',
                    exclusiveLockedFeatureStatus: 'locked'
                }),
                makePromotion({
                    offerId: 'streak-bonus-unsupported-1',
                    promotionType: 'mystery',
                    destinationUrl: 'https://rewards.bing.com/mystery'
                })
            ]
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const locked = opportunities.find((item) => item.offerId === 'streak-bonus-locked-1')
    assert.ok(locked)
    assert.equal(locked.source, 'streak')
    assert.equal(locked.kind, 'quiz')
    assert.equal(locked.decision, 'skip')
    assert.equal(locked.reason, 'locked-feature')

    const unsupported = opportunities.find((item) => item.offerId === 'streak-bonus-unsupported-1')
    assert.ok(unsupported)
    assert.equal(unsupported.source, 'streak')
    assert.equal(unsupported.kind, 'quiz')
    assert.equal(unsupported.decision, 'skip')
    assert.equal(unsupported.reason, 'unsupported-promotion-type')
})
