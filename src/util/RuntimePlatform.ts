import fs from 'node:fs'
import path from 'node:path'

const originalPlatform = process.platform
const termuxPrefix = process.env.PREFIX ?? ''

export const nativePlatform = originalPlatform
export const isAndroidRuntime = originalPlatform === 'android'
export const isTermuxRuntime = isAndroidRuntime || termuxPrefix.includes('/com.termux/')

export function isTermuxPlatform(platform: string, prefix = termuxPrefix): boolean {
    return platform === 'android' || prefix.includes('/com.termux/')
}

export function preparePatchrightPlatform(): void {
    if (!isAndroidRuntime || process.platform === 'linux') return

    try {
        Object.defineProperty(process, 'platform', {
            configurable: true,
            value: 'linux'
        })
    } catch (error) {
        throw new Error(
            `Patchright cannot run on Android because Node.js platform normalization failed: ${
                error instanceof Error ? error.message : String(error)
            }`
        )
    }
}

export function getEffectiveHeadless(
    requested: boolean,
    termux = isTermuxRuntime,
    hasDisplay = hasDisplayServer()
): boolean {
    return requested || (termux && !hasDisplay)
}

export function hasDisplayServer(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
}

export function termuxBrowserCandidates(prefix = termuxPrefix, headless = true): string[] {
    const names = headless
        ? [
              ['opt', 'chromium-beta', 'headless_shell'],
              ['opt', 'chromium', 'headless_shell'],
              ['opt', 'chromium-beta', 'chrome'],
              ['opt', 'chromium', 'chrome'],
              ['bin', 'chromium-beta'],
              ['bin', 'chromium']
          ]
        : [
              ['opt', 'chromium-beta', 'chrome'],
              ['opt', 'chromium', 'chrome'],
              ['opt', 'chromium-beta', 'headless_shell'],
              ['opt', 'chromium', 'headless_shell'],
              ['bin', 'chromium-beta'],
              ['bin', 'chromium']
          ]

    return names.map(parts => path.join(prefix, ...parts))
}

function existingFile(candidate: string): string | undefined {
    try {
        return fs.statSync(candidate).isFile() ? candidate : undefined
    } catch {
        return undefined
    }
}

export function resolveBrowserExecutablePath(headless: boolean): string | undefined {
    const configured = [
        process.env.BROWSER_EXECUTABLE_PATH,
        process.env.CHROMIUM_EXECUTABLE_PATH,
        process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ].find(value => value?.trim())

    if (configured) {
        const resolved = path.resolve(configured.trim())
        if (!existingFile(resolved)) {
            throw new Error(`Configured browser executable does not exist or is not a file: ${resolved}`)
        }
        return resolved
    }

    if (!isTermuxRuntime) return undefined

    const prefix = process.env.PREFIX || '/data/data/com.termux/files/usr'
    return termuxBrowserCandidates(prefix, headless).map(existingFile).find(Boolean)
}

export function requireTermuxBrowserExecutable(headless: boolean): string | undefined {
    const executablePath = resolveBrowserExecutablePath(headless)
    if (isTermuxRuntime && !executablePath) {
        throw new Error(
            'No Termux Chromium executable was found. Install chromium-beta (recommended) or chromium, or set BROWSER_EXECUTABLE_PATH.'
        )
    }
    return executablePath
}
