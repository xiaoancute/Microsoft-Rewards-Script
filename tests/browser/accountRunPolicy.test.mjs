import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const { appendEarningsRun, readEarningsReport, writeEarningsCheckpoint } = await import('../../earnings-report.cjs')

async function loadPolicy() {
    return await import('../../dist/accounts/AccountRunPolicy.js')
}

async function loadBotModule() {
    return await import('../../dist/index.js')
}

function account(email, overrides = {}) {
    return {
        email,
        password: '',
        recoveryEmail: '',
        geoLocale: 'auto',
        langCode: 'zh',
        proxy: {
            proxyAxios: false,
            url: '',
            port: 0,
            username: '',
            password: ''
        },
        saveFingerprint: {
            mobile: true,
            desktop: true
        },
        ...overrides
    }
}

test('selectRunnableAccounts skips accounts explicitly disabled in accounts.json', async () => {
    const { selectRunnableAccounts } = await loadPolicy()
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-account-policy-'))

    const result = selectRunnableAccounts({
        projectRoot,
        accounts: [
            account('enabled@example.com'),
            account('disabled@example.com', { enabled: false })
        ],
        config: {}
    })

    assert.deepEqual(result.runnable.map(item => item.email), ['enabled@example.com'])
    assert.deepEqual(result.skipped.map(item => [item.email, item.reason]), [
        ['disabled@example.com', 'disabled']
    ])
})

test('selectRunnableAccounts auto-skips recent risk-control accounts during cooldown', async () => {
    const { selectRunnableAccounts } = await loadPolicy()
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-account-policy-'))

    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T01:00:00.000Z',
        runFinishedAt: '2026-04-24T01:04:00.000Z',
        accountStats: [
            {
                email: 'risk@example.com',
                collectedPoints: 0,
                duration: 10,
                success: false,
                error: '风控暂停',
                riskControlStopped: true
            }
        ]
    })

    const result = selectRunnableAccounts({
        projectRoot,
        accounts: [account('risk@example.com'), account('ok@example.com')],
        config: {
            accountHealth: {
                autoSkip: {
                    enabled: true,
                    riskCooldownHours: 24,
                    maxConsecutiveFailures: 3
                }
            }
        },
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.deepEqual(result.runnable.map(item => item.email), ['ok@example.com'])
    assert.equal(result.skipped[0].email, 'risk@example.com')
    assert.equal(result.skipped[0].reason, 'risk-cooldown')
})

test('selectRunnableAccounts respects disabled auto-skip config', async () => {
    const { selectRunnableAccounts } = await loadPolicy()
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-account-policy-'))

    await appendEarningsRun(projectRoot, {
        runStartedAt: '2026-04-24T01:00:00.000Z',
        runFinishedAt: '2026-04-24T01:04:00.000Z',
        accountStats: [
            {
                email: 'risk@example.com',
                collectedPoints: 0,
                duration: 10,
                success: false,
                error: '风控暂停',
                riskControlStopped: true
            }
        ]
    })

    const result = selectRunnableAccounts({
        projectRoot,
        accounts: [account('risk@example.com')],
        config: {
            accountHealth: {
                autoSkip: {
                    enabled: false
                }
            }
        },
        now: '2026-04-24T12:00:00.000Z'
    })

    assert.deepEqual(result.runnable.map(item => item.email), ['risk@example.com'])
    assert.deepEqual(result.skipped, [])
})

test('MicrosoftRewardsBot.run recovers interrupted earnings before account auto-skip selection', async () => {
    const { MicrosoftRewardsBot } = await loadBotModule()
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-run-policy-pending-'))
    const now = Date.now()

    await writeEarningsCheckpoint(projectRoot, {
        runId: 'pending-risk-run',
        runStartedAt: now - 60_000,
        updatedAt: now,
        accountStats: [
            {
                email: 'risk@example.com',
                collectedPoints: 0,
                duration: 10,
                success: false,
                error: '风控暂停',
                riskControlStopped: true
            }
        ],
        hadWorkerFailure: true,
        riskControlStopped: true,
        reason: 'risk-control'
    })

    const bot = Object.create(MicrosoftRewardsBot.prototype)
    bot.projectRoot = projectRoot
    bot.accounts = [account('risk@example.com')]
    bot.config = {
        clusters: 1,
        accountHealth: {
            autoSkip: {
                enabled: true,
                riskCooldownHours: 24,
                maxConsecutiveFailures: 3
            }
        }
    }
    bot.logger = { info() {}, debug() {}, error() {}, alert() {}, warn() {} }
    bot.runTasks = async accounts => {
        throw new Error(`runTasks should not receive skipped accounts: ${accounts.map(item => item.email).join(',')}`)
    }

    await bot.run()

    const report = readEarningsReport(projectRoot, { range: '7d', now })
    assert.equal(report.accounts.find(item => item.email === 'risk@example.com')?.lastStatus, 'risk_control')
})
