import type { Page } from 'patchright'
import * as OTPAuth from 'otpauth'
import type { MicrosoftRewardsBot } from '../../../index'
import { getErrorMessage, promptInput, waitForLoginAdvance, waitForLoginPageSettled } from './LoginUtils'

export class TotpLogin {
    private readonly textInputSelector =
        'form[name="OneTimeCodeViewForm"] input[type="text"], input#floatingLabelInput5'
    private readonly secondairyInputSelector = 'input[id="otc-confirmation-input"], input[name="otc"]'
    private readonly submitButtonSelector = 'button[type="submit"]'
    private readonly maxManualSeconds = 60
    private readonly maxManualAttempts = 5

    constructor(private bot: MicrosoftRewardsBot) {}

    private generateTotpCode(secret: string): string {
        return new OTPAuth.TOTP({ secret, digits: 6 }).generate()
    }

    private async fillCode(page: Page, code: string): Promise<boolean> {
        try {
            const visibleInput = await page
                .waitForSelector(this.textInputSelector, { state: 'visible', timeout: 500 })
                .catch(() => null)

            if (visibleInput) {
                await visibleInput.fill(code)
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-TOTP', 'Filled TOTP input')
                return true
            }

            const secondairyInput = await page.$(this.secondairyInputSelector)
            if (secondairyInput) {
                await secondairyInput.fill(code)
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-TOTP', 'Filled TOTP input')
                return true
            }

            this.bot.logger.warn(this.bot.isMobile, 'LOGIN-TOTP', 'No TOTP input field found')
            return false
        } catch (error) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'LOGIN-TOTP',
                `Failed to fill TOTP input: ${error instanceof Error ? error.message : String(error)}`
            )
            return false
        }
    }

    private async requestManualCode(): Promise<string | null> {
        return await promptInput({
            question: `输入6位TOTP代码 (等待 ${this.maxManualSeconds}秒): `,
            timeoutSeconds: this.maxManualSeconds,
            validate: code => /^\d{6}$/.test(code)
        })
    }

    private async submitAndConfirmAdvance(page: Page, attemptLabel: string): Promise<void> {
        await this.bot.utils.wait(500)
        await this.bot.browser.utils.ghostClick(page, this.submitButtonSelector)
        await waitForLoginPageSettled(page, {
            bot: this.bot,
            context: `${attemptLabel} 提交后`,
            tag: 'LOGIN-TOTP',
            timeoutMs: 1500,
            pauseMs: 150
        })

        const result = await waitForLoginAdvance(page, {
            bot: this.bot,
            context: `${attemptLabel} 提交后确认`,
            tag: 'LOGIN-TOTP',
            inputSelectors: [this.textInputSelector, this.secondairyInputSelector],
            timeoutMs: 2500
        })

        if (result.status === 'error' && result.errorMessage) {
            throw new Error(`TOTP身份验证失败: ${result.errorMessage}`)
        }

        if (result.status === 'stalled') {
            throw new Error('TOTP提交后页面未推进')
        }
    }

    async handle(page: Page, totpSecret?: string): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'LOGIN-TOTP', '请求TOTP双因素身份验证')

            if (totpSecret) {
                const code = this.generateTotpCode(totpSecret)
                this.bot.logger.info(this.bot.isMobile, 'LOGIN-TOTP', '从密钥生成TOTP代码')

                const filled = await this.fillCode(page, code)
                if (!filled) {
                    this.bot.logger.error(this.bot.isMobile, 'LOGIN-TOTP', '无法填写TOTP输入字段')
                    throw new Error('未找到TOTP输入字段')
                }

                await this.submitAndConfirmAdvance(page, '自动 TOTP')

                this.bot.logger.info(this.bot.isMobile, 'LOGIN-TOTP', 'TOTP身份验证成功完成')
                return
            }

            this.bot.logger.info(this.bot.isMobile, 'LOGIN-TOTP', '未提供TOTP密钥，等待手动输入')

            for (let attempt = 1; attempt <= this.maxManualAttempts; attempt++) {
                const code = await this.requestManualCode()

                if (!code || !/^\d{6}$/.test(code)) {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'LOGIN-TOTP',
                        `无效或缺少代码 (尝试 ${attempt}/${this.maxManualAttempts}) | 输入长度=${code?.length}`
                    )

                    if (attempt === this.maxManualAttempts) {
                        throw new Error('手动TOTP输入失败或超时')
                    }
                    continue
                }

                const filled = await this.fillCode(page, code)
                if (!filled) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'LOGIN-TOTP',
                        `无法填写TOTP输入 (尝试 ${attempt}/${this.maxManualAttempts})`
                    )

                    if (attempt === this.maxManualAttempts) {
                        throw new Error('未找到TOTP输入字段')
                    }
                    continue
                }

                try {
                    await this.submitAndConfirmAdvance(page, `手动 TOTP 第 ${attempt} 次`)
                } catch (error) {
                    const errorMessage = await getErrorMessage(page)
                    if (errorMessage || (error instanceof Error && error.message.includes('失败'))) {
                        const detail = errorMessage ?? (error instanceof Error ? error.message : String(error))
                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'LOGIN-TOTP',
                            `代码不正确: ${detail} (尝试 ${attempt}/${this.maxManualAttempts})`
                        )

                        if (attempt === this.maxManualAttempts) {
                            throw new Error(`达到最大尝试次数: ${detail}`)
                        }
                        continue
                    }

                    throw error
                }

                this.bot.logger.info(this.bot.isMobile, 'LOGIN-TOTP', 'TOTP身份验证成功完成')
                return
            }

            throw new Error(`TOTP输入在 ${this.maxManualAttempts} 次尝试后失败`)
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'LOGIN-TOTP',
                `发生错误: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }
}
