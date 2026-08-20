import { newInjectedContext } from 'fingerprint-injector'
import { FingerprintGenerator } from 'fingerprint-generator'
import { getDirname, getProjectRoot, loadEnvFile } from '../utils.js'

import {
    getEffectiveHeadless,
    isTermuxRuntime,
    nativePlatform,
    preparePatchrightPlatform,
    requireTermuxBrowserExecutable
} from '../runtimePlatform.js'

loadEnvFile(getProjectRoot(getDirname(import.meta.url)))
preparePatchrightPlatform()
const { chromium } = await import('patchright')

const headless = getEffectiveHeadless(true)
const executablePath = requireTermuxBrowserExecutable(headless)
const sandboxArgs =
    isTermuxRuntime || (typeof process.getuid === 'function' && process.getuid() === 0)
        ? ['--no-sandbox', '--disable-setuid-sandbox']
        : []

const browser = await chromium.launch({
    headless,
    ...(executablePath && { executablePath }),
    args: ['--disable-dev-shm-usage', '--disable-gpu', ...sandboxArgs]
})

try {
    const fingerprint = new FingerprintGenerator().getFingerprint({
        devices: ['desktop'],
        operatingSystems: ['linux'],
        browsers: [{ name: 'edge' }],
        locales: ['en-US']
    })
    const context = await newInjectedContext(browser, { fingerprint })
    const page = await context.newPage()
    await page.setContent('<title>microsoft-rewards-smoke</title><main>browser-ok</main>')

    const result = {
        platform: `${nativePlatform}/${process.platform}`,
        browser: browser.version(),
        executablePath: executablePath ?? 'patchright-bundled',
        headless,
        title: await page.title(),
        text: await page.textContent('main')
    }

    if (result.title !== 'microsoft-rewards-smoke' || result.text !== 'browser-ok') {
        throw new Error(`Browser smoke assertion failed: ${JSON.stringify(result)}`)
    }

    console.log(JSON.stringify(result))
    await context.close()
} finally {
    await browser.close()
}
