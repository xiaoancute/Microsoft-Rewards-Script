import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getBrowserSessionState } from '../../scripts/main/browserSessionSupport.js'

async function makeRuntimeBase() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-browser-session-'))
}

test('getBrowserSessionState allows first login without an existing session directory', async () => {
    const runtimeBase = await makeRuntimeBase()

    const session = await getBrowserSessionState({
        runtimeBase,
        sessionPath: 'sessions',
        email: 'first@example.com',
        saveFingerprint: {
            mobile: true,
            desktop: true
        }
    })

    assert.equal(session.isExistingSession, false)
    assert.equal(session.sessionType, 'desktop')
    assert.equal(session.isMobile, false)
    assert.deepEqual(session.cookies, [])
    assert.equal(session.fingerprint, null)
    assert.equal(session.sessionBase, path.join(runtimeBase, 'browser', 'sessions', 'first@example.com'))
})

test('getBrowserSessionState still reuses an existing mobile session', async () => {
    const runtimeBase = await makeRuntimeBase()
    const sessionBase = path.join(runtimeBase, 'browser', 'sessions', 'mobile@example.com')
    await fs.mkdir(sessionBase, { recursive: true })
    await fs.writeFile(path.join(sessionBase, 'session_mobile.json'), JSON.stringify([{ name: 'MUID' }]))

    const session = await getBrowserSessionState({
        runtimeBase,
        sessionPath: 'sessions',
        email: 'mobile@example.com',
        saveFingerprint: {
            mobile: false,
            desktop: false
        }
    })

    assert.equal(session.isExistingSession, true)
    assert.equal(session.sessionType, 'mobile')
    assert.equal(session.isMobile, true)
    assert.equal(session.cookies.length, 1)
})
