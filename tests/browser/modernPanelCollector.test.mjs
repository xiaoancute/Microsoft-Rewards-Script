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
        hash: 'promo-hash',
        activityType: 'activity',
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
    assert.equal(unsupported.kind, 'info-only')
    assert.equal(unsupported.decision, 'skip')
    assert.equal(unsupported.reason, 'unsupported-promotion-type')
})

test('collectModernPanelOpportunities skips malformed urlreward missing execution fields', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            levelBenefitsPromotion: makePromotion({
                offerId: 'urlreward-malformed-1',
                promotionType: 'urlreward',
                hash: '',
                activityType: ''
            })
        }
    }

    const [opportunity] = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    assert.ok(opportunity)
    assert.equal(opportunity.offerId, 'urlreward-malformed-1')
    assert.equal(opportunity.kind, 'urlreward')
    assert.equal(opportunity.decision, 'skip')
    assert.equal(opportunity.reason, 'unsupported-promotion-type')
})

test('collectModernPanelOpportunities skips zero-point quiz and poll entries', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            streakPromotion: makePromotion({
                offerId: 'quiz-zero-1',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/quiz',
                pointProgressMax: 0,
                activityProgressMax: 0
            }),
            streakBonusPromotions: [
                makePromotion({
                    offerId: 'poll-zero-1',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/anything?pollScenarioId=42',
                    pointProgressMax: 0,
                    activityProgressMax: 0
                })
            ]
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const quizZero = opportunities.find((item) => item.offerId === 'quiz-zero-1')
    assert.ok(quizZero)
    assert.equal(quizZero.kind, 'quiz')
    assert.equal(quizZero.decision, 'skip')
    assert.equal(quizZero.reason, 'unsupported-promotion-type')

    const pollZero = opportunities.find((item) => item.offerId === 'poll-zero-1')
    assert.ok(pollZero)
    assert.equal(pollZero.kind, 'poll')
    assert.equal(pollZero.decision, 'skip')
    assert.equal(pollZero.reason, 'unsupported-promotion-type')
})

test('collectModernPanelOpportunities skips completed modern promotions', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            streakPromotion: makePromotion({
                offerId: 'completed-poll-1',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/task?pollScenarioId=7',
                pointProgressMax: 10,
                activityProgressMax: 10,
                complete: true
            }),
            levelBenefitsPromotion: makePromotion({
                offerId: 'completed-urlreward-1',
                promotionType: 'urlreward',
                destinationUrl: 'https://rewards.bing.com/offer',
                pointProgressMax: 10,
                activityProgressMax: 10,
                complete: true
            })
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const completedPoll = opportunities.find((item) => item.offerId === 'completed-poll-1')
    assert.ok(completedPoll)
    assert.equal(completedPoll.kind, 'poll')
    assert.equal(completedPoll.decision, 'skip')
    assert.equal(completedPoll.reason, 'unsupported-promotion-type')

    const completedUrlreward = opportunities.find((item) => item.offerId === 'completed-urlreward-1')
    assert.ok(completedUrlreward)
    assert.equal(completedUrlreward.kind, 'urlreward')
    assert.equal(completedUrlreward.decision, 'skip')
    assert.equal(completedUrlreward.reason, 'unsupported-promotion-type')
})

test('collectModernPanelOpportunities auto-runs blank-offerId poll and 8-question quiz entries with stable opportunity keys', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            streakPromotion: makePromotion({
                offerId: '   ',
                title: 'Blank Poll',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/task?pollScenarioId=101',
                pointProgressMax: 10,
                activityProgressMax: 10
            }),
            streakBonusPromotions: [
                makePromotion({
                    offerId: '   ',
                    title: 'Blank Eight Quiz',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/quiz/eight',
                    pointProgressMax: 10,
                    activityProgressMax: 80
                })
            ]
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const blankPoll = opportunities.find((item) => item.title === 'Blank Poll')
    assert.ok(blankPoll)
    assert.equal(blankPoll.offerId, null)
    assert.equal(blankPoll.offerIdState, 'blank')
    assert.equal(blankPoll.kind, 'poll')
    assert.equal(blankPoll.decision, 'auto')
    assert.equal(blankPoll.reason, 'auto-executable-without-offerid')
    assert.match(blankPoll.opportunityKey, /^streak\|poll\|quiz\|https:\/\/rewards\.bing\.com\/task\?pollscenarioid=101\|blank poll\|unknown$/)

    const blankEightQuiz = opportunities.find((item) => item.title === 'Blank Eight Quiz')
    assert.ok(blankEightQuiz)
    assert.equal(blankEightQuiz.offerId, null)
    assert.equal(blankEightQuiz.offerIdState, 'blank')
    assert.equal(blankEightQuiz.kind, 'quiz')
    assert.equal(blankEightQuiz.decision, 'auto')
    assert.equal(blankEightQuiz.reason, 'auto-executable-without-offerid')
    assert.match(blankEightQuiz.opportunityKey, /^streak\|quiz\|quiz\|https:\/\/rewards\.bing\.com\/quiz\/eight\|blank eight quiz\|unknown$/)
})

test('collectModernPanelOpportunities skips blank-offerId standard quiz and urlreward entries that still require API execution', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            streakPromotion: makePromotion({
                offerId: '   ',
                title: 'Blank Standard Quiz',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/quiz/standard',
                pointProgressMax: 30,
                activityProgressMax: 30
            }),
            levelBenefitsPromotion: makePromotion({
                offerId: '   ',
                title: 'Blank UrlReward',
                promotionType: 'urlreward',
                destinationUrl: 'https://rewards.bing.com/level-benefits',
                pointProgressMax: 10,
                activityProgressMax: 10
            })
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const blankStandardQuiz = opportunities.find((item) => item.title === 'Blank Standard Quiz')
    assert.ok(blankStandardQuiz)
    assert.equal(blankStandardQuiz.kind, 'quiz')
    assert.equal(blankStandardQuiz.decision, 'skip')
    assert.equal(blankStandardQuiz.reason, 'missing-offerid-requires-api-execution')

    const blankUrlReward = opportunities.find((item) => item.title === 'Blank UrlReward')
    assert.ok(blankUrlReward)
    assert.equal(blankUrlReward.kind, 'urlreward')
    assert.equal(blankUrlReward.decision, 'skip')
    assert.equal(blankUrlReward.reason, 'missing-offerid-requires-api-execution')
})

test('collectModernPanelOpportunities de-duplicates blank-offerId cards by opportunityKey', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const duplicatePoll = makePromotion({
        offerId: '   ',
        title: 'Duplicate Blank Poll',
        promotionType: 'quiz',
        destinationUrl: 'https://rewards.bing.com/task?pollScenarioId=500',
        pointProgressMax: 10,
        activityProgressMax: 10
    })

    const panelData = {
        flyoutResult: {
            streakPromotion: duplicatePoll,
            streakBonusPromotions: [
                {
                    ...duplicatePoll,
                    pointProgressMax: 0,
                    activityProgressMax: 0
                }
            ]
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const duplicates = opportunities.filter((item) => item.title === 'Duplicate Blank Poll')
    assert.equal(duplicates.length, 1)
    assert.equal(duplicates[0].decision, 'auto')
    assert.equal(duplicates[0].reason, 'auto-executable-without-offerid')
})
