import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildPreflightReport } from '../../scripts/webui/preflight.js'

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-preflight-'))
}

async function writeJson(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(data, null, 4), 'utf8')
}

function config(overrides = {}) {
    return {
        baseURL: 'https://rewards.bing.com',
        sessionPath: 'sessions',
        headless: true,
        clusters: 1,
        workers: { doDailySet: true },
        searchSettings: { queryEngines: ['local'] },
        ...overrides
    }
}

function account(email, overrides = {}) {
    return {
        email,
        password: 'secret',
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

test('buildPreflightReport marks a configured local project ready', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'dist'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'logs'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'reports'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'dist', 'index.js'), '// built')
    await writeJson(path.join(projectRoot, 'config', 'config.json'), config())
    await writeJson(path.join(projectRoot, 'config', 'accounts.json'), [account('ready@example.com')])
    await writeJson(path.join(projectRoot, 'sessions', 'ready@example.com', 'session_mobile.json'), [{ name: 'MUID' }])

    const report = buildPreflightReport(projectRoot, {
        runtime: { isDocker: false, mode: 'local' },
        capabilities: { canOpenBrowserSession: true },
        externalRun: { active: false }
    })

    assert.equal(report.summary.status, 'ready')
    assert.equal(report.summary.canRun, true)
    assert.equal(report.checks.find(item => item.id === 'sessions')?.status, 'ok')
})

test('buildPreflightReport blocks Docker runs when a configured account has no session', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'dist'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'dist', 'index.js'), '// built')
    await writeJson(path.join(projectRoot, 'config', 'config.json'), config())
    await writeJson(path.join(projectRoot, 'config', 'accounts.json'), [account('docker@example.com')])

    const report = buildPreflightReport(projectRoot, {
        runtime: { isDocker: true, mode: 'docker' },
        capabilities: { canOpenBrowserSession: false },
        externalRun: { active: false }
    })

    const sessionCheck = report.checks.find(item => item.id === 'sessions')
    assert.equal(report.summary.status, 'blocked')
    assert.equal(report.summary.canRun, false)
    assert.equal(sessionCheck?.status, 'fail')
    assert.match(sessionCheck?.detail || '', /docker@example\.com/)
})

test('buildPreflightReport reports missing runtime files and active Docker lock', async () => {
    const projectRoot = await makeProjectRoot()
    await writeJson(path.join(projectRoot, 'config', 'config.json'), config({ clusters: 2 }))
    await writeJson(path.join(projectRoot, 'config', 'accounts.json'), [
        account('first@example.com'),
        account('second@example.com')
    ])

    const report = buildPreflightReport(projectRoot, {
        runtime: { isDocker: true, mode: 'docker' },
        capabilities: { canOpenBrowserSession: false },
        externalRun: { active: true, pid: 123 }
    })

    assert.equal(report.summary.status, 'blocked')
    assert.equal(report.checks.find(item => item.id === 'dist')?.status, 'fail')
    assert.equal(report.checks.find(item => item.id === 'external-run')?.status, 'fail')
    assert.equal(report.checks.find(item => item.id === 'proxy-spread')?.status, 'warn')
})
