import type { Page } from 'patchright'
import type { BasePromotion } from '../../../interface/DashboardData'
import { Workers } from '../../Workers'

const POLL_OPTION_SELECTORS = ['input[type="radio"]', '.btOption', '.rqOption', '[role="radio"]']

export class Poll extends Workers {
    public async doPoll(promotion: BasePromotion, page: Page): Promise<void> {
        const oldBalance = Number(this.bot.userData.currentPoints ?? 0)

        for (const selector of POLL_OPTION_SELECTORS) {
            const count = await page.locator(selector).count().catch(() => 0)
            if (!count) continue

            const clicked = await this.bot.browser.utils.ghostClick(page, `${selector}:nth-of-type(1)`)
            if (!clicked) continue

            await this.bot.utils.wait(this.bot.utils.randomDelay(1500, 3000))

            const newBalance = await this.bot.browser.func.getCurrentPoints().catch(() => oldBalance)
            const gained = Math.max(0, Number(newBalance ?? oldBalance) - oldBalance)

            if (gained > 0) {
                this.bot.userData.currentPoints = Number(newBalance ?? oldBalance)
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gained
            }

            return
        }

        this.bot.logger.warn(this.bot.isMobile, 'POLL', `未找到可点击投票选项 | offerId=${promotion.offerId}`)
    }
}
