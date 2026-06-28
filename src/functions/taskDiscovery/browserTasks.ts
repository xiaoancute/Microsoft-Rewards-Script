import type { DashboardData } from '../../interface/DashboardData'
import type { PanelFlyoutData } from '../../interface/PanelFlyoutData'
import { collectModernPanelOpportunities } from '../modernPanel/collectModernPanelOpportunities'
import { ModernOpportunityDecision, ModernOpportunityKind } from '../modernPanel/types'

export type BrowserTaskDecision = 'auto' | 'skip' | 'unknown'

export interface BrowserTask {
    source: 'dashboard' | 'modern-panel'
    kind: string
    title: string
    offerId: string | null
    points: number
    decision: BrowserTaskDecision
    reason: string
}

export interface BrowserTaskSummary {
    desktopSearchPoints: number
    mobileSearchPoints: number
    dailySetPoints: number
    morePromotionsPoints: number
    punchCardPoints: number
    specialPromotionsPoints: number
    modernPanelPoints: number
    totalEarnablePoints: number
    taskCount: number
    unknownCount: number
}

type PromotionLike = {
    title?: unknown
    name?: unknown
    offerId?: unknown
    promotionType?: unknown
    exclusiveLockedFeatureStatus?: unknown
    pointProgressMax?: unknown
    pointProgress?: unknown
    complete?: unknown
    attributes?: object
}

export function discoverBrowserTasks({
    dashboard,
    panelData,
    todayDate
}: {
    dashboard: DashboardData
    panelData?: PanelFlyoutData | null
    todayDate: string
}): BrowserTask[] {
    const tasks: BrowserTask[] = []
    const counters = dashboard.userStatus?.counters ?? {}
    const desktopSearchPoints = sumCounterPoints(counters.pcSearch)
    const mobileSearchPoints = sumCounterPoints(counters.mobileSearch)

    if (desktopSearchPoints > 0) tasks.push(task('dashboard', 'desktop-search', '桌面搜索', null, desktopSearchPoints))
    if (mobileSearchPoints > 0) tasks.push(task('dashboard', 'mobile-search', '移动搜索', null, mobileSearchPoints))

    for (const promotion of dashboard.dailySetPromotions?.[todayDate] ?? []) {
        tasks.push(classifyPromotion('daily-set', promotion))
    }

    for (const promotion of [...(dashboard.morePromotions ?? []), ...(dashboard.morePromotionsWithoutPromotionalItems ?? [])]) {
        tasks.push(classifyPromotion('more-promotion', promotion))
    }

    for (const punchCard of dashboard.punchCards ?? []) {
        if (punchCard?.parentPromotion?.complete || Number(punchCard?.parentPromotion?.pointProgressMax ?? 0) <= 0) continue
        for (const promotion of punchCard.childPromotions ?? []) {
            if ((promotion?.attributes as { is_unlocked?: unknown } | undefined)?.is_unlocked) continue
            tasks.push(classifyPromotion('punch-card', promotion))
        }
    }

    for (const promotion of dashboard.promotionalItems ?? []) {
        if (String(promotion?.name ?? '').toLowerCase().includes('ww_banner_optin_2x')) continue
        tasks.push(classifyPromotion('special-promotion', promotion))
    }

    if (panelData) {
        for (const opportunity of collectModernPanelOpportunities(panelData, dashboard)) {
            const promotion = opportunity.promotion as PromotionLike
            tasks.push({
                source: 'modern-panel',
                kind: opportunity.kind,
                title: opportunity.title ?? promotionTitle(promotion),
                offerId: opportunity.offerId,
                points:
                    opportunity.decision === ModernOpportunityDecision.Auto && opportunity.kind !== ModernOpportunityKind.CheckIn
                        ? Math.max(0, num(promotion.pointProgressMax) - num(promotion.pointProgress))
                        : 0,
                decision: opportunity.decision === ModernOpportunityDecision.Auto ? 'auto' : 'skip',
                reason: opportunity.reason
            })
        }
    }

    return tasks.filter(item => item.points > 0 || item.decision !== 'auto')
}

export function summarizeBrowserTasks(tasks: BrowserTask[]): BrowserTaskSummary {
    const summary: BrowserTaskSummary = {
        desktopSearchPoints: 0,
        mobileSearchPoints: 0,
        dailySetPoints: 0,
        morePromotionsPoints: 0,
        punchCardPoints: 0,
        specialPromotionsPoints: 0,
        modernPanelPoints: 0,
        totalEarnablePoints: 0,
        taskCount: tasks.length,
        unknownCount: tasks.filter(item => item.decision === 'unknown').length
    }

    for (const item of tasks) {
        if (item.source === 'modern-panel') summary.modernPanelPoints += item.points
        else if (item.kind === 'desktop-search') summary.desktopSearchPoints += item.points
        else if (item.kind === 'mobile-search') summary.mobileSearchPoints += item.points
        else if (item.kind === 'daily-set') summary.dailySetPoints += item.points
        else if (item.kind === 'more-promotion') summary.morePromotionsPoints += item.points
        else if (item.kind === 'punch-card') summary.punchCardPoints += item.points
        else if (item.kind === 'special-promotion') summary.specialPromotionsPoints += item.points
    }

    summary.totalEarnablePoints =
        summary.desktopSearchPoints +
        summary.mobileSearchPoints +
        summary.dailySetPoints +
        summary.morePromotionsPoints +
        summary.punchCardPoints +
        summary.specialPromotionsPoints +
        summary.modernPanelPoints

    return summary
}

function classifyPromotion(kind: string, promotion: PromotionLike): BrowserTask {
    if (complete(promotion)) return task('dashboard', kind, promotionTitle(promotion), offerId(promotion), 0, 'skip', 'complete')
    if (locked(promotion)) return task('dashboard', kind, promotionTitle(promotion), offerId(promotion), 0, 'skip', 'locked-feature')
    if (kind === 'daily-set') return task('dashboard', kind, promotionTitle(promotion), offerId(promotion), remainingPoints(promotion))

    const type = String(promotion.promotionType ?? '').toLowerCase()
    const supported = ['quiz', 'urlreward', 'findclippy'].includes(type)
    if (!supported) {
        return task('dashboard', kind, promotionTitle(promotion), offerId(promotion), 0, 'unknown', 'unsupported-promotion-type')
    }

    return task('dashboard', kind, promotionTitle(promotion), offerId(promotion), remainingPoints(promotion))
}

function task(
    source: BrowserTask['source'],
    kind: string,
    title: string,
    offerId: string | null,
    points: number,
    decision: BrowserTaskDecision = 'auto',
    reason = 'auto-executable'
): BrowserTask {
    return { source, kind, title, offerId, points, decision, reason }
}

function sumCounterPoints(counters?: Array<{ pointProgressMax?: number; pointProgress?: number }>): number {
    return counters?.reduce((sum, item) => sum + Math.max(0, num(item.pointProgressMax) - num(item.pointProgress)), 0) ?? 0
}

function remainingPoints(promotion: PromotionLike): number {
    return Math.max(0, num(promotion.pointProgressMax) - num(promotion.pointProgress))
}

function num(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function complete(promotion: PromotionLike): boolean {
    return promotion.complete === true || String(promotion.complete ?? '').toLowerCase() === 'true'
}

function locked(promotion: PromotionLike): boolean {
    return ['locked', 'notsupported'].includes(String(promotion.exclusiveLockedFeatureStatus ?? '').toLowerCase())
}

function offerId(promotion: PromotionLike): string | null {
    const value = String(promotion.offerId ?? '').trim()
    return value || null
}

function promotionTitle(promotion: PromotionLike): string {
    return String(promotion.title || promotion.name || offerId(promotion) || 'unknown')
}
