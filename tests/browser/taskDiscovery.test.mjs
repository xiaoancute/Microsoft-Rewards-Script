import test from 'node:test'
import assert from 'node:assert/strict'

async function loadDiscovery() {
    return await import('../../dist/functions/taskDiscovery/browserTasks.js')
}

function dashboard(overrides = {}) {
    return {
        userStatus: {
            counters: {
                pcSearch: [{ pointProgressMax: 90, pointProgress: 40 }],
                mobileSearch: [{ pointProgressMax: 60, pointProgress: 50 }]
            }
        },
        dailySetPromotions: {
            '06/28/2026': [{ offerId: 'daily-1', title: 'Daily', pointProgressMax: 10, pointProgress: 0 }]
        },
        morePromotions: [
            {
                offerId: 'more-1',
                title: 'More quiz',
                promotionType: 'quiz',
                exclusiveLockedFeatureStatus: 'unlocked',
                pointProgressMax: 20,
                pointProgress: 5
            }
        ],
        morePromotionsWithoutPromotionalItems: [],
        punchCards: [],
        promotionalItems: [],
        ...overrides
    }
}

test('discoverBrowserTasks normalizes earnable dashboard and modern panel tasks', async () => {
    const { discoverBrowserTasks, summarizeBrowserTasks } = await loadDiscovery()
    const tasks = discoverBrowserTasks({
        dashboard: dashboard(),
        todayDate: '06/28/2026',
        panelData: {
            flyoutResult: {
                streakPromotion: {
                    offerId: ' ',
                    title: 'Modern quiz',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/modern',
                    pointProgressMax: 30,
                    pointProgress: 0,
                    activityProgressMax: 30
                }
            }
        }
    })

    assert.deepEqual(
        tasks.filter(task => task.points > 0).map(task => [task.source, task.kind, task.points, task.decision]),
        [
            ['dashboard', 'desktop-search', 50, 'auto'],
            ['dashboard', 'mobile-search', 10, 'auto'],
            ['dashboard', 'daily-set', 10, 'auto'],
            ['dashboard', 'more-promotion', 15, 'auto'],
            ['modern-panel', 'quiz', 30, 'auto']
        ]
    )
    assert.equal(summarizeBrowserTasks(tasks).totalEarnablePoints, 115)
})

test('discoverBrowserTasks records skipped unknown or locked tasks without counting points', async () => {
    const { discoverBrowserTasks, summarizeBrowserTasks } = await loadDiscovery()
    const tasks = discoverBrowserTasks({
        dashboard: dashboard({
            userStatus: { counters: { pcSearch: [], mobileSearch: [] } },
            dailySetPromotions: {},
            morePromotions: [
                {
                    offerId: 'mystery-1',
                    title: 'Mystery',
                    promotionType: 'mystery',
                    exclusiveLockedFeatureStatus: 'unlocked',
                    pointProgressMax: 99,
                    pointProgress: 0
                },
                {
                    offerId: 'locked-1',
                    title: 'Locked',
                    promotionType: 'quiz',
                    exclusiveLockedFeatureStatus: 'locked',
                    pointProgressMax: 20,
                    pointProgress: 0
                }
            ]
        }),
        todayDate: '06/28/2026'
    })

    assert.deepEqual(
        tasks.map(task => [task.offerId, task.decision, task.reason, task.points]),
        [
            ['mystery-1', 'unknown', 'unsupported-promotion-type', 0],
            ['locked-1', 'skip', 'locked-feature', 0]
        ]
    )
    assert.equal(summarizeBrowserTasks(tasks).unknownCount, 1)
})
