import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function loadLogger() {
    const mod = await import('../../dist/logging/Logger.js')
    return mod.Logger
}

function createBot() {
    return {
        userData: {
            userName: 'logger-test'
        },
        config: {
            debugLogs: true,
            errorDiagnostics: false,
            consoleLogFilter: {
                enabled: true,
                mode: 'blacklist',
                levels: ['info'],
                keywords: [],
                regexPatterns: []
            },
            webhook: {
                webhookLogFilter: {
                    enabled: false
                },
                discord: { enabled: false, url: '' },
                ntfy: { enabled: false, url: '' },
                pushplus: { enabled: false, token: '' }
            }
        },
        isMobile: true
    }
}

test('Logger redacts OAuth codes, tokens, and cookies before writing local logs', async () => {
    const Logger = await loadLogger()
    const originalCwd = process.cwd()
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-logger-redaction-'))

    try {
        process.chdir(projectRoot)
        const logger = new Logger(createBot())
        const secretCode = 'M.C517_SECRET_CODE_VALUE'
        const accessToken = 'ACCESS_TOKEN_VALUE'
        const refreshToken = 'REFRESH_TOKEN_VALUE'
        const cookieValue = 'MUID=abc123; MSCC=secret-cookie'

        logger.info(
            true,
            'LOGIN-APP',
            `OAuth URL https://login.live.com/oauth20_desktop.srf?code=${secretCode}&state=abc&access_token=${accessToken} refresh_token=${refreshToken} Cookie: ${cookieValue}`
        )

        const logFile = path.join(projectRoot, 'logs', `${new Date().toISOString().split('T')[0]}.log`)
        const content = await fs.readFile(logFile, 'utf8')

        assert.equal(content.includes(secretCode), false)
        assert.equal(content.includes(accessToken), false)
        assert.equal(content.includes(refreshToken), false)
        assert.equal(content.includes(cookieValue), false)
        assert.match(content, /code=\[REDACTED\]/)
        assert.match(content, /access_token=\[REDACTED\]/)
        assert.match(content, /refresh_token=\[REDACTED\]/)
        assert.match(content, /Cookie: \[REDACTED\]/)
    } finally {
        process.chdir(originalCwd)
    }
})
