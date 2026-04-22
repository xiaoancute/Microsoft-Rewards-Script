import type { Page } from 'patchright'
import type { BasePromotion } from '../../../interface/DashboardData'
import { Workers } from '../../Workers'

const URL_REWARD_CONFIRMATION_READS = 2

export class OpenUrlReward extends Workers {
    public async doOpenUrlReward(promotion: BasePromotion, page: Page): Promise<void> {
        const oldBalance = Number(this.bot.userData.currentPoints ?? 0)
        const destinationUrl = promotion.destinationUrl?.trim()

        if (!destinationUrl) {
            this.bot.logger.warn(this.bot.isMobile, 'OPEN-URL-REWARD', `缺少目标地址，跳过 | offerId=${promotion.offerId}`)
            return
        }

        const currentUrl = typeof page.url === 'function' ? page.url() : ''
        if (currentUrl !== destinationUrl) {
            await page.goto(destinationUrl).catch(() => {})
        }

        await this.bot.browser.utils.assertNoRiskControlPrompt(
            page,
            'urlreward-landing',
            this.bot.currentAccountEmail || 'unknown-account'
        )

        for (let readAttempt = 0; readAttempt < URL_REWARD_CONFIRMATION_READS; readAttempt++) {
            await this.bot.utils.wait(this.bot.utils.randomDelay(1500, 3000))

            const newBalance = await this.bot.browser.func.getCurrentPoints().catch(() => oldBalance)
            const gained = Math.max(0, Number(newBalance ?? oldBalance) - oldBalance)

            if (gained > 0) {
                this.bot.userData.currentPoints = Number(newBalance ?? oldBalance)
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gained
                return
            }
        }

        this.bot.logger.warn(
            this.bot.isMobile,
            'OPEN-URL-REWARD',
            `打开链接后未检测到积分变化 | offerId=${promotion.offerId} | url=${destinationUrl}`
        )
    }
}
