import type { DashboardData } from '../../interface/DashboardData'
import type { PanelFlyoutData } from '../../interface/PanelFlyoutData'
import {
    ModernOpportunityDecision,
    ModernOpportunityKind,
    ModernOpportunityReason,
    ModernOpportunitySource,
    type ModernPanelOpportunity
} from './types'

type LegacyOfferSources = Partial<
    Pick<DashboardData, 'morePromotions' | 'dailySetPromotions' | 'morePromotionsWithoutPromotionalItems'>
>

interface PromotionLike {
    offerId?: unknown
    title?: unknown
    promotionType?: unknown
    destinationUrl?: unknown
    pointProgressMax?: unknown
    activityProgressMax?: unknown
}

function normalizeString(value: unknown): null | string {
    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
}

function getOfferId(promotion: PromotionLike): null | string {
    return normalizeString(promotion.offerId)
}

function getPromotionType(promotion: PromotionLike): null | string {
    const promotionType = normalizeString(promotion.promotionType)
    return promotionType ? promotionType.toLowerCase() : null
}

function getDestinationUrl(promotion: PromotionLike): null | string {
    return normalizeString(promotion.destinationUrl)
}

function getNumeric(value: unknown): null | number {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function hasPollScenarioDestination(promotion: PromotionLike): boolean {
    const destinationUrl = getDestinationUrl(promotion)
    return !!destinationUrl && destinationUrl.toLowerCase().includes('pollscenarioid=')
}

function isPollPromotion(promotion: PromotionLike): boolean {
    return getPromotionType(promotion) === 'quiz' && hasPollScenarioDestination(promotion)
}

function isValidUrlRewardPromotion(promotion: PromotionLike): boolean {
    return getPromotionType(promotion) === 'urlreward' && !!getDestinationUrl(promotion) && !!getOfferId(promotion)
}

function isInfoCardWithoutAction(promotion: PromotionLike): boolean {
    const pointProgressMax = getNumeric(promotion.pointProgressMax) ?? 0
    const activityProgressMax = getNumeric(promotion.activityProgressMax) ?? 0
    return pointProgressMax <= 0 && activityProgressMax <= 0
}

function inferKind(source: ModernOpportunitySource, promotion: PromotionLike): ModernOpportunityKind {
    if (source === ModernOpportunitySource.Daily) {
        return ModernOpportunityKind.CheckIn
    }

    if (source === ModernOpportunitySource.Level && isInfoCardWithoutAction(promotion)) {
        return ModernOpportunityKind.InfoOnly
    }

    if (isPollPromotion(promotion)) {
        return ModernOpportunityKind.Poll
    }

    const promotionType = getPromotionType(promotion)
    if (promotionType === 'urlreward') {
        return ModernOpportunityKind.UrlReward
    }

    if (promotionType === 'quiz') {
        return ModernOpportunityKind.Quiz
    }

    return ModernOpportunityKind.Unknown
}

function classifyOpportunity(
    source: ModernOpportunitySource,
    promotion: PromotionLike
): Pick<ModernPanelOpportunity, 'decision' | 'reason'> {
    if (source === ModernOpportunitySource.Daily) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.DailyCheckInWebEntryNotSupported
        }
    }

    if (source === ModernOpportunitySource.Level && isInfoCardWithoutAction(promotion)) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.InfoCardWithoutAction
        }
    }

    if (isPollPromotion(promotion) || isValidUrlRewardPromotion(promotion)) {
        return {
            decision: ModernOpportunityDecision.Auto,
            reason: ModernOpportunityReason.AutoExecutable
        }
    }

    return {
        decision: ModernOpportunityDecision.Skip,
        reason: ModernOpportunityReason.UnsupportedOrUnknown
    }
}

function collectLegacyOfferIds(legacyData: LegacyOfferSources | null | undefined): Set<string> {
    const offerIds = new Set<string>()
    if (!legacyData) {
        return offerIds
    }

    for (const promotion of legacyData.morePromotions ?? []) {
        const offerId = normalizeString(promotion.offerId)
        if (offerId) {
            offerIds.add(offerId)
        }
    }

    for (const promotion of legacyData.morePromotionsWithoutPromotionalItems ?? []) {
        const offerId = normalizeString(promotion.offerId)
        if (offerId) {
            offerIds.add(offerId)
        }
    }

    for (const promotions of Object.values(legacyData.dailySetPromotions ?? {})) {
        for (const promotion of promotions) {
            const offerId = normalizeString(promotion.offerId)
            if (offerId) {
                offerIds.add(offerId)
            }
        }
    }

    return offerIds
}

function toOpportunity(
    source: ModernOpportunitySource,
    promotion: PromotionLike | null | undefined,
    legacyOfferIds: Set<string>
): null | ModernPanelOpportunity {
    if (!promotion || typeof promotion !== 'object') {
        return null
    }

    const offerId = getOfferId(promotion)
    const kind = inferKind(source, promotion)
    const initialClassification = classifyOpportunity(source, promotion)
    const duplicateWithLegacyWorker = !!offerId && legacyOfferIds.has(offerId)

    return {
        source,
        kind,
        decision: duplicateWithLegacyWorker ? ModernOpportunityDecision.Skip : initialClassification.decision,
        reason: duplicateWithLegacyWorker ? ModernOpportunityReason.DuplicateWithLegacyWorker : initialClassification.reason,
        offerId,
        promotionType: getPromotionType(promotion),
        destinationUrl: getDestinationUrl(promotion),
        title: normalizeString(promotion.title),
        promotion
    }
}

export function collectModernPanelOpportunities(
    panelData: PanelFlyoutData | null | undefined,
    legacyDashboardData?: LegacyOfferSources | null
): ModernPanelOpportunity[] {
    const legacyOfferIds = collectLegacyOfferIds(legacyDashboardData)

    const candidates = [
        toOpportunity(ModernOpportunitySource.Daily, panelData?.flyoutResult?.dailyCheckInPromotion, legacyOfferIds),
        toOpportunity(ModernOpportunitySource.Streak, panelData?.flyoutResult?.streakPromotion, legacyOfferIds),
        toOpportunity(ModernOpportunitySource.Level, panelData?.flyoutResult?.levelInfoPromotion, legacyOfferIds),
        toOpportunity(ModernOpportunitySource.Level, panelData?.flyoutResult?.levelBenefitsPromotion, legacyOfferIds)
    ]

    return candidates.filter((item): item is ModernPanelOpportunity => item !== null)
}
