import type { Page } from 'patchright'
import type { MicrosoftRewardsBot } from '../../index'
import { saveSessionData } from '../../util/Load'

import { MobileAccessLogin } from './methods/MobileAccessLogin'
import { EmailLogin } from './methods/EmailLogin'
import { PasswordlessLogin } from './methods/PasswordlessLogin'
import { TotpLogin } from './methods/Totp2FALogin'
import { CodeLogin } from './methods/GetACodeLogin'
import { RecoveryLogin } from './methods/RecoveryEmailLogin'
import { waitForLoginPageSettled } from './methods/LoginUtils'

import type { Account } from '../../interface/Account'

type LoginState =
    | 'EMAIL_INPUT'
    | 'PASSWORD_INPUT'
    | 'SIGN_IN_ANOTHER_WAY'
    | 'SIGN_IN_ANOTHER_WAY_EMAIL'
    | 'PASSKEY_ERROR'
    | 'PASSKEY_VIDEO'
    | 'KMSI_PROMPT'
    | 'LOGGED_IN'
    | 'RECOVERY_EMAIL_INPUT'
    | 'ACCOUNT_LOCKED'
    | 'ERROR_ALERT'
    | '2FA_TOTP'
    | 'LOGIN_PASSWORDLESS'
    | 'GET_A_CODE'
    | 'GET_A_CODE_2'
    | 'OTP_CODE_ENTRY'
    | 'UNKNOWN'
    | 'CHROMEWEBDATA_ERROR'
    | 'REWARDS_WELCOME'

export class Login {
    emailLogin: EmailLogin
    passwordlessLogin: PasswordlessLogin
    totp2FALogin: TotpLogin
    codeLogin: CodeLogin
    recoveryLogin: RecoveryLogin

    private readonly selectors = {
        primaryButton: 'button[data-testid="primaryButton"]',
        secondaryButton: 'button[data-testid="secondaryButton"]',
        emailIcon: '[data-testid="tile"]:has(svg path[d*="M5.25 4h13.5a3.25"])',
        emailIconOld: 'img[data-testid="accessibleImg"][src*="picker_verify_email"]',
        recoveryEmail: '[data-testid="proof-confirmation"]',
        passwordIcon: '[data-testid="tile"]:has(svg path[d*="M11.78 10.22a.75.75"])',
        accountLocked: '#serviceAbuseLandingTitle',
        errorAlert: 'div[role="alert"]',
        passwordEntry: '[data-testid="passwordEntry"]',
        emailEntry: 'input#usernameEntry',
        kmsiVideo: '[data-testid="kmsiVideo"]',
        passKeyVideo: '[data-testid="biometricVideo"]',
        passKeyError: '[data-testid="registrationImg"]',
        passwordlessCheck: '[data-testid="deviceShieldCheckmarkVideo"]',
        totpInput: 'input[name="otc"]',
        totpInputOld: 'form[name="OneTimeCodeViewForm"]',
        identityBanner: '[data-testid="identityBanner"]',
        viewFooter: '[data-testid="viewFooter"] >> [role="button"]',
        otherWaysToSignIn: '[data-testid="viewFooter"] span[role="button"]',
        otpCodeEntry: '[data-testid="codeEntry"]',
        backButton: '#back-button',
        bingProfile: '#id_n',
        requestToken: 'input[name="__RequestVerificationToken"]',
        requestTokenMeta: 'meta[name="__RequestVerificationToken"]',
        otpInput: 'div[data-testid="codeEntry"]'
    } as const

    constructor(private bot: MicrosoftRewardsBot) {
        this.emailLogin = new EmailLogin(this.bot)
        this.passwordlessLogin = new PasswordlessLogin(this.bot)
        this.totp2FALogin = new TotpLogin(this.bot)
        this.codeLogin = new CodeLogin(this.bot)
        this.recoveryLogin = new RecoveryLogin(this.bot)
    }

    private getRewardsLoginUrl(): string {
        return 'https://rewards.bing.com/createuser?idru=%2F&userScenarioId=anonsignin'
    }

    private isAnonymousRewardsPage(url: URL): boolean {
        return url.hostname === 'rewards.bing.com' && (url.pathname === '/welcome' || url.pathname === '/createuser')
    }

    private isAuthenticatedRewardsPage(url: URL): boolean {
        if (url.hostname === 'account.microsoft.com') {
            return true
        }

        if (url.hostname !== 'rewards.bing.com') {
            return false
        }

        return !this.isAnonymousRewardsPage(url)
    }

    private getRewardsDashboardUrl(): string {
        return new URL('/dashboard', this.bot.config.baseURL).toString()
    }

    private async waitForPageSettled(page: Page, context: string, timeout = 1500, pauseMs = 250) {
        await waitForLoginPageSettled(page, {
            bot: this.bot,
            context,
            tag: 'LOGIN',
            timeoutMs: timeout,
            pauseMs
        })
    }

    async login(page: Page, account: Account) {
        try {
            this.bot.logger.info(this.bot.isMobile, 'LOGIN', '开始登录流程')

            await page
                .goto(this.getRewardsLoginUrl(), {
                    waitUntil: 'domcontentloaded'
                })
                .catch(() => {})
            await this.waitForPageSettled(page, '初始登录页加载', 2000, 400)
            await this.bot.browser.utils.reloadBadPage(page)
            await this.bot.browser.utils.disableFido(page)

            const maxIterations = 25
            const recoveryLimits: Partial<Record<LoginState, number>> = {
                CHROMEWEBDATA_ERROR: 3,
                REWARDS_WELCOME: 3,
                UNKNOWN: 6
            }
            const recoveryStateCounts: Partial<Record<LoginState, number>> = {}
            let iteration = 0
            let previousState: LoginState = 'UNKNOWN'
            let sameStateCount = 0

            while (iteration < maxIterations) {
                if (page.isClosed()) throw new Error('页面意外关闭')

                iteration++
                this.bot.logger.debug(this.bot.isMobile, 'LOGIN', `状态检查迭代 ${iteration}/${maxIterations}`)

                const state = await this.detectCurrentState(page, account)
                this.bot.logger.debug(this.bot.isMobile, 'LOGIN', `当前状态: ${state}`)

                const recoveryLimit = recoveryLimits[state]
                if (recoveryLimit !== undefined) {
                    const nextCount = (recoveryStateCounts[state] ?? 0) + 1
                    recoveryStateCounts[state] = nextCount
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'LOGIN',
                        `恢复状态 ${state} 第 ${nextCount}/${recoveryLimit} 次`
                    )

                    if (nextCount > recoveryLimit) {
                        const labels: Partial<Record<LoginState, string>> = {
                            CHROMEWEBDATA_ERROR: 'chromewebdata 恢复循环',
                            REWARDS_WELCOME: '欢迎页恢复次数过多',
                            UNKNOWN: '未知状态恢复循环'
                        }
                        throw new Error(labels[state] ?? `${state} 恢复循环次数过多`)
                    }
                } else {
                    recoveryStateCounts.CHROMEWEBDATA_ERROR = 0
                    recoveryStateCounts.REWARDS_WELCOME = 0
                    recoveryStateCounts.UNKNOWN = 0
                }

                if (state !== previousState && previousState !== 'UNKNOWN') {
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', `状态转换: ${previousState} → ${state}`)
                }

                if (state === previousState && state !== 'LOGGED_IN' && state !== 'UNKNOWN') {
                    sameStateCount++
                    this.bot.logger.debug(
                        this.bot.isMobile,
                        'LOGIN',
                        `相同状态计数: ${sameStateCount}/4 状态为 "${state}"`
                    )
                    if (sameStateCount === 3) {
                        await this.waitForPageSettled(page, `状态 "${state}" 停滞后的轻量复检`, 1000, 150)
                        const recheckedState = await this.detectCurrentState(page, account)
                        if (recheckedState !== state) {
                            this.bot.logger.info(
                                this.bot.isMobile,
                                'LOGIN',
                                `轻量复检发现状态变化: ${state} → ${recheckedState}`
                            )
                            sameStateCount = 0
                            previousState = 'UNKNOWN'
                            continue
                        }
                    }
                    if (sameStateCount >= 4) {
                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'LOGIN',
                            `在状态 "${state}" 停滞4次循环，刷新页面`
                        )
                        await page.reload({ waitUntil: 'domcontentloaded' })
                        await this.waitForPageSettled(page, '刷新页面后')
                        sameStateCount = 0
                        previousState = 'UNKNOWN'
                        continue
                    }
                } else {
                    sameStateCount = 0
                }
                previousState = state

                if (state === 'LOGGED_IN') {
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', '登录成功')
                    break
                }

                const shouldContinue = await this.handleState(state, page, account)
                if (!shouldContinue) {
                    throw new Error(`登录失败或中止于状态: ${state}`)
                }

                await this.bot.utils.wait(1000)
            }

            if (iteration >= maxIterations) {
                throw new Error('登录超时: 超过最大迭代次数')
            }

            await this.finalizeLogin(page, account.email)
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'LOGIN',
                `致命错误: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    private async detectCurrentState(page: Page, account?: Account): Promise<LoginState> {
        await this.waitForPageSettled(page, '检测状态前', 1200, 150)

        const url = new URL(page.url())
        this.bot.logger.debug(this.bot.isMobile, 'DETECT-STATE', `当前URL: ${url.hostname}${url.pathname}`)

        if (url.hostname === 'chromewebdata') {
            this.bot.logger.warn(this.bot.isMobile, 'DETECT-STATE', '检测到chromewebdata错误页面')
            return 'CHROMEWEBDATA_ERROR'
        }

        if (url.hostname === 'rewards.bing.com' && url.pathname === '/welcome') {
            this.bot.logger.debug(this.bot.isMobile, 'DETECT-STATE', '检测到 Rewards 匿名欢迎页')
            return 'REWARDS_WELCOME'
        }

        const isLocked = await this.checkSelector(page, this.selectors.accountLocked)
        if (isLocked) {
            this.bot.logger.debug(this.bot.isMobile, 'DETECT-STATE', '账户锁定选择器被发现')
            return 'ACCOUNT_LOCKED'
        }

        if (this.isAuthenticatedRewardsPage(url)) {
            this.bot.logger.debug(this.bot.isMobile, 'DETECT-STATE', '在奖励/账户页面，假设已登录')
            return 'LOGGED_IN'
        }

        const stateChecks: Array<[string, LoginState]> = [
            [this.selectors.errorAlert, 'ERROR_ALERT'],
            [this.selectors.passwordEntry, 'PASSWORD_INPUT'],
            [this.selectors.emailEntry, 'EMAIL_INPUT'],
            [this.selectors.recoveryEmail, 'RECOVERY_EMAIL_INPUT'],
            [this.selectors.kmsiVideo, 'KMSI_PROMPT'],
            [this.selectors.passKeyVideo, 'PASSKEY_VIDEO'],
            [this.selectors.passKeyError, 'PASSKEY_ERROR'],
            [this.selectors.passwordIcon, 'SIGN_IN_ANOTHER_WAY'],
            [this.selectors.emailIcon, 'SIGN_IN_ANOTHER_WAY_EMAIL'],
            [this.selectors.emailIconOld, 'SIGN_IN_ANOTHER_WAY_EMAIL'],
            [this.selectors.passwordlessCheck, 'LOGIN_PASSWORDLESS'],
            [this.selectors.totpInput, '2FA_TOTP'],
            [this.selectors.totpInputOld, '2FA_TOTP'],
            [this.selectors.otpCodeEntry, 'OTP_CODE_ENTRY'], // PR 450
            [this.selectors.otpInput, 'OTP_CODE_ENTRY'] // 我的修复
        ]

        const results = await Promise.all(
            stateChecks.map(async ([sel, state]) => {
                const visible = await this.checkSelector(page, sel)
                return visible ? state : null
            })
        )

        const visibleStates = results.filter((s): s is LoginState => s !== null)
        if (visibleStates.length > 0) {
            this.bot.logger.debug(this.bot.isMobile, 'DETECT-STATE', `可见状态: [${visibleStates.join(', ')}]`)
        }

        const [identityBanner, primaryButton, passwordEntry] = await Promise.all([
            this.checkSelector(page, this.selectors.identityBanner),
            this.checkSelector(page, this.selectors.primaryButton),
            this.checkSelector(page, this.selectors.passwordEntry)
        ])

        if (identityBanner && primaryButton && !passwordEntry && !results.includes('2FA_TOTP')) {
            const codeState = account?.password ? 'GET_A_CODE' : 'GET_A_CODE_2'
            this.bot.logger.debug(
                this.bot.isMobile,
                'DETECT-STATE',
                `检测到获取代码状态: ${codeState} (有密码: ${!!account?.password})`
            )
            results.push(codeState)
        }

        let foundStates = results.filter((s): s is LoginState => s !== null)

        if (foundStates.length === 0) {
            this.bot.logger.debug(this.bot.isMobile, 'DETECT-STATE', '未找到匹配的状态')
            return 'UNKNOWN'
        }

        if (foundStates.includes('ERROR_ALERT')) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'DETECT-STATE',
                `发现ERROR_ALERT - 主机名: ${url.hostname}, 有2FA: ${foundStates.includes('2FA_TOTP')}`
            )
            if (url.hostname !== 'login.live.com') {
                foundStates = foundStates.filter(s => s !== 'ERROR_ALERT')
            }
            if (foundStates.includes('2FA_TOTP')) {
                foundStates = foundStates.filter(s => s !== 'ERROR_ALERT')
            }
            if (foundStates.includes('ERROR_ALERT')) return 'ERROR_ALERT'
        }

        const priorities: LoginState[] = [
            'ACCOUNT_LOCKED',
            'PASSKEY_VIDEO',
            'PASSKEY_ERROR',
            'KMSI_PROMPT',
            'PASSWORD_INPUT',
            'EMAIL_INPUT',
            'SIGN_IN_ANOTHER_WAY', // 优先选择密码选项而不是邮箱验证码
            'SIGN_IN_ANOTHER_WAY_EMAIL',
            'OTP_CODE_ENTRY',
            'GET_A_CODE',
            'GET_A_CODE_2',
            'LOGIN_PASSWORDLESS',
            '2FA_TOTP'
        ]

        for (const priority of priorities) {
            if (foundStates.includes(priority)) {
                this.bot.logger.debug(this.bot.isMobile, 'DETECT-STATE', `按优先级选择状态: ${priority}`)
                return priority
            }
        }

        this.bot.logger.debug(this.bot.isMobile, 'DETECT-STATE', `返回第一个找到的状态: ${foundStates[0]}`)
        return foundStates[0] as LoginState
    }

    private async checkSelector(page: Page, selector: string): Promise<boolean> {
        return page
            .waitForSelector(selector, { state: 'visible', timeout: 200 })
            .then(() => true)
            .catch(() => false)
    }

    private async handleState(state: LoginState, page: Page, account: Account): Promise<boolean> {
        this.bot.logger.debug(this.bot.isMobile, 'HANDLE-STATE', `处理状态: ${state}`)

        switch (state) {
            case 'ACCOUNT_LOCKED': {
                const msg = '此账户已被锁定！从配置中移除并重新启动！'
                this.bot.logger.alert(this.bot.isMobile, 'ACCOUNT-LOCKED', `${account.email} — ${msg}`)
                this.bot.logger.error(this.bot.isMobile, 'LOGIN', msg)
                throw new Error(msg)
            }

            case 'ERROR_ALERT': {
                const alertEl = page.locator(this.selectors.errorAlert)
                const errorMsg = await alertEl.innerText().catch(() => '未知错误')
                this.bot.logger.error(this.bot.isMobile, 'LOGIN', `账户错误: ${errorMsg}`)
                throw new Error(`微软登录错误: ${errorMsg}`)
            }

            case 'LOGGED_IN':
                return true

            case 'EMAIL_INPUT': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '输入邮箱')
                await this.emailLogin.enterEmail(page, account.email)
                await this.waitForPageSettled(page, '邮箱输入后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '邮箱输入成功')
                return true
            }

            case 'PASSWORD_INPUT': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '输入密码')
                await this.emailLogin.enterPassword(page, account.password)
                await this.waitForPageSettled(page, '密码输入后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '密码输入成功')
                return true
            }

            case 'GET_A_CODE': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '尝试绕过"获取代码"页面')

                // 尝试查找"其他登录方式"链接
                const otherWaysLink = await page
                    .waitForSelector(this.selectors.otherWaysToSignIn, { state: 'visible', timeout: 3000 })
                    .catch(() => null)

                if (otherWaysLink) {
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', '找到"其他登录方式"链接')
                    await this.bot.browser.utils.ghostClick(page, this.selectors.otherWaysToSignIn)
                    await this.waitForPageSettled(page, '点击其他登录方式后')
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', '"其他登录方式"已点击')
                    return true
                }

                // 备用方案: 尝试通用的viewFooter选择器
                const footerLink = await page
                    .waitForSelector(this.selectors.viewFooter, { state: 'visible', timeout: 2000 })
                    .catch(() => null)

                if (footerLink) {
                    await this.bot.browser.utils.ghostClick(page, this.selectors.viewFooter)
                    await this.waitForPageSettled(page, '点击页脚后')
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', '页脚链接已点击')
                    return true
                }

                // 如果没有找到链接，尝试点击返回按钮
                const backBtn = await page
                    .waitForSelector(this.selectors.backButton, { state: 'visible', timeout: 2000 })
                    .catch(() => null)

                if (backBtn) {
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', '未找到登录选项，点击返回按钮')
                    await this.bot.browser.utils.ghostClick(page, this.selectors.backButton)
                    await this.waitForPageSettled(page, '点击返回按钮后')
                    return true
                }

                this.bot.logger.warn(this.bot.isMobile, 'LOGIN', '找不到绕过获取代码页面的方法')
                return true
            }

            case 'GET_A_CODE_2': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '处理"获取代码"流程')
                await this.bot.browser.utils.ghostClick(page, this.selectors.primaryButton)
                await this.waitForPageSettled(page, '点击主按钮后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '启动代码登录处理器')
                await this.codeLogin.handle(page)
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '代码登录处理器完成')
                return true
            }

            case 'SIGN_IN_ANOTHER_WAY_EMAIL': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '选择"发送代码到邮箱"')

                const emailSelector = await Promise.race([
                    this.checkSelector(page, this.selectors.emailIcon).then(found =>
                        found ? this.selectors.emailIcon : null
                    ),
                    this.checkSelector(page, this.selectors.emailIconOld).then(found =>
                        found ? this.selectors.emailIconOld : null
                    )
                ])

                if (!emailSelector) {
                    this.bot.logger.warn(this.bot.isMobile, 'LOGIN', '未找到邮箱图标')
                    return false
                }

                this.bot.logger.info(
                    this.bot.isMobile,
                    'LOGIN',
                    `使用${emailSelector === this.selectors.emailIcon ? '新' : '旧'}邮箱图标选择器`
                )
                await this.bot.browser.utils.ghostClick(page, emailSelector)
                await this.waitForPageSettled(page, '点击邮箱验证图标后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '启动代码登录处理器')
                await this.codeLogin.handle(page)
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '代码登录处理器完成')
                return true
            }

            case 'RECOVERY_EMAIL_INPUT': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '检测到恢复邮箱输入')
                await this.waitForPageSettled(page, '恢复邮箱页面加载')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '启动恢复邮箱处理器')
                await this.recoveryLogin.handle(page, account?.recoveryEmail)
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '恢复邮箱处理器完成')
                return true
            }

            case 'CHROMEWEBDATA_ERROR': {
                this.bot.logger.warn(this.bot.isMobile, 'LOGIN', '检测到chromewebdata错误，尝试恢复')
                try {
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', `导航到 ${this.bot.config.baseURL}`)
                    await page
                        .goto(this.bot.config.baseURL, {
                            waitUntil: 'domcontentloaded',
                            timeout: 10000
                        })
                        .catch(() => {})
                    await this.waitForPageSettled(page, '恢复到 Rewards 页面', 2000, 400)
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', '恢复导航成功')
                    return true
                } catch {
                    this.bot.logger.warn(this.bot.isMobile, 'LOGIN', '回退到login.live.com')
                    await page
                        .goto('https://login.live.com/', {
                            waitUntil: 'domcontentloaded',
                            timeout: 10000
                        })
                        .catch(() => {})
                    await this.waitForPageSettled(page, '回退到 live.com 页面', 2000, 400)
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', '回退导航成功')
                    return true
                }
            }

            case 'REWARDS_WELCOME': {
                this.bot.logger.warn(this.bot.isMobile, 'LOGIN', '检测到 Rewards 欢迎页，重新进入登录入口')
                await page
                    .goto(this.getRewardsLoginUrl(), {
                        waitUntil: 'domcontentloaded',
                        timeout: 10000
                    })
                    .catch(() => {})
                await this.waitForPageSettled(page, '重新进入 Rewards 登录入口', 2000, 400)
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '已重新进入 Rewards 登录入口')
                return true
            }

            case '2FA_TOTP': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '需要TOTP双因素认证')
                await this.totp2FALogin.handle(page, account.totpSecret)
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', 'TOTP双因素认证处理器完成')
                return true
            }

            case 'SIGN_IN_ANOTHER_WAY': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '选择"使用我的密码"')
                await this.bot.browser.utils.ghostClick(page, this.selectors.passwordIcon)
                await this.waitForPageSettled(page, '点击密码图标后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '密码选项已选择')
                return true
            }

            case 'KMSI_PROMPT': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '接受KMSI提示')
                await this.bot.browser.utils.ghostClick(page, this.selectors.primaryButton)
                await this.waitForPageSettled(page, '接受 KMSI 后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', 'KMSI提示已接受')
                return true
            }

            case 'PASSKEY_VIDEO':
            case 'PASSKEY_ERROR': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '跳过Passkey提示')
                await this.bot.browser.utils.ghostClick(page, this.selectors.secondaryButton)
                await this.waitForPageSettled(page, '跳过 Passkey 后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', 'Passkey提示已跳过')
                return true
            }

            case 'LOGIN_PASSWORDLESS': {
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '处理无密码认证')
                await this.passwordlessLogin.handle(page)
                await this.waitForPageSettled(page, '无密码认证后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '无密码认证完成')
                return true
            }

            case 'OTP_CODE_ENTRY': {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'LOGIN',
                    '检测到OTP代码输入页面，尝试查找密码选项'
                )

                // 我的修复: 点击"使用您的密码"页脚
                const footerLink = await page
                    .waitForSelector(this.selectors.viewFooter, { state: 'visible', timeout: 2000 })
                    .catch(() => null)

                if (footerLink) {
                    await this.bot.browser.utils.ghostClick(page, this.selectors.viewFooter)
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN', '页脚链接已点击')
                } else {
                    // PR 450 修复: 如果未找到页脚，则点击返回按钮
                    const backButton = await page
                        .waitForSelector(this.selectors.backButton, { state: 'visible', timeout: 2000 })
                        .catch(() => null)

                    if (backButton) {
                        await this.bot.browser.utils.ghostClick(page, this.selectors.backButton)
                        this.bot.logger.info(this.bot.isMobile, 'LOGIN', '返回按钮已点击')
                    } else {
                        this.bot.logger.warn(this.bot.isMobile, 'LOGIN', 'OTP页面上未找到导航选项')
                    }
                }

                await this.waitForPageSettled(page, 'OTP 页面导航后')
                this.bot.logger.info(this.bot.isMobile, 'LOGIN', '从OTP输入页面返回')
                return true
            }

            case 'UNKNOWN': {
                const url = new URL(page.url())
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'LOGIN',
                    `在 ${url.hostname}${url.pathname} 的未知状态，等待中`
                )
                return true
            }

            default:
                this.bot.logger.debug(this.bot.isMobile, 'HANDLE-STATE', `未处理的状态: ${state}，继续执行`)
                return true
        }
    }

    private async finalizeLogin(page: Page, email: string) {
        this.bot.logger.info(this.bot.isMobile, 'LOGIN', '完成登录')

        await page.goto(this.getRewardsDashboardUrl(), { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
        await this.waitForPageSettled(page, '登录完成后进入仪表板', 2000, 300)

        const loginRewardsSuccess = this.isAuthenticatedRewardsPage(new URL(page.url()))
        if (loginRewardsSuccess) {
            this.bot.logger.info(this.bot.isMobile, 'LOGIN', '成功登录Microsoft Rewards')
        } else {
            this.bot.logger.warn(this.bot.isMobile, 'LOGIN', '无法验证奖励仪表板，假定登录有效')
        }

        this.bot.logger.info(this.bot.isMobile, 'LOGIN', '开始Bing会话验证')
        await this.verifyBingSession(page)

        this.bot.logger.info(this.bot.isMobile, 'LOGIN', '开始奖励会话验证')
        await this.getRewardsSession(page)

        const browser = page.context()
        const cookies = await browser.cookies()
        this.bot.logger.debug(this.bot.isMobile, 'LOGIN', `检索到 ${cookies.length} 个cookie`)
        await saveSessionData(this.bot.config.sessionPath, cookies, email, this.bot.isMobile)

        this.bot.logger.info(this.bot.isMobile, 'LOGIN', '登录完成，会话已保存')
    }

    async verifyBingSession(page: Page) {
        const url =
            'https://www.bing.com/fd/auth/signin?action=interactive&provider=windows_live_id&return_url=https%3A%2F%2Fwww.bing.com%2F'
        const loopMax = 5
        let sawLoginGate = false
        let sawBingHome = false
        let lastUrl = page.url()

        this.bot.logger.info(this.bot.isMobile, 'LOGIN-BING', '验证Bing会话')

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
            await this.waitForPageSettled(page, '开始验证 Bing 会话', 2000, 250)

            for (let i = 0; i < loopMax; i++) {
                if (page.isClosed()) break

                this.bot.logger.debug(this.bot.isMobile, 'LOGIN-BING', `验证循环 ${i + 1}/${loopMax}`)

                const state = await this.detectCurrentState(page)
                lastUrl = page.url()
                if (state === 'PASSKEY_ERROR') {
                    this.bot.logger.info(this.bot.isMobile, 'LOGIN-BING', '忽略Passkey错误状态')
                    await this.bot.browser.utils.ghostClick(page, this.selectors.secondaryButton)
                }
                if (state !== 'UNKNOWN' && state !== 'LOGGED_IN') {
                    sawLoginGate = true
                }

                const u = new URL(page.url())
                const atBingHome = u.hostname === 'cn.bing.com' && u.pathname === '/'
                sawBingHome = sawBingHome || atBingHome
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'LOGIN-BING',
                    `在Bing首页: ${atBingHome} (${u.hostname}${u.pathname})`
                )

                if (atBingHome) {
                    await this.bot.browser.utils.tryDismissAllMessages(page).catch(() => {})

                    const signedIn = await page
                        .waitForSelector(this.selectors.bingProfile, { timeout: 3000 })
                        .then(() => true)
                        .catch(() => false)

                    this.bot.logger.debug(this.bot.isMobile, 'LOGIN-BING', `找到个人资料元素: ${signedIn}`)

                    if (signedIn || this.bot.isMobile) {
                        this.bot.logger.info(this.bot.isMobile, 'LOGIN-BING', 'Bing会话验证成功')
                        return
                    }
                }

                await this.bot.utils.wait(1000)
            }

            if (sawLoginGate) {
                this.bot.logger.warn(this.bot.isMobile, 'LOGIN-BING', 'Bing 会话仍停留在登录流程，继续后续步骤')
            } else if (!sawBingHome) {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'LOGIN-BING',
                    `未进入 Bing 首页，可能是网络或区域跳转问题 | 最后URL=${lastUrl}`
                )
            } else {
                this.bot.logger.warn(this.bot.isMobile, 'LOGIN-BING', '无法验证Bing会话，仍然继续')
            }
        } catch (error) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'LOGIN-BING',
                `验证错误: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async getRewardsSession(page: Page) {
        const loopMax = 5
        let sawAuthenticatedRewardPage = false
        let lastUrl = page.url()

        this.bot.logger.info(this.bot.isMobile, 'GET-REWARD-SESSION', '获取请求令牌')

        try {
            await page
                .goto(`${this.getRewardsDashboardUrl()}?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 10000 })
                .catch(() => {})
            await this.waitForPageSettled(page, '进入 Rewards 仪表板以获取令牌', 2000, 250)

            for (let i = 0; i < loopMax; i++) {
                if (page.isClosed()) break

                this.bot.logger.debug(this.bot.isMobile, 'GET-REWARD-SESSION', `令牌获取循环 ${i + 1}/${loopMax}`)

                const u = new URL(page.url())
                lastUrl = page.url()
                const atRewardHome = this.isAuthenticatedRewardsPage(u)

                if (atRewardHome) {
                    sawAuthenticatedRewardPage = true
                    await this.bot.browser.utils.tryDismissAllMessages(page)

                    const html = await page.content()
                    const $ = await this.bot.browser.utils.loadInCheerio(html)

                    // 检查当前使用的是哪个版本的仪表板，在新版仪表板上禁用 requestToken 请求
                    const isModernDashboard = $('section#dailyset').length > 0 // 仅在新版 UI 和仪表板/概览页面上存在

                    if (isModernDashboard) {
                        this.bot.rewardsVersion = 'modern'

                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'GET-REWARD-SESSION',
                            '检测到现代 Rewards 仪表板。此脚本版本可能不完全支持。'
                        )

                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'GET-REWARD-SESSION',
                            '本次会话已禁用 RequestToken（预期行为）。'
                        )

                        return
                    }

                    const token =
                        $(this.selectors.requestToken).attr('value') ??
                        $(this.selectors.requestTokenMeta).attr('content') ??
                        null

                    if (token) {
                        this.bot.requestToken = token
                        this.bot.logger.info(
                            this.bot.isMobile,
                            'GET-REWARD-SESSION',
                            `请求令牌已获取: ${token.substring(0, 10)}...`
                        )
                        return
                    }

                    this.bot.logger.debug(this.bot.isMobile, 'GET-REWARD-SESSION', '页面上未找到令牌')
                } else {
                    this.bot.logger.debug(
                        this.bot.isMobile,
                        'GET-REWARD-SESSION',
                        `不在奖励首页: ${u.hostname}${u.pathname}`
                    )
                }

                await this.bot.utils.wait(1000)
            }

            this.bot.logger.warn(
                this.bot.isMobile,
                'GET-REWARD-SESSION',
                sawAuthenticatedRewardPage
                    ? `已进入奖励页但未找到 RequestVerificationToken，可能是页面变体或短时加载问题 | 最后URL=${lastUrl}`
                    : `未进入已登录的奖励页，可能是会话未完全建立 | 最后URL=${lastUrl}`
            )
        } catch (error) {
            const message = `致命错误: ${error instanceof Error ? error.message : String(error)}`
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-REWARD-SESSION',
                message
            )
            throw new Error(message)
        }
    }

    async getAppAccessToken(page: Page, email: string) {
        this.bot.logger.info(this.bot.isMobile, 'GET-APP-TOKEN', '请求移动访问令牌')
        return await new MobileAccessLogin(this.bot, page).get(email)
    }
}
