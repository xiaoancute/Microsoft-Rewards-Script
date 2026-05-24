import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getStatus } from '../../scripts/webui/api.js'
import { diagnoseEnvironment } from '../../scripts/webui/env.js'

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-webui-'))
}

function minimalConfig(baseURL, sessionPath = 'sessions') {
    return {
        baseURL,
        sessionPath,
        headless: false,
        workers: {
            doDailySet: true
        }
    }
}

test('getStatus does not treat example files as configured runtime files', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })

    await fs.writeFile(path.join(projectRoot, 'src', 'config.example.json'), JSON.stringify(minimalConfig('example-config')))
    await fs.writeFile(path.join(projectRoot, 'src', 'accounts.example.json'), JSON.stringify([{ email: 'example@example.com' }]))

    const status = getStatus(projectRoot, { snapshot() { return [] } })

    assert.equal(status.configExists, false)
    assert.equal(status.accountsExists, false)
    assert.equal(status.configPath, null)
    assert.equal(status.accountsPath, null)
})

test('diagnoseEnvironment uses legacy config path when deriving session directory', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'custom-sessions', 'legacy@example.com'), { recursive: true })

    await fs.writeFile(path.join(projectRoot, 'src', 'config.json'), JSON.stringify(minimalConfig('legacy-config', 'custom-sessions')))
    await fs.writeFile(path.join(projectRoot, 'src', 'accounts.json'), JSON.stringify([{ email: 'legacy@example.com' }]))
    await fs.writeFile(path.join(projectRoot, 'custom-sessions', 'legacy@example.com', 'session_mobile.json'), '[]')

    const checks = diagnoseEnvironment(projectRoot).checks
    const sessionsCheck = checks.find(item => item.name === 'Sessions 目录')

    assert.equal(sessionsCheck?.ok, true)
    assert.match(sessionsCheck?.value || '', /^1 个账号/)
})

test('getStatus reports docker runtime capabilities and external run state', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'config'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'dist'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })

    await fs.writeFile(path.join(projectRoot, 'dist', 'index.js'), '// built')
    await fs.writeFile(path.join(projectRoot, 'config', 'config.json'), JSON.stringify(minimalConfig('docker-config')))
    await fs.writeFile(path.join(projectRoot, 'config', 'accounts.json'), JSON.stringify([{ email: 'docker@example.com' }]))
    await fs.writeFile(path.join(projectRoot, 'src', 'config.example.json'), JSON.stringify(minimalConfig('docker-config')))
    await fs.writeFile(path.join(projectRoot, 'src', 'accounts.example.json'), JSON.stringify([{ email: 'docker@example.com' }]))

    const originalEnv = {
        MRS_RUNTIME_MODE: process.env.MRS_RUNTIME_MODE,
        WEBUI_ENABLED: process.env.WEBUI_ENABLED
    }

    process.env.MRS_RUNTIME_MODE = 'docker'
    process.env.WEBUI_ENABLED = 'true'

    try {
        const status = getStatus(projectRoot, { snapshot() { return [] } })

        assert.equal(status.runtime?.mode, 'docker')
        assert.equal(status.runtime?.isDocker, true)
        assert.equal(status.runtime?.webuiEnabled, true)
        assert.equal(status.capabilities?.canOpenBrowserSession, false)
        assert.equal(status.capabilities?.canManageSystemd, false)
        assert.equal(status.capabilities?.canBuildProject, false)
        assert.equal(status.capabilities?.canRunNow, true)
        assert.equal(status.capabilities?.canViewReports, true)
        assert.equal(status.capabilities?.canViewLogHistory, true)
        assert.equal(status.externalRun?.active, false)
    } finally {
        if (originalEnv.MRS_RUNTIME_MODE === undefined) delete process.env.MRS_RUNTIME_MODE
        else process.env.MRS_RUNTIME_MODE = originalEnv.MRS_RUNTIME_MODE
        if (originalEnv.WEBUI_ENABLED === undefined) delete process.env.WEBUI_ENABLED
        else process.env.WEBUI_ENABLED = originalEnv.WEBUI_ENABLED
    }
})

test('getStatus reports local run lock as an external run', async () => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'config'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'reports'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'config', 'config.json'), JSON.stringify(minimalConfig('local-config')))
    await fs.writeFile(path.join(projectRoot, 'config', 'accounts.json'), JSON.stringify([{ email: 'local@example.com' }]))
    await fs.writeFile(
        path.join(projectRoot, 'reports', 'run.lock'),
        JSON.stringify({ pid: process.pid, startedAt: '2026-04-24T01:00:00.000Z' }) + '\n'
    )

    const status = getStatus(projectRoot, { snapshot() { return [] } }, {
        env: { MRS_RUNTIME_MODE: 'local' },
        externalRunOptions: {
            signalCheck(pid) {
                return pid === process.pid
            }
        }
    })

    assert.equal(status.externalRun?.active, true)
    assert.equal(status.externalRun?.source, 'local-run-lock')
    assert.equal(status.externalRun?.pid, process.pid)
})

test('webui config defaults account auto-skip to opt-in', async () => {
    const appJs = await fs.readFile(path.join(process.cwd(), 'scripts', 'webui', 'public', 'app.js'), 'utf8')
    const exampleConfig = JSON.parse(await fs.readFile(path.join(process.cwd(), 'src', 'config.example.json'), 'utf8'))

    assert.match(appJs, /cfg\.accountHealth\?\.autoSkip\?\.enabled \?\? false/)
    assert.equal(exampleConfig.accountHealth?.autoSkip?.enabled, false)
})

test('webui keeps rebuild out of daily run and config controls', async () => {
    const html = await fs.readFile(path.join(process.cwd(), 'scripts', 'webui', 'public', 'index.html'), 'utf8')
    const appJs = await fs.readFile(path.join(process.cwd(), 'scripts', 'webui', 'public', 'app.js'), 'utf8')

    assert.doesNotMatch(html, /id="btn-run-build"/)
    assert.doesNotMatch(html, /id="btn-build-from-config"/)
    assert.doesNotMatch(appJs, /document\.getElementById\('btn-run-build'\)/)
    assert.doesNotMatch(appJs, /btn-build-from-config/)
    assert.match(appJs, /'build': '编译 TypeScript 到 dist\/，只有代码改动后才需要跑。'/)
})
