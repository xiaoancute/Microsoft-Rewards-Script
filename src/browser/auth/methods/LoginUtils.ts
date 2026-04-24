import type { Page } from 'patchright'
import readline from 'readline'

interface LoginHelperBot {
    isMobile: boolean
    logger: {
        debug(isMobile: boolean, title: string, message: string): void
    }
    utils: {
        wait(time: number | string): Promise<void>
    }
}

export interface PromptOptions {
    question: string
    timeoutSeconds?: number
    validate?: (input: string) => boolean
    transform?: (input: string) => string
}

export function promptInput(options: PromptOptions): Promise<string | null> {
    const { question, timeoutSeconds = 60, validate, transform } = options

    return new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })

        let resolved = false

        const cleanup = (result: string | null) => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            rl.close()
            resolve(result)
        }

        const timer = setTimeout(() => cleanup(null), timeoutSeconds * 1000)

        rl.question(question, answer => {
            let value = answer.trim()
            if (transform) value = transform(value)

            if (validate && !validate(value)) {
                cleanup(null)
                return
            }

            cleanup(value)
        })
    })
}

export async function getSubtitleMessage(page: Page): Promise<string | null> {
    const message = await page
        .waitForSelector('[data-testid="subtitle"], div#oneTimeCodeDescription', { state: 'visible', timeout: 1000 })
        .catch(() => null)

    if (!message) return null

    const text = await message.innerText()
    return text.trim()
}

export async function getErrorMessage(page: Page): Promise<string | null> {
    const errorAlert = await page
        .waitForSelector('div[role="alert"]', { state: 'visible', timeout: 1000 })
        .catch(() => null)

    if (!errorAlert) return null

    const text = await errorAlert.innerText()
    return text.trim()
}

export async function waitForLoginPageSettled(
    page: Page,
    options: {
        bot: LoginHelperBot
        context: string
        tag: string
        timeoutMs?: number
        pauseMs?: number
    }
): Promise<void> {
    const { bot, context, tag, timeoutMs = 1500, pauseMs = 250 } = options

    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {
        bot.logger.debug(bot.isMobile, tag, `${context} DOMContentLoaded 超时`)
    })

    if (pauseMs > 0) {
        await bot.utils.wait(pauseMs)
    }
}

export async function isAnySelectorVisible(page: Page, selectors: string[], timeoutMs = 200): Promise<boolean> {
    for (const selector of selectors) {
        const found = await page
            .waitForSelector(selector, { state: 'visible', timeout: timeoutMs })
            .then(() => true)
            .catch(() => false)

        if (found) return true
    }

    return false
}

export async function clearTextInputForRetry(
    page: Page,
    selector: string,
    isMobile: boolean
): Promise<boolean> {
    const inputToClear = await page.$(selector).catch(() => null)
    if (!inputToClear) return false

    await inputToClear.click().catch(() => {})

    const selectAllShortcuts = isMobile ? ['Meta+A', 'Control+A'] : ['Control+A', 'Meta+A']
    for (const shortcut of selectAllShortcuts) {
        try {
            await page.keyboard.press(shortcut)
            break
        } catch {
            continue
        }
    }

    await page.keyboard.press('Backspace').catch(() => {})
    return true
}

export async function waitForLoginAdvance(
    page: Page,
    options: {
        bot: LoginHelperBot
        context: string
        tag: string
        inputSelectors: string[]
        successSelectors?: string[]
        timeoutMs?: number
        pollMs?: number
    }
): Promise<{ errorMessage: null | string; status: 'advanced' | 'error' | 'stalled' }> {
    const { bot, context, tag, inputSelectors, successSelectors = [], timeoutMs = 2500, pollMs = 150 } = options
    const start = Date.now()
    const initialUrl = page.url()

    await waitForLoginPageSettled(page, {
        bot,
        context,
        tag,
        timeoutMs: Math.min(timeoutMs, 1200),
        pauseMs: 150
    })

    while (Date.now() - start < timeoutMs) {
        const errorMessage = await getErrorMessage(page)
        if (errorMessage) {
            return { status: 'error', errorMessage }
        }

        if (successSelectors.length > 0 && (await isAnySelectorVisible(page, successSelectors, 150))) {
            return { status: 'advanced', errorMessage: null }
        }

        if (page.url() !== initialUrl) {
            return { status: 'advanced', errorMessage: null }
        }

        if (!(await isAnySelectorVisible(page, inputSelectors, 150))) {
            return { status: 'advanced', errorMessage: null }
        }

        await bot.utils.wait(pollMs)
    }

    const errorMessage = await getErrorMessage(page)
    if (errorMessage) {
        return { status: 'error', errorMessage }
    }

    return { status: 'stalled', errorMessage: null }
}
