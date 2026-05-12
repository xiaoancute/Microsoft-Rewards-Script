import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { buildNodeAwareEnv, getPreferredNpmCommand } from '../../scripts/webui/runner.js'
import { renderRewardService, renderWebuiService } from '../../scripts/webui/systemd.js'

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('buildNodeAwareEnv prepends the current node bin to PATH', () => {
    const originalPath = '/usr/local/bin:/usr/bin'
    const env = buildNodeAwareEnv({ PATH: originalPath, LANG: 'en_US.UTF-8' })
    const nodeBin = path.dirname(process.execPath)

    assert.equal(env.LANG, 'en_US.UTF-8')
    assert.match(env.PATH, new RegExp(`^${escapeRegex(nodeBin)}${escapeRegex(path.delimiter)}`))
    assert.match(env.PATH, new RegExp(`${escapeRegex(path.delimiter)}${escapeRegex('/usr/bin')}$`))
})

test('getPreferredNpmCommand prefers npm next to the current node binary', () => {
    const npmName = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const expected = path.join(path.dirname(process.execPath), npmName)

    assert.equal(getPreferredNpmCommand(), expected)
})

test('renderRewardService adds a node-aware PATH environment', () => {
    const service = renderRewardService('/tmp/project')
    const nodeBin = path.dirname(process.execPath)

    assert.match(service, new RegExp(`Environment=PATH=${escapeRegex(nodeBin)}`))
    assert.match(service, /ExecStart=.*npm.* start/)
})

test('renderWebuiService adds a node-aware PATH environment', () => {
    const service = renderWebuiService('/tmp/project', { host: '127.0.0.1', port: 3000, token: 'abc' })
    const nodeBin = path.dirname(process.execPath)

    assert.match(service, new RegExp(`Environment=PATH=${escapeRegex(nodeBin)}`))
    assert.match(service, /Environment=WEBUI_TOKEN=abc/)
})
