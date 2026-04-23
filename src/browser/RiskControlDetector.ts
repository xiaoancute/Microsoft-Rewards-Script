import type { Page } from 'patchright'
import { RISK_CONTROL_SELECTORS, RISK_CONTROL_TEXT_PATTERNS } from '../constants'

export interface RiskControlDetection {
    accountEmail: string
    stage: string
    matchedSelector: null | string
    matchedText: null | string
    message: string
}

export class RiskControlDetectedError extends Error {
    public readonly detection: RiskControlDetection

    constructor(detection: RiskControlDetection) {
        super(detection.message)
        this.name = 'RiskControlDetectedError'
        this.detection = detection
    }
}

function extractVisibleText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export async function detectRiskControlPrompt(
    page: Page,
    input: { accountEmail: string; stage: string }
): Promise<null | RiskControlDetection> {
    for (const selector of RISK_CONTROL_SELECTORS) {
        const matched = await page
            .locator(selector)
            .count()
            .then(count => count > 0)
            .catch(() => false)

        if (matched) {
            return {
                accountEmail: input.accountEmail,
                stage: input.stage,
                matchedSelector: selector,
                matchedText: null,
                message: `${input.accountEmail} 在阶段 ${input.stage} 命中风控提示选择器 ${selector}，已停止运行`
            }
        }
    }

    const html = await page.content().catch(() => '')
    const normalized = extractVisibleText(html).toLowerCase()

    for (const pattern of RISK_CONTROL_TEXT_PATTERNS) {
        if (!normalized.includes(pattern.toLowerCase())) continue

        return {
            accountEmail: input.accountEmail,
            stage: input.stage,
            matchedSelector: null,
            matchedText: pattern,
            message: `${input.accountEmail} 在阶段 ${input.stage} 命中风控提示文案 "${pattern}"，已停止运行`
        }
    }

    return null
}
