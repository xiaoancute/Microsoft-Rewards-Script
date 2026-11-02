import assert from 'node:assert/strict'
import test from 'node:test'

import { getEffectiveHeadless, isTermuxPlatform, termuxBrowserCandidates } from './runtimePlatform.js'

test('recognizes Android and Termux without misclassifying desktop Linux', () => {
    assert.equal(isTermuxPlatform('android', ''), true)
    assert.equal(isTermuxPlatform('linux', '/data/data/com.termux/files/usr'), true)
    assert.equal(isTermuxPlatform('linux', '/usr'), false)
    assert.equal(isTermuxPlatform('win32', 'C:\\Termux'), false)
})

test('prefers headless_shell for Termux headless runs', () => {
    const candidates = termuxBrowserCandidates('/prefix', true)
    assert.equal(candidates[0], '/prefix/opt/chromium-beta/headless_shell')
    assert.equal(candidates[2], '/prefix/opt/chromium-beta/chrome')
})

test('forces headless only when Termux has no display', () => {
    assert.equal(getEffectiveHeadless(false, true, false), true)
    assert.equal(getEffectiveHeadless(false, true, true), false)
    assert.equal(getEffectiveHeadless(true, false, false), true)
})
