import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getBrowserSessionState } from '../../scripts/main/browserSessionSupport.js'

async function makeProjectRoot() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'mrs-browser-session-'))
}

test('getBrowserSessionState allows first login without an existing session directory', async () => {
    const projectRoot = await makeProjectRoot()

    const session = await getBrowserSessionState({
        projectRoot,
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
    assert.equal(session.sessionBase, path.join(projectRoot, 'sessions', 'first@example.com'))
})

test('getBrowserSessionState prefers an existing root-level mobile session', async () => {
    const projectRoot = await makeProjectRoot()
    const sessionBase = path.join(projectRoot, 'sessions', 'mobile@example.com')
    await fs.mkdir(sessionBase, { recursive: true })
    await fs.writeFile(path.join(sessionBase, 'session_mobile.json'), JSON.stringify([{ name: 'MUID' }]))

    const session = await getBrowserSessionState({
        projectRoot,
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

test('getBrowserSessionState falls back to a legacy session directory but keeps the root session target', async () => {
    const projectRoot = await makeProjectRoot()
    const legacySessionBase = path.join(projectRoot, 'dist', 'browser', 'sessions', 'legacy@example.com')
    await fs.mkdir(legacySessionBase, { recursive: true })
    await fs.writeFile(path.join(legacySessionBase, 'session_mobile.json'), JSON.stringify([{ name: 'MUID' }]))

    const session = await getBrowserSessionState({
        projectRoot,
        sessionPath: 'sessions',
        email: 'legacy@example.com',
        saveFingerprint: {
            mobile: false,
            desktop: false
        }
    })

    assert.equal(session.isExistingSession, true)
    assert.equal(session.sessionType, 'mobile')
    assert.equal(session.isMobile, true)
    assert.equal(session.cookies.length, 1)
    assert.equal(session.sessionBase, path.join(projectRoot, 'sessions', 'legacy@example.com'))
})
