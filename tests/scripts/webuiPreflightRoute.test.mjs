import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { startWebUiServer } from '../../scripts/webui/server.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sourceRoot = path.resolve(__dirname, '..', '..')

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-webui-preflight-'))
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

test('GET /api/preflight returns a runnable readiness summary', async t => {
    const projectRoot = await makeProjectRoot()
    await fs.mkdir(path.join(projectRoot, 'dist'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'logs'), { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'reports'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'dist', 'index.js'), '// built')
    await fs.mkdir(path.join(projectRoot, 'config'), { recursive: true })
    await fs.writeFile(
        path.join(projectRoot, 'config', 'config.json'),
        JSON.stringify({
            baseURL: 'https://rewards.bing.com',
            sessionPath: 'sessions',
            headless: true,
            clusters: 1,
            workers: { doDailySet: true },
            searchSettings: { queryEngines: ['local'] }
        })
    )
    await fs.writeFile(
        path.join(projectRoot, 'config', 'accounts.json'),
        JSON.stringify([{ email: 'ready@example.com', password: 'secret' }])
    )
    await fs.mkdir(path.join(projectRoot, 'sessions', 'ready@example.com'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'sessions', 'ready@example.com', 'session_mobile.json'), '[{}]')

    const webui = await startWebUiServer({
        projectRoot,
        host: '127.0.0.1',
        port: 0,
        token: ''
    })
    t.after(() => stopHttpServer(webui.server))

    const port = webui.server.address().port
    const response = await fetch(`http://127.0.0.1:${port}/api/preflight`)
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.summary.status, 'ready')
    assert.equal(payload.summary.canRun, true)
    assert.equal(payload.checks.some(item => item.id === 'dist'), true)
    assert.equal(payload.checks.some(item => item.id === 'sessions'), true)
})

test('webui home exposes the preflight entry point', async () => {
    const html = await fs.readFile(path.join(sourceRoot, 'scripts', 'webui', 'public', 'index.html'), 'utf8')
    const app = await fs.readFile(path.join(sourceRoot, 'scripts', 'webui', 'public', 'app.js'), 'utf8')

    assert.match(html, /id="dash-preflight"/)
    assert.match(html, /id="btn-preflight-run"/)
    assert.match(html, /id="preflight-tbody"/)
    assert.match(app, /api\('\/api\/preflight'\)/)
    assert.match(app, /function renderPreflight/)
})
