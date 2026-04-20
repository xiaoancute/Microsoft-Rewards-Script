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

export function createEmptyLegacyDashboardSubset(country: string): DashboardData {
    return {
        userStatus: {
            availablePoints: 0,
            lifetimePoints: 0,
            lifetimeGivingPoints: 0,
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
