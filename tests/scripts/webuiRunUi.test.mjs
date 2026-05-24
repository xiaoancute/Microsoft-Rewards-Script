import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
    describeRunUiState,
    externalRunLabel,
    hasLoggedInSession
} from '../../scripts/webui/public/run-ui.js'

test('externalRunLabel distinguishes local and docker external runs', () => {
    assert.equal(externalRunLabel({ source: 'local-run-lock' }), '本地脚本')
    assert.equal(externalRunLabel({ source: 'docker-lockfile' }), '容器任务')
    assert.equal(externalRunLabel({ source: 'unknown' }), '外部任务')
})

test('describeRunUiState uses local external run text instead of docker text', () => {
    const state = describeRunUiState({
        jobs: [],
        externalRun: { active: true, source: 'local-run-lock', pid: 123 },
        capabilities: { canRunNow: true }
    })

    assert.equal(state.kind, 'external')
    assert.equal(state.startDisabled, true)
    assert.equal(state.externalLabel, '本地脚本')
    assert.match(state.homeSubText, /本地脚本运行中/)
    assert.match(state.logPillText, /本地脚本/)
    assert.doesNotMatch(state.homeSubText, /容器任务/)
})

test('hasLoggedInSession requires real cookies, not just configured accounts', () => {
    assert.equal(hasLoggedInSession([]), false)
    assert.equal(hasLoggedInSession([{ email: 'only-account@example.com', isLoggedIn: false }]), false)
    assert.equal(hasLoggedInSession([{ email: 'mobile@example.com', mobile: { cookies: 1 } }]), true)
    assert.equal(hasLoggedInSession([{ email: 'desktop@example.com', desktop: { cookies: 2 } }]), true)
})
