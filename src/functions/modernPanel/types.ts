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
    InfoOnly = 'info-only',
    Unknown = 'unknown'
}

export enum ModernOpportunityDecision {
    Auto = 'auto',
    Skip = 'skip'
}

export enum ModernOpportunityReason {
    AutoExecutable = 'auto-executable',
    DailyCheckInWebEntryNotSupported = 'daily-check-in-web-entry-not-supported',
    DuplicateWithLegacyWorker = 'duplicate-with-legacy-worker',
    InfoCardWithoutAction = 'info-card-without-action',
    UnsupportedOrUnknown = 'unsupported-or-unknown'
}

export interface ModernPanelOpportunity {
    source: ModernOpportunitySource
    kind: ModernOpportunityKind
    decision: ModernOpportunityDecision
    reason: ModernOpportunityReason
    offerId: null | string
    promotionType: null | string
    destinationUrl: null | string
    title: null | string
    promotion: unknown
}
