import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { startWebUiServer } from '../../scripts/webui/server.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')

async function getFreePort() {
    return await new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            const port = typeof address === 'object' && address ? address.port : 0
            server.close(error => {
                if (error) reject(error)
                else resolve(port)
            })
        })
    })
}

async function startServer(envOverrides = {}) {
    const port = await getFreePort()
    const child = spawn(
        process.execPath,
        ['scripts/webui/server.js', '--host', '127.0.0.1', '--port', String(port)],
        {
            cwd: projectRoot,
            env: {
                ...process.env,
                MRS_RUNTIME_MODE: 'docker',
                WEBUI_ENABLED: 'true',
                WEBUI_TOKEN: 'secret-token',
                CRON_SCHEDULE: '0 7 * * *',
                RUN_ON_START: 'true',
                ...envOverrides
            },
            stdio: ['ignore', 'pipe', 'pipe']
        }
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', chunk => {
        stderr += chunk.toString('utf8')
    })

    const baseUrl = `http://127.0.0.1:${port}`
    const startedAt = Date.now()

    while (Date.now() - startedAt < 10000) {
        if (child.exitCode !== null) {
            throw new Error(`server exited early: ${stdout}\n${stderr}`)
        }
        try {
            const res = await fetch(`${baseUrl}/`)
            if (res.status > 0) {
                await res.arrayBuffer()
                return { child, baseUrl, stdout, stderr }
            }
        } catch {}
        await sleep(100)
    }

    child.kill('SIGTERM')
    throw new Error(`server did not start in time: ${stdout}\n${stderr}`)
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        sleep(3000)
    ])
    if (child.exitCode === null) {
        child.kill('SIGKILL')
        await new Promise(resolve => child.once('exit', resolve))
    }
}

async function stopHttpServer(server) {
    if (!server?.listening) return
    await new Promise((resolve, reject) => {
        server.close(error => {
            if (error) reject(error)
            else resolve()
        })
    })
}

function createRunnerStub() {
    const calls = []
    return {
        calls,
        snapshot() {
            return []
        },
        startDockerDailyRun() {
            calls.push('startDockerDailyRun')
            return { id: 41 }
        },
        startStart() {
            calls.push('startStart')
            return { id: 42 }
        },
        startBuild() {
            calls.push('startBuild')
            return { id: 43 }
        },
        openBrowserSession() {
            calls.push('openBrowserSession')
            return { id: 44 }
        },
        getLogs() {
            return []
        },
        on() {},
        off() {}
    }
}

test('docker webui keeps static files public while API stays token-protected', async t => {
    const server = await startServer()
    t.after(() => stopServer(server.child))

    const page = await fetch(`${server.baseUrl}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /Microsoft Rewards 管理页/)

    const unauthorized = await fetch(`${server.baseUrl}/api/status`)
    assert.equal(unauthorized.status, 401)

    const authed = await fetch(`${server.baseUrl}/api/status`, {
        headers: { Authorization: 'Bearer secret-token' }
    })
    assert.equal(authed.status, 200)
    const payload = await authed.json()
    assert.equal(payload.runtime?.mode, 'docker')
    assert.equal(payload.capabilities?.canOpenBrowserSession, false)
    assert.equal(payload.capabilities?.canBuildProject, false)
})

test('webui server starts without module type warnings', async t => {
    const server = await startServer()
    t.after(() => stopServer(server.child))

    assert.equal(server.stderr.includes('MODULE_TYPELESS_PACKAGE_JSON'), false, server.stderr)
    assert.equal(server.stderr.includes('Reparsing as ES module'), false, server.stderr)
})

test('docker webui exposes a docker cron schedule payload instead of systemd state', async t => {
    const server = await startServer()
    t.after(() => stopServer(server.child))

    const response = await fetch(`${server.baseUrl}/api/systemd`, {
        headers: { Authorization: 'Bearer secret-token' }
    })
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.mode, 'docker')
    assert.equal(payload.reward?.kind, 'docker-cron')
    assert.equal(payload.reward?.onCalendar, '0 7 * * *')
    assert.equal(payload.reward?.runOnStart, true)
})

test('docker run control uses run_daily wrapper and blocks build/browser-session routes', async t => {
    const runner = createRunnerStub()
    const webui = await startWebUiServer({
        projectRoot,
        host: '127.0.0.1',
        port: 0,
        token: 'secret-token',
        env: {
            ...process.env,
            MRS_RUNTIME_MODE: 'docker',
            WEBUI_ENABLED: 'true',
            WEBUI_TOKEN: 'secret-token',
            CRON_SCHEDULE: '0 7 * * *',
            RUN_ON_START: 'true'
        },
        runner
    })
    t.after(() => stopHttpServer(webui.server))

    const port = webui.server.address().port
    const baseUrl = `http://127.0.0.1:${port}`
    const headers = { Authorization: 'Bearer secret-token' }

    const runResponse = await fetch(`${baseUrl}/api/run/start`, {
        method: 'POST',
        headers
    })
    assert.equal(runResponse.status, 201)
    assert.deepEqual(runner.calls, ['startDockerDailyRun'])

    const buildResponse = await fetch(`${baseUrl}/api/build`, {
        method: 'POST',
        headers
    })
    assert.equal(buildResponse.status, 400)
    assert.equal(runner.calls.includes('startBuild'), false)

    const openResponse = await fetch(`${baseUrl}/api/sessions/docker@example.com/open`, {
        method: 'POST',
        headers
    })
    assert.equal(openResponse.status, 400)
    assert.equal(runner.calls.includes('openBrowserSession'), false)
})

test('local webui keeps /api/run/start bound to the regular start runner', async t => {
    const runner = createRunnerStub()
    const webui = await startWebUiServer({
        projectRoot,
        host: '127.0.0.1',
        port: 0,
        token: '',
        env: {
            ...process.env,
            MRS_RUNTIME_MODE: 'local',
            WEBUI_ENABLED: 'false',
            WEBUI_TOKEN: ''
        },
        runner
    })
    t.after(() => stopHttpServer(webui.server))

    const port = webui.server.address().port
    const baseUrl = `http://127.0.0.1:${port}`

    const response = await fetch(`${baseUrl}/api/run/start`, { method: 'POST' })
    assert.equal(response.status, 201)
    assert.deepEqual(runner.calls, ['startStart'])
})
