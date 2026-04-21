export enum ModernOpportunitySource {
    Daily = 'daily',
    Streak = 'streak',
    Level = 'level'
}

export enum ModernOpportunityKind {
    CheckIn = 'checkin',
    Poll = 'poll',
    Quiz = 'quiz',
    UrlReward = 'urlreward',
    InfoOnly = 'info-only'
}

export enum ModernOpportunityDecision {
    Auto = 'auto',
    Skip = 'skip'
}

export enum ModernOpportunityFieldState {
    Normalized = 'normalized',
    Missing = 'missing',
    Blank = 'blank',
    InvalidType = 'invalid-type'
}

export enum ModernOpportunityReason {
    AutoExecutable = 'auto-executable',
    AutoExecutableWithoutOfferId = 'auto-executable-without-offerid',
    DailyCheckInWebEntryNotSupported = 'daily-check-in-web-entry-not-supported',
    DuplicateWithLegacyWorker = 'duplicate-with-legacy-worker',
    InfoCardWithoutAction = 'info-card-without-action',
    LockedFeature = 'locked-feature',
    MissingOfferIdRequiresApiExecution = 'missing-offerid-requires-api-execution',
    UnsupportedPromotionType = 'unsupported-promotion-type'
}

export interface ModernPanelOpportunity {
    source: ModernOpportunitySource
    kind: ModernOpportunityKind
    decision: ModernOpportunityDecision
    reason: ModernOpportunityReason
    offerId: null | string
    offerIdState: ModernOpportunityFieldState
    opportunityKey: string
    promotionType: null | string
    promotionTypeState: ModernOpportunityFieldState
    destinationUrl: null | string
    title: null | string
    promotion: unknown
}
