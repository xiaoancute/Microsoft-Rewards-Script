import type { DashboardData, Counters } from '../interface/DashboardData'
import type { PanelFlyoutData } from '../interface/PanelFlyoutData'

function createEmptyCounters(): Counters {
    return {
        pcSearch: [],
        mobileSearch: [],
        activityAndQuiz: [],
        dailyPoint: []
    }
}

function normalizeModernCounters(modernCounters: unknown, legacyCounters?: Counters): Counters {
    const normalized = createEmptyCounters()
    const modernRecord =
        modernCounters && typeof modernCounters === 'object' ? (modernCounters as Record<string, unknown>) : {}

    for (const [key, value] of Object.entries(modernRecord)) {
        if (!Array.isArray(value)) continue

        const normalizedKey = key.toLowerCase()

        if (normalizedKey.includes('pcsearch')) {
            normalized.pcSearch = value as Counters['pcSearch']
            continue
        }

        if (normalizedKey.includes('mobilesearch')) {
            normalized.mobileSearch = value as Counters['mobileSearch']
            continue
        }

        if (normalizedKey.includes('activityandquiz')) {
            normalized.activityAndQuiz = value as Counters['activityAndQuiz']
            continue
        }

        if (normalizedKey.includes('dailypoint')) {
            normalized.dailyPoint = value as Counters['dailyPoint']
        }
    }

    if (!legacyCounters) {
        return normalized
    }

    return {
        pcSearch: legacyCounters.pcSearch?.length ? legacyCounters.pcSearch : normalized.pcSearch,
        mobileSearch: legacyCounters.mobileSearch?.length ? legacyCounters.mobileSearch : normalized.mobileSearch,
        activityAndQuiz: legacyCounters.activityAndQuiz?.length
            ? legacyCounters.activityAndQuiz
            : normalized.activityAndQuiz,
        dailyPoint: legacyCounters.dailyPoint?.length ? legacyCounters.dailyPoint : normalized.dailyPoint
    }
}

function createEmptyLevelInfo(): DashboardData['userStatus']['levelInfo'] {
    return {
        isNewLevelsFeatureAvailable: false,
        lastMonthLevel: '',
        activeLevel: '',
        activeLevelName: '',
        progress: 0,
        progressMax: 0,
        levels: [],
        benefitsPromotion: {} as DashboardData['userStatus']['levelInfo']['benefitsPromotion'],
        levelUpActivitiesProgress: 0,
        levelUpActivitiesMax: 0,
        levelUpActivityDefaultSearchEngineDays: 0,
        levelUpActivityDefaultSearchEngineCompletedAmount: 0,
        levelUpActivityDailySetStreakDays: 0,
        levelUpActivityDailySetCompletedAmount: 0,
        levelUpActivityDailyStreaksCompletedAmount: 0,
        levelUpActivityXboxGamePassCompleted: false,
        bingStarMonthlyBonusProgress: 0,
        bingStarMonthlyBonusMaximum: 0,
        bingStarBonusWeeklyProgress: 0,
        bingStarBonusWeeklyState: '',
        defaultSearchEngineMonthlyBonusProgress: 0,
        defaultSearchEngineMonthlyBonusMaximum: 0,
        defaultSearchEngineMonthlyBonusState: '',
        monthlyLevelBonusProgress: 0,
        monthlyLevelBonusMaximum: 0,
        monthlyLevelBonusState: '',
        monthlyDistributionChartSrc: '',
        bingSearchDailyPoints: 0,
        pointsPerSearch: 0,
        hvaLevelUpActivityDailySetCompletedAmount_V2: '',
        hvaLevelUpActivityDailySetCompletedMax_V2: '',
        hvaLevelUpActivityDailySetDays_V2: '',
        hvaLevelUpActivityDailySetDaysMax_V2: '',
        hvaLevelUpActivityDailySetProgress_V2: false,
        hvaLevelUpActivityDailySetDisplay_V2: false,
        hvaLevelUpActivityDailyStreaksBingCompletedAmount_V2: '',
        hvaLevelUpActivityDailyStreaksBingCompletedMax_V2: '',
        hvaLevelUpActivityDailyStreaksBingProgress_V2: false,
        hvaLevelUpActivityDailyStreaksBingDisplay_V2: false,
        hvaLevelUpActivityDailyStreaksMobileCompletedAmount_V2: '',
        hvaLevelUpActivityDailyStreaksMobileCompletedMax_V2: '',
        hvaLevelUpActivityDailyStreaksMobileProgress_V2: false,
        hvaLevelUpActivityDailyStreaksMobileDisplay_V2: false,
        hvaLevelUpDefaultSearchEngineCompletedAmount_V2: '',
        hvaLevelUpActivityDefaultSearchEngineCompletedMax_V2: '',
        hvaLevelUpActivityDefaultSearchEngineDays_V2: '',
        hvaLevelUpActivityDefaultSearchEngineDaysMax_V2: '',
        hvaLevelUpActivityDefaultSearchEngineProgress_V2: false,
        hvaLevelUpActivityDefaultSearchEngineDisplay_V2: false,
        hvaLevelUpActivityXboxGamePassCompletedAmount_V2: '',
        hvaLevelUpActivityXboxGamePassCompletedMax_V2: '',
        hvaLevelUpActivityXboxGamePassProgress_V2: false,
        hvaLevelUpActivityXboxGamePassDisplay_V2: false,
        programRestructureWave2HvaFlight: '',
        programRestructureHvaSevenDayLink: ''
    } as unknown as DashboardData['userStatus']['levelInfo']
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') {
        return value
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true') return true
        if (normalized === 'false') return false
        if (normalized === '1') return true
        if (normalized === '0') return false
    }

    return fallback
}

function normalizeNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }

    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed.length) {
            return fallback
        }

        const parsed = Number(trimmed)
        if (Number.isFinite(parsed)) {
            return parsed
        }
    }

    return fallback
}

function normalizeString(value: unknown, fallback = ''): string {
    return typeof value === 'string' && value.trim().length ? value.trim() : fallback
}

function normalizeStringArray(value: unknown, fallback: string[] = []): string[] {
    if (!Array.isArray(value)) {
        return fallback
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function parseStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map(item => normalizeString(item))
            .filter((item): item is string => item.length > 0)
    }

    if (typeof value !== 'string') {
        return []
    }

    const trimmed = value.trim()
    if (!trimmed.length) {
        return []
    }

    try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
            return parsed
                .map(item => normalizeString(item))
                .filter((item): item is string => item.length > 0)
        }
    } catch {
        // Fall through to delimited parsing.
    }

    return trimmed
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
}

function parseGroupedStringList(value: unknown): string[][] {
    if (Array.isArray(value)) {
        return value.map(item => parseStringList(item))
    }

    if (typeof value !== 'string') {
        return []
    }

    const trimmed = value.trim()
    if (!trimmed.length) {
        return []
    }

    try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
            return parsed.map(item => parseStringList(item))
        }
    } catch {
        // Fall through to delimited parsing.
    }

    return trimmed
        .split(',')
        .map(group =>
            group
                .split('|')
                .map(item => item.trim())
                .filter(Boolean)
        )
}

function buildCloseLinkGroup(texts: string[], urls: string[]): { text: null | string; url: null | string }[] {
    return texts.map((text, index) => ({
        text: text || null,
        url: urls[index] || null
    }))
}

function buildLevels(
    keys: string[],
    names: string[],
    taskTexts: string[][],
    taskUrls: string[][],
    privilegeTexts: string[][],
    privilegeUrls: string[][],
    activeLevelKey: string,
    fallback: DashboardData['userStatus']['levelInfo']['levels']
): DashboardData['userStatus']['levelInfo']['levels'] {
    const levelCount = Math.max(
        keys.length,
        names.length,
        taskTexts.length,
        taskUrls.length,
        privilegeTexts.length,
        privilegeUrls.length
    )

    if (!levelCount) {
        return fallback
    }

    return Array.from({ length: levelCount }, (_, index) => {
        const key = keys[index] ?? ''
        const name = names[index] ?? key

        return {
            key,
            active: key.length > 0 ? key === activeLevelKey : index === 0 && !activeLevelKey,
            name,
            tasks: buildCloseLinkGroup(taskTexts[index] ?? [], taskUrls[index] ?? []),
            privileges: buildCloseLinkGroup(privilegeTexts[index] ?? [], privilegeUrls[index] ?? [])
        }
    }).filter(level => level.key.length > 0 || level.name.length > 0)
}

function buildModernLevelInfo(
    panelData: PanelFlyoutData,
    legacyLevelInfo?: DashboardData['userStatus']['levelInfo']
): DashboardData['userStatus']['levelInfo'] {
    const base = legacyLevelInfo ?? createEmptyLevelInfo()
    const levelInfoPromotion =
        panelData.flyoutResult?.levelInfoPromotion && typeof panelData.flyoutResult.levelInfoPromotion === 'object'
            ? (panelData.flyoutResult.levelInfoPromotion as unknown as Record<string, unknown>)
            : {}
    const levelBenefitsPromotion =
        panelData.flyoutResult?.levelBenefitsPromotion &&
        typeof panelData.flyoutResult.levelBenefitsPromotion === 'object'
            ? (panelData.flyoutResult.levelBenefitsPromotion as unknown as Record<string, unknown>)
            : {}
    const levelBenefitsAttributes =
        levelBenefitsPromotion.attributes && typeof levelBenefitsPromotion.attributes === 'object'
            ? (levelBenefitsPromotion.attributes as Record<string, unknown>)
            : {}
    const levelInfoAttributes =
        levelInfoPromotion.attributes && typeof levelInfoPromotion.attributes === 'object'
            ? (levelInfoPromotion.attributes as Record<string, unknown>)
            : {}

    const activeLevel = normalizeString(
        levelBenefitsPromotion.activeLevel,
        normalizeString(levelInfoPromotion.activeLevel, base.activeLevel)
    )
    const activeLevelName = normalizeString(
        levelInfoPromotion.levelMedallion,
        normalizeString(levelBenefitsAttributes.levelMedallion, base.activeLevelName)
    )
    const supportedLevelTitles = normalizeStringArray(
        levelBenefitsPromotion.supportedLevelTitles,
        base.benefitsPromotion.supportedLevelTitles ?? []
    )
    const supportedLevelKeys = normalizeStringArray(
        levelBenefitsPromotion.supportedLevelKeys,
        parseStringList(levelInfoAttributes.level_keys)
    )
    const levelValueTitles = parseStringList(levelInfoAttributes.level_values)
    const taskTexts = parseGroupedStringList(levelInfoAttributes.level_tasks)
    const taskUrls = parseGroupedStringList(levelInfoAttributes.level_task_urls)
    const privilegeTexts = parseGroupedStringList(levelInfoAttributes.level_privileges)
    const privilegeUrls = parseGroupedStringList(levelInfoAttributes.level_privilege_urls)
    const progress = normalizeNumber(levelInfoPromotion.activityProgress, base.progress)
    const progressMax = normalizeNumber(levelInfoPromotion.activityProgressMax, base.progressMax)
    const levelUpActivitiesProgress = normalizeNumber(
        levelInfoAttributes.level_up_actions_progress,
        normalizeNumber(levelInfoPromotion.activityProgress, base.levelUpActivitiesProgress)
    )
    const levelUpActivitiesMax = normalizeNumber(levelInfoPromotion.activityProgressMax, base.levelUpActivitiesMax)
    const dailySetCompletedAmount = normalizeNumber(
        levelInfoAttributes.hva_dailyset_completed_amount,
        base.levelUpActivityDailySetCompletedAmount
    )
    const dailySetStreakDays = normalizeNumber(levelInfoAttributes.hva_dailyset_days, base.levelUpActivityDailySetStreakDays)
    const dailyStreaksCompletedAmount = normalizeNumber(
        levelInfoAttributes.hva_dailystreaks_bing_completed_amount,
        base.levelUpActivityDailyStreaksCompletedAmount
    )
    const defaultSearchEngineCompletedAmount = normalizeNumber(
        levelInfoAttributes.hva_dse_completed_amount,
        base.levelUpActivityDefaultSearchEngineCompletedAmount
    )
    const defaultSearchEngineDays = normalizeNumber(
        levelInfoAttributes.hva_dse_days,
        base.levelUpActivityDefaultSearchEngineDays
    )
    const gamePassCompleted = normalizeBoolean(
        levelInfoAttributes.hva_gamepass_completed,
        base.levelUpActivityXboxGamePassCompleted
    )
    const bingSearchDailyPoints = normalizeNumber(
        levelInfoAttributes.bing_search_daily_points,
        base.bingSearchDailyPoints
    )
    const pointsPerSearch = normalizeNumber(
        levelInfoAttributes.points_per_pc_search_new_levels,
        normalizeNumber(levelInfoAttributes.points_per_pc_search, base.pointsPerSearch)
    )
    const activeLevelKey = normalizeString(levelInfoAttributes.level, '')
    const levelTitles =
        supportedLevelTitles.length >= supportedLevelKeys.length && supportedLevelTitles.length > 0
            ? supportedLevelTitles
            : levelValueTitles
    const levels = buildLevels(
        supportedLevelKeys,
        levelTitles,
        taskTexts,
        taskUrls,
        privilegeTexts,
        privilegeUrls,
        activeLevelKey,
        base.levels
    )

    return {
        ...base,
        isNewLevelsFeatureAvailable: normalizeBoolean(
            levelInfoPromotion.isNewLevelsFeatureAvailable,
            base.isNewLevelsFeatureAvailable
        ),
        lastMonthLevel: normalizeString(levelInfoAttributes.last_month_level_estimate, base.lastMonthLevel),
        activeLevel,
        activeLevelName,
        progress,
        progressMax,
        levels,
        levelUpActivitiesProgress,
        levelUpActivitiesMax,
        levelUpActivityDefaultSearchEngineDays: defaultSearchEngineDays,
        levelUpActivityDefaultSearchEngineCompletedAmount: defaultSearchEngineCompletedAmount,
        levelUpActivityDailySetStreakDays: dailySetStreakDays,
        levelUpActivityDailySetCompletedAmount: dailySetCompletedAmount,
        levelUpActivityDailyStreaksCompletedAmount: dailyStreaksCompletedAmount,
        levelUpActivityXboxGamePassCompleted: gamePassCompleted,
        bingStarMonthlyBonusProgress: normalizeNumber(
            levelInfoAttributes.pointclaim_progress_gooduserbonus,
            base.bingStarMonthlyBonusProgress
        ),
        bingStarMonthlyBonusMaximum: normalizeNumber(
            levelInfoAttributes.program_restructure_good_user_bonus_max,
            base.bingStarMonthlyBonusMaximum
        ),
        bingStarBonusWeeklyState: normalizeString(
            levelInfoAttributes.program_restructure_good_user_bonus_state,
            base.bingStarBonusWeeklyState
        ),
        defaultSearchEngineMonthlyBonusProgress: normalizeNumber(
            levelInfoAttributes.pointclaim_progress_dsebonus,
            base.defaultSearchEngineMonthlyBonusProgress
        ),
        defaultSearchEngineMonthlyBonusMaximum: normalizeNumber(
            levelInfoAttributes.program_restructure_monthly_dse_bonus_max,
            base.defaultSearchEngineMonthlyBonusMaximum
        ),
        defaultSearchEngineMonthlyBonusState: normalizeString(
            levelInfoAttributes.program_restructure_monthly_dse_bonus_state,
            base.defaultSearchEngineMonthlyBonusState
        ),
        monthlyLevelBonusProgress: normalizeNumber(
            levelInfoAttributes.pointclaim_progress_levelbonus,
            base.monthlyLevelBonusProgress
        ),
        monthlyLevelBonusMaximum: normalizeNumber(
            levelInfoAttributes.program_restructure_monthly_level_bonus_max,
            base.monthlyLevelBonusMaximum
        ),
        monthlyLevelBonusState: normalizeString(
            levelInfoAttributes.program_restructure_monthly_level_bonus_state,
            base.monthlyLevelBonusState
        ),
        monthlyDistributionChartSrc: normalizeString(
            levelInfoAttributes.monthly_bonus_distribution_chart_src,
            base.monthlyDistributionChartSrc
        ),
        bingSearchDailyPoints,
        pointsPerSearch,
        hvaLevelUpActivityDailySetCompletedAmount_V2: normalizeString(
            levelInfoAttributes.hva_dailyset_completed_amount,
            base.hvaLevelUpActivityDailySetCompletedAmount_V2
        ),
        hvaLevelUpActivityDailySetCompletedMax_V2: normalizeString(
            levelInfoAttributes.hva_dailyset_completed_max,
            base.hvaLevelUpActivityDailySetCompletedMax_V2
        ),
        hvaLevelUpActivityDailySetDays_V2: normalizeString(
            levelInfoAttributes.hva_dailyset_days,
            base.hvaLevelUpActivityDailySetDays_V2
        ),
        hvaLevelUpActivityDailySetDaysMax_V2: normalizeString(
            levelInfoAttributes.hva_dailyset_days_max,
            base.hvaLevelUpActivityDailySetDaysMax_V2
        ),
        hvaLevelUpActivityDailySetProgress_V2: normalizeBoolean(
            levelInfoAttributes.hva_dailyset_progress,
            base.hvaLevelUpActivityDailySetProgress_V2
        ),
        hvaLevelUpActivityDailySetDisplay_V2: normalizeBoolean(
            levelInfoAttributes.hva_dailyset_display,
            base.hvaLevelUpActivityDailySetDisplay_V2
        ),
        hvaLevelUpActivityDailyStreaksBingCompletedAmount_V2: normalizeString(
            levelInfoAttributes.hva_dailystreaks_bing_completed_amount,
            base.hvaLevelUpActivityDailyStreaksBingCompletedAmount_V2
        ),
        hvaLevelUpActivityDailyStreaksBingCompletedMax_V2: normalizeString(
            levelInfoAttributes.hva_dailystreaks_bing_completed_max,
            base.hvaLevelUpActivityDailyStreaksBingCompletedMax_V2
        ),
        hvaLevelUpActivityDailyStreaksBingProgress_V2: normalizeBoolean(
            levelInfoAttributes.hva_dailystreaks_bing_progress,
            base.hvaLevelUpActivityDailyStreaksBingProgress_V2
        ),
        hvaLevelUpActivityDailyStreaksBingDisplay_V2: normalizeBoolean(
            levelInfoAttributes.hva_dailystreaks_bing_display,
            base.hvaLevelUpActivityDailyStreaksBingDisplay_V2
        ),
        hvaLevelUpActivityDailyStreaksMobileCompletedAmount_V2: normalizeString(
            levelInfoAttributes.hva_dailystreaks_mobile_completed_amount,
            base.hvaLevelUpActivityDailyStreaksMobileCompletedAmount_V2
        ),
        hvaLevelUpActivityDailyStreaksMobileCompletedMax_V2: normalizeString(
            levelInfoAttributes.hva_dailystreaks_mobile_completed_max,
            base.hvaLevelUpActivityDailyStreaksMobileCompletedMax_V2
        ),
        hvaLevelUpActivityDailyStreaksMobileProgress_V2: normalizeBoolean(
            levelInfoAttributes.hva_dailystreaks_mobile_progress,
            base.hvaLevelUpActivityDailyStreaksMobileProgress_V2
        ),
        hvaLevelUpActivityDailyStreaksMobileDisplay_V2: normalizeBoolean(
            levelInfoAttributes.hva_dailystreaks_mobile_display,
            base.hvaLevelUpActivityDailyStreaksMobileDisplay_V2
        ),
        hvaLevelUpDefaultSearchEngineCompletedAmount_V2: normalizeString(
            levelInfoAttributes.hva_dse_completed_amount,
            base.hvaLevelUpDefaultSearchEngineCompletedAmount_V2
        ),
        hvaLevelUpActivityDefaultSearchEngineCompletedMax_V2: normalizeString(
            levelInfoAttributes.hva_dse_completed_max,
            base.hvaLevelUpActivityDefaultSearchEngineCompletedMax_V2
        ),
        hvaLevelUpActivityDefaultSearchEngineDays_V2: normalizeString(
            levelInfoAttributes.hva_dse_days,
            base.hvaLevelUpActivityDefaultSearchEngineDays_V2
        ),
        hvaLevelUpActivityDefaultSearchEngineDaysMax_V2: normalizeString(
            levelInfoAttributes.hva_dse_days_max,
            base.hvaLevelUpActivityDefaultSearchEngineDaysMax_V2
        ),
        hvaLevelUpActivityDefaultSearchEngineProgress_V2: normalizeBoolean(
            levelInfoAttributes.hva_dse_progress,
            base.hvaLevelUpActivityDefaultSearchEngineProgress_V2
        ),
        hvaLevelUpActivityDefaultSearchEngineDisplay_V2: normalizeBoolean(
            levelInfoAttributes.hva_dse_display,
            base.hvaLevelUpActivityDefaultSearchEngineDisplay_V2
        ),
        hvaLevelUpActivityXboxGamePassCompletedAmount_V2: normalizeString(
            levelInfoAttributes.hva_gamepass_completed_amount,
            base.hvaLevelUpActivityXboxGamePassCompletedAmount_V2
        ),
        hvaLevelUpActivityXboxGamePassCompletedMax_V2: normalizeString(
            levelInfoAttributes.hva_gamepass_completed_max,
            base.hvaLevelUpActivityXboxGamePassCompletedMax_V2
        ),
        hvaLevelUpActivityXboxGamePassProgress_V2: normalizeBoolean(
            levelInfoAttributes.hva_gamepass_progress,
            base.hvaLevelUpActivityXboxGamePassProgress_V2
        ),
        hvaLevelUpActivityXboxGamePassDisplay_V2: normalizeBoolean(
            levelInfoAttributes.hva_gamepass_display,
            base.hvaLevelUpActivityXboxGamePassDisplay_V2
        ),
        programRestructureWave2HvaFlight: normalizeString(
            levelInfoAttributes.wave2_hvas_flight,
            base.programRestructureWave2HvaFlight
        ),
        programRestructureHvaSevenDayLink: normalizeString(
            levelInfoAttributes.hva_seven_day_link,
            base.programRestructureHvaSevenDayLink
        ),
        benefitsPromotion: {
            ...base.benefitsPromotion,
            ...(panelData.flyoutResult?.levelBenefitsPromotion as unknown as
                | DashboardData['userStatus']['levelInfo']['benefitsPromotion']
                | undefined),
            activeLevel,
            supportedLevelTitles,
            supportedLevelTitlesMobile:
                supportedLevelTitles.length > 0
                    ? supportedLevelTitles
                    : (base.benefitsPromotion.supportedLevelTitlesMobile ?? []),
            showXboxBenefits: normalizeBoolean(
                levelInfoPromotion.showXboxBenefits,
                base.benefitsPromotion.showXboxBenefits ?? false
            ),
            showShopAndEarnBenefits: normalizeBoolean(
                levelInfoPromotion.showShopAndEarnBenefits,
                base.benefitsPromotion.showShopAndEarnBenefits ?? false
            ),
            isLevelRedesignEnabled: normalizeBoolean(
                levelInfoPromotion.isLevelRedesignEnabled,
                base.benefitsPromotion.isLevelRedesignEnabled ?? false
            )
        }
    }
}

export function createEmptyLegacyDashboardSubset(country: string): DashboardData {
    return {
        userStatus: {
            availablePoints: 0,
            lifetimePoints: 0,
            lifetimeGivingPoints: 0,
            levelInfo: createEmptyLevelInfo(),
            counters: createEmptyCounters()
        },
        userProfile: {
            ruid: '',
            attributes: {
                country
            }
        },
        userWarnings: [],
        promotionalItem: {} as DashboardData['promotionalItem'],
        promotionalItems: [],
        dailySetPromotions: {},
        streakPromotion: {} as DashboardData['streakPromotion'],
        streakBonusPromotions: [],
        punchCards: [],
        dashboardFlights: {} as DashboardData['dashboardFlights'],
        morePromotions: [],
        morePromotionsWithoutPromotionalItems: [],
        suggestedRewards: [],
        coachMarks: {} as DashboardData['coachMarks'],
        welcomeTour: {} as DashboardData['welcomeTour'],
        userInterests: {} as DashboardData['userInterests'],
        isVisualParityTest: false,
        mbingFlight: null,
        componentImpressionPromotions: [],
        machineTranslationPromo: {} as DashboardData['machineTranslationPromo'],
        bingUfMachineTranslationPromo: {} as DashboardData['bingUfMachineTranslationPromo'],
        streakProtectionPromo: {} as DashboardData['streakProtectionPromo'],
        autoRedeemItem: {} as DashboardData['autoRedeemItem'],
        isAutoRedeemEligible: false,
        autoRedeemSubscriptions: [],
        coupons: [],
        couponBannerPromotion: null,
        popUpPromotions: {} as DashboardData['popUpPromotions'],
        pointClaimBannerPromotion: null,
        highValueSweepstakesPromotions: [],
        revIpCountryName: null,
        shareAndWinPromotion: null,
        referAndEarnPromotion: {} as DashboardData['referAndEarnPromotion'],
        giveWithBingNoticePromotion: null,
        levelUpHeroBannerPromotion: null,
        monthlyBonusHeroBannerPromotion: null,
        starBonusWeeklyBannerPromotion: null,
        userGeneratedContentPromotion: null,
        created: new Date(0),
        findClippyPromotion: {} as DashboardData['findClippyPromotion']
    } as unknown as DashboardData
}

export function adaptModernDashboardData(
    panelData: PanelFlyoutData,
    legacySupplement: DashboardData | null,
    countryFallback: string
): DashboardData {
    const rewardsCountry = panelData.userInfo?.rewardsCountry || countryFallback
    const result = legacySupplement
        ? ({
              ...legacySupplement,
              userStatus: {
                  ...legacySupplement.userStatus,
                  counters: normalizeModernCounters(
                      panelData.flyoutResult?.userStatus?.counters,
                      legacySupplement.userStatus?.counters
                  )
              },
              userProfile: {
                  ...legacySupplement.userProfile,
                  attributes: {
                      ...legacySupplement.userProfile?.attributes,
                      country: rewardsCountry
                  }
              }
          } as DashboardData)
        : createEmptyLegacyDashboardSubset(rewardsCountry)

    result.userStatus = {
        ...result.userStatus,
        availablePoints: panelData.flyoutResult?.userStatus?.availablePoints ?? result.userStatus.availablePoints ?? 0,
        lifetimePoints: panelData.flyoutResult?.userStatus?.lifetimePoints ?? result.userStatus.lifetimePoints ?? 0,
        lifetimeGivingPoints:
            panelData.flyoutResult?.userStatus?.lifetimeGivingPoints ?? result.userStatus.lifetimeGivingPoints ?? 0,
        levelInfo: buildModernLevelInfo(panelData, result.userStatus.levelInfo),
        counters: normalizeModernCounters(panelData.flyoutResult?.userStatus?.counters, result.userStatus.counters)
    } as DashboardData['userStatus']

    result.userProfile = {
        ...result.userProfile,
        attributes: {
            ...result.userProfile?.attributes,
            country: rewardsCountry
        }
    } as DashboardData['userProfile']

    result.dailySetPromotions = (panelData.flyoutResult?.dailySetPromotions ??
        {}) as unknown as DashboardData['dailySetPromotions']
    result.morePromotions = (panelData.flyoutResult?.morePromotions ?? []) as unknown as DashboardData['morePromotions']
    result.morePromotionsWithoutPromotionalItems = []
    result.promotionalItems = legacySupplement?.promotionalItems ?? []
    result.punchCards = legacySupplement?.punchCards ?? []
    result.componentImpressionPromotions = legacySupplement?.componentImpressionPromotions ?? []
    result.streakBonusPromotions = legacySupplement?.streakBonusPromotions ?? []
    result.suggestedRewards = legacySupplement?.suggestedRewards ?? []
    result.findClippyPromotion = legacySupplement?.findClippyPromotion ?? result.findClippyPromotion

    return result
}
