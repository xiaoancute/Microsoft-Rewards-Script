import test from 'node:test'
import assert from 'node:assert/strict'

async function loadDetector() {
    const mod = await import('../../dist/browser/RiskControlDetector.js')
    return {
        detectRiskControlPrompt: mod.detectRiskControlPrompt,
        RiskControlDetectedError: mod.RiskControlDetectedError
    }
}

function createPage({ content = '', visibleSelectors = {} } = {}) {
    return {
        async content() {
            return content
        },
        locator(selector) {
            return {
                async count() {
                    return visibleSelectors[selector] ? 1 : 0
                }
            }
        }
    }
}

test('detectRiskControlPrompt matches explicit selectors before scanning page text', async () => {
    const { detectRiskControlPrompt } = await loadDetector()
    const page = createPage({
        content: '<html><body><h1>normal page</h1></body></html>',
        visibleSelectors: { '#suspendedAccountHeader': true }
    })

    const hit = await detectRiskControlPrompt(page, {
        accountEmail: 'risk@example.com',
        stage: 'dashboard-after-login'
    })

    assert.equal(hit?.matchedSelector, '#suspendedAccountHeader')
    assert.match(hit?.message ?? '', /risk@example.com/)
})

test('detectRiskControlPrompt matches high-confidence text fallbacks', async () => {
    const { detectRiskControlPrompt } = await loadDetector()
    const page = createPage({
        content:
            '<html><body>Your Microsoft Rewards searches are temporarily limited because of unusual activity.</body></html>'
    })

    const hit = await detectRiskControlPrompt(page, {
        accountEmail: 'risk@example.com',
        stage: 'search-after-run'
    })

    assert.equal(hit?.matchedSelector ?? null, null)
    assert.match(hit?.matchedText ?? '', /unusual activity/i)
})

test('detectRiskControlPrompt ignores ordinary rewards pages', async () => {
    const { detectRiskControlPrompt } = await loadDetector()
    const page = createPage({
        content: '<html><body>Daily set complete. Keep searching with Bing.</body></html>'
    })

    const hit = await detectRiskControlPrompt(page, {
        accountEmail: 'ok@example.com',
        stage: 'dashboard-after-login'
    })

    assert.equal(hit, null)
})

test('detectRiskControlPrompt matches Chinese fallback text used on warning pages', async () => {
    const { detectRiskControlPrompt } = await loadDetector()
    const page = createPage({
        content: '<html><body>由于异常行为，你的搜索积分目前受限。</body></html>'
    })

    const hit = await detectRiskControlPrompt(page, {
        accountEmail: 'risk@example.com',
        stage: 'search-after-run'
    })

    assert.match(hit?.matchedText ?? '', /异常行为|受限/)
})
