import type { Page } from 'patchright'
import type { MicrosoftRewardsBot } from '../../index'
import type { BasePromotion } from '../../interface/DashboardData'
import {
    ModernOpportunityDecision,
    ModernOpportunityKind,
    type ModernPanelOpportunity
} from './types'

function getPromotion(promotion: unknown): null | BasePromotion {
    if (!promotion || typeof promotion !== 'object') {
        return null
    }

    return promotion as BasePromotion
}

export async function executeModernPanelOpportunities(
    bot: MicrosoftRewardsBot,
    opportunities: ModernPanelOpportunity[],
    page: Page
) {
    const autoCount = opportunities.filter(x => x.decision === ModernOpportunityDecision.Auto).length
    const skipCount = opportunities.length - autoCount

    bot.logger.info(
        bot.isMobile,
        'MODERN-PANEL',
        `机会汇总 | total=${opportunities.length} | auto=${autoCount} | skip=${skipCount}`
    )

    for (const opportunity of opportunities) {
        bot.logger.info(
            bot.isMobile,
            'MODERN-ACTIVITY',
            `source=${opportunity.source} | offerId=${opportunity.offerId ?? 'unknown'} | offerIdState=${opportunity.offerIdState} | opportunityKey=${opportunity.opportunityKey} | promotionType=${opportunity.promotionType ?? 'unknown'} | promotionTypeState=${opportunity.promotionTypeState} | decision=${opportunity.decision} | reason=${opportunity.reason}`
        )

        if (opportunity.decision !== ModernOpportunityDecision.Auto) {
            continue
        }

        const promotion = getPromotion(opportunity.promotion)
        if (!promotion) {
            bot.logger.warn(
                bot.isMobile,
                'MODERN-ACTIVITY',
                `跳过活动 | offerId=${opportunity.offerId ?? 'unknown'} | 原因: promotion 数据无效`
            )
            continue
        }

        try {
            switch (opportunity.kind) {
                case ModernOpportunityKind.CheckIn: {
                    await bot.activities.doDailyCheckIn()
                    break
                }

                case ModernOpportunityKind.Poll: {
                    await bot.activities.doPoll(promotion, page)
                    break
                }

                case ModernOpportunityKind.Quiz: {
                    await bot.activities.doQuiz(promotion, page)
                    break
                }

                case ModernOpportunityKind.UrlReward: {
                    const name = promotion.name?.toLowerCase() ?? ''

                    if (name.includes('exploreonbing') && opportunity.offerId) {
                        await bot.activities.doSearchOnBing(promotion, page)
                    } else if (!opportunity.offerId) {
                        await bot.activities.doOpenUrlReward(promotion, page)
                    } else {
                        await bot.activities.doDaily(promotion)
                    }
                    break
                }

                default: {
                    bot.logger.warn(
                        bot.isMobile,
                        'MODERN-ACTIVITY',
                        `跳过活动 | offerId=${opportunity.offerId ?? 'unknown'} | 原因: 不支持的自动执行类型 "${opportunity.kind}"`
                    )
                    continue
                }
            }

            await bot.utils.wait(bot.utils.randomDelay(5000, 15000))
        } catch (error) {
            bot.logger.error(
                bot.isMobile,
                'MODERN-ACTIVITY',
                `处理活动失败 | offerId=${opportunity.offerId ?? 'unknown'} | 消息=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}
