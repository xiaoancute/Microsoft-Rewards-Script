import type { Page } from 'patchright'
import type { BasePromotion } from '../../../interface/DashboardData'
import { Workers } from '../../Workers'

const POLL_OPTION_SELECTORS = ['input[type="radio"]', '.btOption', '.rqOption', '[role="radio"]']
const POLL_MAX_CLICK_ATTEMPTS = 3
const POLL_CONFIRMATION_READS_PER_CLICK = 2

export class Poll extends Workers {
    public async doPoll(promotion: BasePromotion, page: Page): Promise<void> {
        const oldBalance = Number(this.bot.userData.currentPoints ?? 0)
        const destinationUrl = promotion.destinationUrl

        if (destinationUrl) {
            await page.goto(destinationUrl).catch(() => {})
        }

        await this.bot.browser.utils.assertNoRiskControlPrompt(
            page,
            'poll-landing',
            this.bot.currentAccountEmail || 'unknown-account'
        )

        for (const selector of POLL_OPTION_SELECTORS) {
            const options = page.locator(selector)
            const count = await options.count().catch(() => 0)
            if (!count) continue

            for (let clickAttempt = 0; clickAttempt < POLL_MAX_CLICK_ATTEMPTS; clickAttempt++) {
                const clicked = await options
                    .first()
                    .click({ timeout: 3000 })
                    .then(() => true)
                    .catch(() => false)
                if (!clicked) continue

                for (let readAttempt = 0; readAttempt < POLL_CONFIRMATION_READS_PER_CLICK; readAttempt++) {
                    await this.bot.utils.wait(this.bot.utils.randomDelay(1500, 3000))

                    const newBalance = await this.bot.browser.func.getCurrentPoints().catch(() => oldBalance)
                    const gained = Math.max(0, Number(newBalance ?? oldBalance) - oldBalance)

                    if (gained > 0) {
                        this.bot.userData.currentPoints = Number(newBalance ?? oldBalance)
                        this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gained
                        return
                    }
                }
            }
        }

        this.bot.logger.warn(this.bot.isMobile, 'POLL', `未找到可点击投票选项 | offerId=${promotion.offerId}`)
    }
}
