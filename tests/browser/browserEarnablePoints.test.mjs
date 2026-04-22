import test from 'node:test'
import assert from 'node:assert/strict'

async function loadBrowserFunc() {
    const mod = await import('../../dist/browser/BrowserFunc.js')
    return mod.default?.default ?? mod.default ?? mod.BrowserFunc
}

test('BrowserFunc.getBrowserEarnablePoints includes punch cards, special promotions, and modern-only browser opportunities', async () => {
    const BrowserFunc = await loadBrowserFunc()

    const bot = {
        rewardsVersion: 'modern',
        panelData: {
            flyoutResult: {
                dailyCheckInPromotion: {
                    offerId: 'modern-daily-checkin',
                    title: 'Modern Daily Checkin',
                    promotionType: 'urlreward',
                    pointProgressMax: 10,
                    pointProgress: 0,
                    activityProgressMax: 10,
                    complete: false
                },
                streakPromotion: {
                    offerId: '   ',
                    title: 'Modern Blank Quiz',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/modern-quiz',
                    pointProgressMax: 30,
                    pointProgress: 0,
                    activityProgressMax: 30,
                    complete: false
                },
                streakBonusPromotions: [],
                levelInfoPromotion: null,
                levelBenefitsPromotion: null
            }
        },
        utils: {
            getFormattedDate() {
                return '04/22/2026'
            }
        },
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        }
    }

    const browserFunc = new BrowserFunc(bot)
    browserFunc.getDashboardData = async () => ({
        userStatus: {
            counters: {
                pcSearch: [{ pointProgressMax: 90, pointProgress: 40 }],
                mobileSearch: [{ pointProgressMax: 60, pointProgress: 40 }]
            }
        },
        dailySetPromotions: {
            '04/22/2026': [{ pointProgressMax: 10, pointProgress: 0 }]
        },
        morePromotions: [
            {
                promotionType: 'quiz',
                exclusiveLockedFeatureStatus: 'unlocked',
                pointProgressMax: 15,
                pointProgress: 0
            },
            {
                promotionType: 'urlreward',
                exclusiveLockedFeatureStatus: 'locked',
                pointProgressMax: 50,
                pointProgress: 0
            }
        ],
        morePromotionsWithoutPromotionalItems: [
            {
                promotionType: 'urlreward',
                exclusiveLockedFeatureStatus: 'unlocked',
                pointProgressMax: 5,
                pointProgress: 0
            }
        ],
        punchCards: [
            {
                parentPromotion: {
                    complete: false,
                    pointProgressMax: 50
                },
                childPromotions: [
                    {
                        promotionType: 'quiz',
                        exclusiveLockedFeatureStatus: 'unlocked',
                        attributes: {},
                        pointProgressMax: 30,
                        pointProgress: 0,
                        complete: false
                    },
                    {
                        promotionType: 'quiz',
                        exclusiveLockedFeatureStatus: 'locked',
                        attributes: {},
                        pointProgressMax: 20,
                        pointProgress: 0,
                        complete: false
                    }
                ]
            }
        ],
        promotionalItems: [
            {
                name: 'generic-special',
                promotionType: 'urlreward',
                exclusiveLockedFeatureStatus: 'unlocked',
                pointProgressMax: 20,
                pointProgress: 0,
                complete: false
            },
            {
                name: 'ww_banner_optin_2x_bonus',
                promotionType: 'urlreward',
                exclusiveLockedFeatureStatus: 'unlocked',
                pointProgressMax: 100,
                pointProgress: 0,
                complete: false
            }
        ]
    })

    const points = await browserFunc.getBrowserEarnablePoints()

    assert.equal(points.desktopSearchPoints, 50)
    assert.equal(points.mobileSearchPoints, 20)
    assert.equal(points.dailySetPoints, 10)
    assert.equal(points.morePromotionsPoints, 20)
    assert.equal(points.punchCardPoints, 30)
    assert.equal(points.specialPromotionsPoints, 20)
    assert.equal(points.modernPanelPoints, 30)
    assert.equal(points.totalEarnablePoints, 180)
})
