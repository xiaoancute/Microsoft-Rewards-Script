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

test('adaptModernDashboardData maps modern level metadata into dashboard level info fields', async () => {
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
            morePromotions: [],
            levelInfoPromotion: {
                activeLevel: 'Level2',
                levelMedallion: 'gold',
                showXboxBenefits: true,
                showShopAndEarnBenefits: false,
                isLevelRedesignEnabled: true
            },
            levelBenefitsPromotion: {
                activeLevel: 'Level2',
                supportedLevelTitles: ['Level 1', 'Level 2'],
                supportedLevelMedallion: ['silver', 'gold'],
                attributes: {
                    activeLevel: 'Level2',
                    levelMedallion: 'gold'
                },
                offerId: 'level-gold-1',
                title: 'Level Gold Benefits',
                pointProgressMax: 20,
                pointProgress: 0,
                complete: false,
                promotionType: 'urlreward'
            }
        }
    }

    const result = adaptModernDashboardData(panel, null, 'sg')

    assert.equal(result.userStatus.levelInfo.activeLevel, 'Level2')
    assert.equal(result.userStatus.levelInfo.activeLevelName, 'gold')
    assert.equal(result.userStatus.levelInfo.benefitsPromotion.offerId, 'level-gold-1')
    assert.equal(result.userStatus.levelInfo.benefitsPromotion.activeLevel, 'Level2')
    assert.deepEqual(result.userStatus.levelInfo.benefitsPromotion.supportedLevelTitles, ['Level 1', 'Level 2'])
    assert.deepEqual(result.userStatus.levelInfo.benefitsPromotion.supportedLevelTitlesMobile, ['Level 1', 'Level 2'])
    assert.equal(result.userStatus.levelInfo.benefitsPromotion.showXboxBenefits, true)
    assert.equal(result.userStatus.levelInfo.benefitsPromotion.showShopAndEarnBenefits, false)
    assert.equal(result.userStatus.levelInfo.benefitsPromotion.isLevelRedesignEnabled, true)
})

test('adaptModernDashboardData maps modern level earning-task progress into level info', async () => {
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
            morePromotions: [],
            levelInfoPromotion: {
                activityProgress: 3,
                activityProgressMax: 8,
                attributes: {
                    bing_search_daily_points: '12',
                    hva_dailyset_completed_amount: '2',
                    hva_dailyset_completed_max: '4',
                    hva_dailyset_days: '5',
                    hva_dailyset_days_max: '7',
                    hva_dailyset_display: 'true',
                    hva_dailyset_progress: 'true',
                    hva_dailystreaks_bing_completed_amount: '1',
                    hva_dailystreaks_bing_completed_max: '3',
                    hva_dailystreaks_bing_display: 'true',
                    hva_dailystreaks_bing_progress: 'false',
                    hva_dailystreaks_mobile_completed_amount: '2',
                    hva_dailystreaks_mobile_completed_max: '4',
                    hva_dailystreaks_mobile_display: 'false',
                    hva_dailystreaks_mobile_progress: 'true',
                    hva_dse_completed_amount: '6',
                    hva_dse_completed_max: '8',
                    hva_dse_days: '4',
                    hva_dse_days_max: '10',
                    hva_dse_display: 'true',
                    hva_dse_progress: 'true',
                    hva_gamepass_completed: 'true',
                    hva_gamepass_completed_amount: '1',
                    hva_gamepass_completed_max: '1',
                    hva_gamepass_display: 'true',
                    hva_gamepass_progress: 'true',
                    hva_seven_day_link: 'https://rewards.bing.com/hva-seven-day',
                    last_month_level_estimate: 'Level1',
                    level_up_actions_progress: '3',
                    monthly_bonus_distribution_chart_src: 'https://img.example/chart.png',
                    pointclaim_progress_dsebonus: '9',
                    pointclaim_progress_levelbonus: '11',
                    points_per_pc_search: '3',
                    points_per_pc_search_new_levels: '5',
                    program_restructure_monthly_dse_bonus_max: '20',
                    program_restructure_monthly_dse_bonus_state: 'active',
                    program_restructure_monthly_level_bonus_max: '30',
                    program_restructure_monthly_level_bonus_state: 'ready',
                    wave2_hvas_flight: 'enabled'
                }
            }
        }
    }

    const result = adaptModernDashboardData(panel, null, 'sg')

    assert.equal(result.userStatus.levelInfo.lastMonthLevel, 'Level1')
    assert.equal(result.userStatus.levelInfo.progress, 3)
    assert.equal(result.userStatus.levelInfo.progressMax, 8)
    assert.equal(result.userStatus.levelInfo.levelUpActivitiesProgress, 3)
    assert.equal(result.userStatus.levelInfo.levelUpActivitiesMax, 8)
    assert.equal(result.userStatus.levelInfo.levelUpActivityDailySetCompletedAmount, 2)
    assert.equal(result.userStatus.levelInfo.levelUpActivityDailySetStreakDays, 5)
    assert.equal(result.userStatus.levelInfo.levelUpActivityDailyStreaksCompletedAmount, 1)
    assert.equal(result.userStatus.levelInfo.levelUpActivityDefaultSearchEngineCompletedAmount, 6)
    assert.equal(result.userStatus.levelInfo.levelUpActivityDefaultSearchEngineDays, 4)
    assert.equal(result.userStatus.levelInfo.levelUpActivityXboxGamePassCompleted, true)
    assert.equal(result.userStatus.levelInfo.bingSearchDailyPoints, 12)
    assert.equal(result.userStatus.levelInfo.pointsPerSearch, 5)
    assert.equal(result.userStatus.levelInfo.defaultSearchEngineMonthlyBonusProgress, 9)
    assert.equal(result.userStatus.levelInfo.defaultSearchEngineMonthlyBonusMaximum, 20)
    assert.equal(result.userStatus.levelInfo.defaultSearchEngineMonthlyBonusState, 'active')
    assert.equal(result.userStatus.levelInfo.monthlyLevelBonusProgress, 11)
    assert.equal(result.userStatus.levelInfo.monthlyLevelBonusMaximum, 30)
    assert.equal(result.userStatus.levelInfo.monthlyLevelBonusState, 'ready')
    assert.equal(result.userStatus.levelInfo.monthlyDistributionChartSrc, 'https://img.example/chart.png')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailySetCompletedAmount_V2, '2')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailySetCompletedMax_V2, '4')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailySetDays_V2, '5')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailySetDaysMax_V2, '7')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailySetProgress_V2, true)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailySetDisplay_V2, true)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailyStreaksBingCompletedAmount_V2, '1')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailyStreaksBingCompletedMax_V2, '3')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailyStreaksBingProgress_V2, false)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailyStreaksBingDisplay_V2, true)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailyStreaksMobileCompletedAmount_V2, '2')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailyStreaksMobileCompletedMax_V2, '4')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailyStreaksMobileProgress_V2, true)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDailyStreaksMobileDisplay_V2, false)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpDefaultSearchEngineCompletedAmount_V2, '6')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDefaultSearchEngineCompletedMax_V2, '8')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDefaultSearchEngineDays_V2, '4')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDefaultSearchEngineDaysMax_V2, '10')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDefaultSearchEngineProgress_V2, true)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityDefaultSearchEngineDisplay_V2, true)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityXboxGamePassCompletedAmount_V2, '1')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityXboxGamePassCompletedMax_V2, '1')
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityXboxGamePassProgress_V2, true)
    assert.equal(result.userStatus.levelInfo.hvaLevelUpActivityXboxGamePassDisplay_V2, true)
    assert.equal(result.userStatus.levelInfo.programRestructureWave2HvaFlight, 'enabled')
    assert.equal(result.userStatus.levelInfo.programRestructureHvaSevenDayLink, 'https://rewards.bing.com/hva-seven-day')
})

test('adaptModernDashboardData parses structured level task and privilege lists', async () => {
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
            morePromotions: [],
            levelInfoPromotion: {
                attributes: {
                    level_keys: 'new_level_1,new_level_2,new_level_3',
                    level_values: 'Level 1,Level 2,Level 3',
                    level_tasks: 'Task A|Task B,Task C,Task D|Task E',
                    level_task_urls:
                        'https://example.com/task-a|https://example.com/task-b,https://example.com/task-c,https://example.com/task-d|https://example.com/task-e',
                    level_privileges: 'Perk A,Perk B|Perk C,Perk D|Perk E',
                    level_privilege_urls:
                        'https://example.com/perk-a,https://example.com/perk-b|https://example.com/perk-c,https://example.com/perk-d|https://example.com/perk-e',
                    level: 'new_level_2'
                }
            }
        }
    }

    const result = adaptModernDashboardData(panel, null, 'sg')

    assert.deepEqual(result.userStatus.levelInfo.levels, [
        {
            key: 'new_level_1',
            active: false,
            name: 'Level 1',
            tasks: [
                { text: 'Task A', url: 'https://example.com/task-a' },
                { text: 'Task B', url: 'https://example.com/task-b' }
            ],
            privileges: [{ text: 'Perk A', url: 'https://example.com/perk-a' }]
        },
        {
            key: 'new_level_2',
            active: true,
            name: 'Level 2',
            tasks: [{ text: 'Task C', url: 'https://example.com/task-c' }],
            privileges: [
                { text: 'Perk B', url: 'https://example.com/perk-b' },
                { text: 'Perk C', url: 'https://example.com/perk-c' }
            ]
        },
        {
            key: 'new_level_3',
            active: false,
            name: 'Level 3',
            tasks: [
                { text: 'Task D', url: 'https://example.com/task-d' },
                { text: 'Task E', url: 'https://example.com/task-e' }
            ],
            privileges: [
                { text: 'Perk D', url: 'https://example.com/perk-d' },
                { text: 'Perk E', url: 'https://example.com/perk-e' }
            ]
        }
    ])
})
