import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { isTermuxRuntime, resolveBrowserExecutablePath } from '../runtimePlatform.js'
import { loadEnvFile } from '../utils.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..', '..')
loadEnvFile(projectRoot)

if (isTermuxRuntime) {
    const executablePath = resolveBrowserExecutablePath(true)
    if (!executablePath) {
        console.error(
            '[browser] Termux Chromium not found. Install it with: pkg install x11-repo tur-repo && pkg install chromium-beta'
        )
        process.exit(1)
    }

    console.log(`[browser] Using Termux system Chromium: ${executablePath}`)
    process.exit(0)
}

const cli = path.resolve(here, '..', '..', 'node_modules', 'patchright', 'cli.js')
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', env: process.env })

if (result.error) {
    console.error(`[browser] Failed to start Patchright installer: ${result.error.message}`)
    process.exit(1)
}

process.exit(result.status ?? 1)
