import type { DashboardData } from '../../interface/DashboardData'
import type { PanelFlyoutData } from '../../interface/PanelFlyoutData'
import {
    ModernOpportunityDecision,
    ModernOpportunityFieldState,
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
    name?: unknown
    title?: unknown
    promotionType?: unknown
    destinationUrl?: unknown
    pointProgressMax?: unknown
    activityProgressMax?: unknown
    exclusiveLockedFeatureStatus?: unknown
    hash?: unknown
    activityType?: unknown
    complete?: unknown
}

interface NormalizedStringField {
    value: null | string
    state: ModernOpportunityFieldState
}

function normalizeStringField(
    value: unknown,
    normalizeValue?: (rawValue: string) => string
): NormalizedStringField {
    if (value === null || typeof value === 'undefined') {
        return {
            value: null,
            state: ModernOpportunityFieldState.Missing
        }
    }

    if (typeof value !== 'string') {
        return {
            value: null,
            state: ModernOpportunityFieldState.InvalidType
        }
    }

    const trimmed = value.trim()
    if (!trimmed.length) {
        return {
            value: null,
            state: ModernOpportunityFieldState.Blank
        }
    }

    return {
        value: normalizeValue ? normalizeValue(trimmed) : trimmed,
        state: ModernOpportunityFieldState.Normalized
    }
}

function normalizeString(value: unknown): null | string {
    return normalizeStringField(value).value
}

function getOfferIdField(promotion: PromotionLike): NormalizedStringField {
    return normalizeStringField(promotion.offerId)
}

function getOfferId(promotion: PromotionLike): null | string {
    return getOfferIdField(promotion).value
}

function getPromotionTypeField(promotion: PromotionLike): NormalizedStringField {
    return normalizeStringField(promotion.promotionType, value => value.toLowerCase())
}

function getPromotionType(promotion: PromotionLike): null | string {
    return getPromotionTypeField(promotion).value
}

function getDestinationUrl(promotion: PromotionLike): null | string {
    return normalizeString(promotion.destinationUrl)
}

function getNumeric(value: unknown): null | number {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getComplete(promotion: PromotionLike): boolean {
    if (typeof promotion.complete === 'boolean') {
        return promotion.complete
    }

    const normalized = normalizeString(promotion.complete)
    if (!normalized) {
        return false
    }

    const lower = normalized.toLowerCase()
    return lower === 'true' || lower === 'complete' || lower === '1'
}

function hasPollScenarioDestination(promotion: PromotionLike): boolean {
    const destinationUrl = getDestinationUrl(promotion)
    return !!destinationUrl && destinationUrl.toLowerCase().includes('pollscenarioid=')
}

function getName(promotion: PromotionLike): null | string {
    return normalizeStringField(promotion.name, value => value.toLowerCase()).value
}

function isPollPromotion(promotion: PromotionLike): boolean {
    return getPromotionType(promotion) === 'quiz' && hasPollScenarioDestination(promotion)
}

function isEightQuestionQuizPromotion(promotion: PromotionLike): boolean {
    return getPromotionType(promotion) === 'quiz' && (getNumeric(promotion.activityProgressMax) ?? 0) === 80
}

function hasPositiveActionability(promotion: PromotionLike): boolean {
    const pointProgressMax = getNumeric(promotion.pointProgressMax) ?? 0
    const activityProgressMax = getNumeric(promotion.activityProgressMax) ?? 0
    return pointProgressMax > 0 || activityProgressMax > 0
}

function hasValidDestination(promotion: PromotionLike): boolean {
    return !!getDestinationUrl(promotion)
}

function hasExecutionContractFields(promotion: PromotionLike): boolean {
    return (
        !!getOfferId(promotion) &&
        !!normalizeString(promotion.hash) &&
        !!normalizeString(promotion.activityType) &&
        !!getDestinationUrl(promotion)
    )
}

function isValidUrlRewardPromotion(promotion: PromotionLike): boolean {
    return getPromotionType(promotion) === 'urlreward' && hasExecutionContractFields(promotion)
}

function isQuizPromotion(promotion: PromotionLike): boolean {
    return getPromotionType(promotion) === 'quiz'
}

function isExploreOnBingPromotion(promotion: PromotionLike): boolean {
    return (getName(promotion) ?? '').includes('exploreonbing')
}

function isLockedPromotion(promotion: PromotionLike): boolean {
    const status = normalizeString(promotion.exclusiveLockedFeatureStatus)
    if (!status) {
        return false
    }

    const normalizedStatus = status.toLowerCase()
    return normalizedStatus === 'locked' || normalizedStatus === 'notsupported'
}

function getLockedStatus(promotion: PromotionLike): null | string {
    return normalizeStringField(promotion.exclusiveLockedFeatureStatus, value => value.toLowerCase()).value
}

function isBlankOfferIdField(field: NormalizedStringField): boolean {
    return (
        field.state === ModernOpportunityFieldState.Blank ||
        field.state === ModernOpportunityFieldState.Missing ||
        field.state === ModernOpportunityFieldState.InvalidType
    )
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

    return ModernOpportunityKind.InfoOnly
}

function classifyOpportunity(
    source: ModernOpportunitySource,
    promotion: PromotionLike,
    offerIdField: NormalizedStringField
): Pick<ModernPanelOpportunity, 'decision' | 'reason'> {
    if (source === ModernOpportunitySource.Daily) {
        if (getComplete(promotion)) {
            return {
                decision: ModernOpportunityDecision.Skip,
                reason: ModernOpportunityReason.UnsupportedPromotionType
            }
        }

        if (isLockedPromotion(promotion)) {
            return {
                decision: ModernOpportunityDecision.Skip,
                reason: ModernOpportunityReason.LockedFeature
            }
        }

        if (hasPositiveActionability(promotion)) {
            return {
                decision: ModernOpportunityDecision.Auto,
                reason: ModernOpportunityReason.AutoExecutable
            }
        }

        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.UnsupportedPromotionType
        }
    }

    if (source === ModernOpportunitySource.Level && isInfoCardWithoutAction(promotion)) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.InfoCardWithoutAction
        }
    }

    if (getComplete(promotion)) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.UnsupportedPromotionType
        }
    }

    if (isLockedPromotion(promotion)) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.LockedFeature
        }
    }

    const blankOfferId = isBlankOfferIdField(offerIdField)
    const positiveActionability = hasPositiveActionability(promotion)

    if (blankOfferId && positiveActionability) {
        if (isPollPromotion(promotion)) {
            return {
                decision: ModernOpportunityDecision.Auto,
                reason: ModernOpportunityReason.AutoExecutableWithoutOfferId
            }
        }

        if (isEightQuestionQuizPromotion(promotion) && hasValidDestination(promotion)) {
            return {
                decision: ModernOpportunityDecision.Auto,
                reason: ModernOpportunityReason.AutoExecutableWithoutOfferId
            }
        }

        if (isQuizPromotion(promotion) && hasValidDestination(promotion)) {
            return {
                decision: ModernOpportunityDecision.Auto,
                reason: ModernOpportunityReason.AutoExecutableWithoutOfferId
            }
        }

        if (
            getPromotionType(promotion) === 'urlreward' &&
            hasValidDestination(promotion) &&
            !isExploreOnBingPromotion(promotion)
        ) {
            return {
                decision: ModernOpportunityDecision.Auto,
                reason: ModernOpportunityReason.AutoExecutableWithoutOfferId
            }
        }

        if (isQuizPromotion(promotion) || getPromotionType(promotion) === 'urlreward') {
            return {
                decision: ModernOpportunityDecision.Skip,
                reason: ModernOpportunityReason.MissingOfferIdRequiresApiExecution
            }
        }
    }

    const autoQuizOrPoll = (isPollPromotion(promotion) || isQuizPromotion(promotion)) && positiveActionability
    const autoUrlReward = isValidUrlRewardPromotion(promotion) && positiveActionability

    if (autoQuizOrPoll || autoUrlReward) {
        return {
            decision: ModernOpportunityDecision.Auto,
            reason: ModernOpportunityReason.AutoExecutable
        }
    }

    return {
        decision: ModernOpportunityDecision.Skip,
        reason: ModernOpportunityReason.UnsupportedPromotionType
    }
}

function keyPart(value: null | string): string {
    return value ? value.trim().toLowerCase() : 'unknown'
}

function buildOpportunityKey(
    source: ModernOpportunitySource,
    kind: ModernOpportunityKind,
    offerId: null | string,
    promotionType: null | string,
    destinationUrl: null | string,
    title: null | string,
    lockedStatus: null | string
): string {
    if (offerId) {
        return `offer:${offerId.trim().toLowerCase()}`
    }

    return [
        source,
        kind,
        keyPart(promotionType),
        keyPart(destinationUrl),
        keyPart(title),
        keyPart(lockedStatus)
    ].join('|')
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

function preferOpportunity(left: ModernPanelOpportunity, right: ModernPanelOpportunity): ModernPanelOpportunity {
    if (left.decision !== right.decision) {
        return left.decision === ModernOpportunityDecision.Auto ? left : right
    }

    if (left.kind !== right.kind) {
        return left.kind !== ModernOpportunityKind.InfoOnly ? left : right
    }

    return left
}

function dedupeOpportunities(opportunities: ModernPanelOpportunity[]): ModernPanelOpportunity[] {
    const seen = new Map<string, ModernPanelOpportunity>()

    for (const opportunity of opportunities) {
        const current = seen.get(opportunity.opportunityKey)
        seen.set(opportunity.opportunityKey, current ? preferOpportunity(current, opportunity) : opportunity)
    }

    return [...seen.values()]
}

function toOpportunity(
    source: ModernOpportunitySource,
    promotion: PromotionLike | null | undefined,
    legacyOfferIds: Set<string>
): null | ModernPanelOpportunity {
    if (!promotion || typeof promotion !== 'object') {
        return null
    }

    const offerIdField = getOfferIdField(promotion)
    const promotionTypeField = getPromotionTypeField(promotion)
    const offerId = offerIdField.value
    const kind = inferKind(source, promotion)
    const initialClassification = classifyOpportunity(source, promotion, offerIdField)
    const duplicateWithLegacyWorker = !!offerId && legacyOfferIds.has(offerId)
    const destinationUrl = getDestinationUrl(promotion)
    const title = normalizeString(promotion.title)
    const lockedStatus = getLockedStatus(promotion)

    return {
        source,
        kind,
        decision: duplicateWithLegacyWorker ? ModernOpportunityDecision.Skip : initialClassification.decision,
        reason: duplicateWithLegacyWorker ? ModernOpportunityReason.DuplicateWithLegacyWorker : initialClassification.reason,
        offerId,
        offerIdState: offerIdField.state,
        opportunityKey: buildOpportunityKey(
            source,
            kind,
            offerId,
            promotionTypeField.value,
            destinationUrl,
            title,
            lockedStatus
        ),
        promotionType: promotionTypeField.value,
        promotionTypeState: promotionTypeField.state,
        destinationUrl,
        title,
        promotion
    }
}

export function collectModernPanelOpportunities(
    panelData: PanelFlyoutData | null | undefined,
    legacyDashboardData?: LegacyOfferSources | null
): ModernPanelOpportunity[] {
    const legacyOfferIds = collectLegacyOfferIds(legacyDashboardData)
    const streakBonusPromotions = panelData?.flyoutResult?.streakBonusPromotions ?? []

    const candidates = [
        toOpportunity(ModernOpportunitySource.Daily, panelData?.flyoutResult?.dailyCheckInPromotion, legacyOfferIds),
        toOpportunity(ModernOpportunitySource.Streak, panelData?.flyoutResult?.streakPromotion, legacyOfferIds),
        ...streakBonusPromotions.map((promotion) =>
            toOpportunity(ModernOpportunitySource.Streak, promotion, legacyOfferIds)
        ),
        toOpportunity(ModernOpportunitySource.Level, panelData?.flyoutResult?.levelInfoPromotion, legacyOfferIds),
        toOpportunity(ModernOpportunitySource.Level, panelData?.flyoutResult?.levelBenefitsPromotion, legacyOfferIds)
    ].filter((item): item is ModernPanelOpportunity => item !== null)

    return dedupeOpportunities(candidates)
}
