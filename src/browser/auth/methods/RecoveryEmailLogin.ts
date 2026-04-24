import type { Page } from 'patchright'
import type { MicrosoftRewardsBot } from '../../../index'
import {
    clearTextInputForRetry,
    promptInput,
    waitForLoginAdvance,
    waitForLoginPageSettled
} from './LoginUtils'

export class RecoveryLogin {
    private readonly textInputSelector = '[data-testid="proof-confirmation"]'
    private readonly maxManualSeconds = 60
    private readonly maxManualAttempts = 5

    constructor(private bot: MicrosoftRewardsBot) {}

    private async fillEmail(page: Page, email: string): Promise<boolean> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', `Attempting to fill email: ${email}`)

            const visibleInput = await page
                .waitForSelector(this.textInputSelector, { state: 'visible', timeout: 500 })
                .catch(() => null)

            if (visibleInput) {
                await this.bot.browser.utils.humanType(page, email)
                await page.keyboard.press('Enter')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', 'Successfully filled email input field')
                return true
            }

            this.bot.logger.warn(
                this.bot.isMobile,
                'LOGIN-RECOVERY',
                `Email input field not found with selector: ${this.textInputSelector}`
            )
            return false
        } catch (error) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'LOGIN-RECOVERY',
                `Failed to fill email input: ${error instanceof Error ? error.message : String(error)}`
            )
            return false
        }
    }

    private async requestManualEmail(): Promise<string | null> {
        return await promptInput({
            question: `恢复邮箱 (等待 ${this.maxManualSeconds}秒): `,
            timeoutSeconds: this.maxManualSeconds,
            validate: email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        })
    }

    private async submitAndConfirmAdvance(page: Page, attemptLabel: string): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', '等待页面响应')
        await this.bot.utils.wait(500)
        await waitForLoginPageSettled(page, {
            bot: this.bot,
            context: `${attemptLabel} 提交后`,
            tag: 'LOGIN-RECOVERY',
            timeoutMs: 1500,
            pauseMs: 150
        })

        const result = await waitForLoginAdvance(page, {
            bot: this.bot,
            context: `${attemptLabel} 提交后确认`,
            tag: 'LOGIN-RECOVERY',
            inputSelectors: [this.textInputSelector],
            timeoutMs: 2500
        })

        if (result.status === 'error' && result.errorMessage) {
            throw new Error(result.errorMessage)
        }

        if (result.status === 'stalled') {
            throw new Error('恢复邮箱提交后页面未推进')
        }
    }

    async handle(page: Page, recoveryEmail: string): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', '邮箱恢复身份验证流程已启动')

            if (recoveryEmail) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'LOGIN-RECOVERY',
                    `使用提供的恢复邮箱: ${recoveryEmail}`
                )

                const filled = await this.fillEmail(page, recoveryEmail)
                if (!filled) {
                    throw new Error('未找到邮箱输入字段')
                }

                await this.submitAndConfirmAdvance(page, '恢复邮箱自动输入')

                this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', '邮箱身份验证成功完成')
                return
            }

            this.bot.logger.info(
                this.bot.isMobile,
                'LOGIN-RECOVERY',
                '未提供恢复邮箱，将提示用户输入'
            )

            for (let attempt = 1; attempt <= this.maxManualAttempts; attempt++) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'LOGIN-RECOVERY',
                    `开始尝试 ${attempt}/${this.maxManualAttempts}`
                )

                this.bot.logger.info(
                    this.bot.isMobile,
                    'LOGIN-RECOVERY',
                    `提示用户输入邮箱 (超时: ${this.maxManualSeconds}秒)`
                )

                const email = await this.requestManualEmail()

                if (!email) {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'LOGIN-RECOVERY',
                        `未收到或收到无效邮箱输入 (尝试 ${attempt}/${this.maxManualAttempts})`
                    )

                    if (attempt === this.maxManualAttempts) {
                        throw new Error('手动邮箱输入失败: 未收到输入')
                    }
                    continue
                }

                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'LOGIN-RECOVERY',
                        `收到无效邮箱格式 (尝试 ${attempt}/${this.maxManualAttempts}) | 长度=${email.length}`
                    )

                    if (attempt === this.maxManualAttempts) {
                        throw new Error('手动邮箱输入失败: 格式无效')
                    }
                    continue
                }

                this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', `从用户收到有效邮箱: ${email}`)

                const filled = await this.fillEmail(page, email)
                if (!filled) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'LOGIN-RECOVERY',
                        `无法填写邮箱输入字段 (尝试 ${attempt}/${this.maxManualAttempts})`
                    )

                    if (attempt === this.maxManualAttempts) {
                        throw new Error('最大尝试次数后未找到邮箱输入字段')
                    }

                    await this.bot.utils.wait(1000)
                    continue
                }

                try {
                    await this.submitAndConfirmAdvance(page, `恢复邮箱第 ${attempt} 次`)
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error)
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'LOGIN-RECOVERY',
                        `页面错误: "${errorMessage}" (尝试 ${attempt}/${this.maxManualAttempts})`
                    )

                    if (attempt === this.maxManualAttempts) {
                        throw new Error(`达到最大尝试次数。最后错误: ${errorMessage}`)
                    }

                    this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', '清除输入字段以重试')
                    const cleared = await clearTextInputForRetry(page, this.textInputSelector, this.bot.isMobile)
                    if (cleared) {
                        this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', '输入字段已清除')
                    } else {
                        this.bot.logger.warn(this.bot.isMobile, 'LOGIN-RECOVERY', '找不到要清除的输入字段')
                    }

                    await this.bot.utils.wait(1000)
                    continue
                }

                this.bot.logger.info(this.bot.isMobile, 'LOGIN-RECOVERY', '邮箱身份验证成功完成')
                return
            }

            throw new Error(`邮箱输入在 ${this.maxManualAttempts} 次尝试后失败`)
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            this.bot.logger.error(this.bot.isMobile, 'LOGIN-RECOVERY', `致命错误: ${errorMsg}`)
            throw error
        }
    }
}
