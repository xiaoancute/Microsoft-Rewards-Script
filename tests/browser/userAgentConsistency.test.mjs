import test from 'node:test'
import assert from 'node:assert/strict'

async function loadUserAgentManager() {
    const mod = await import('../../dist/browser/UserAgent.js')
    return mod.UserAgentManager
}

function createBot() {
    return {
        logger: {
            info() {},
            warn() {},
            error() {},
            debug() {},
            alert() {}
        }
    }
}

test('UserAgentManager.updateFingerprintUserAgent uses one resolved version payload for navigator and headers', async () => {
    const UserAgentManager = await loadUserAgentManager()
    const manager = new UserAgentManager(createBot())

    manager.resolveUserAgentData = async () => ({
        userAgent:
            'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36 EdgA/147.0.3912.77',
        userAgentMetadata: {
            isMobile: true,
            platform: 'Android',
            fullVersionList: [
                { brand: 'Not/A)Brand', version: '99.0.0.0' },
                { brand: 'Microsoft Edge', version: '147.0.3912.77' },
                { brand: 'Chromium', version: '147.0.7727.117' }
            ],
            brands: [
                { brand: 'Not/A)Brand', version: '99' },
                { brand: 'Microsoft Edge', version: '147' },
                { brand: 'Chromium', version: '147' }
            ],
            platformVersion: '12.0.0',
            architecture: '',
            bitness: '',
            model: ''
        },
        componentData: {
            not_a_brand_version: '99.0.0.0',
            not_a_brand_major_version: '99',
            edge_version: '147.0.3912.77',
            edge_major_version: '147',
            chrome_version: '147.0.7727.117',
            chrome_major_version: '147',
            chrome_reduced_version: '147.0.0.0'
        }
    })

    manager.getUserAgent = async () => {
        throw new Error('should not call getUserAgent directly')
    }
    manager.getAppComponents = async () => {
        throw new Error('should not call getAppComponents directly')
    }

    const fingerprint = {
        fingerprint: {
            navigator: {
                userAgent: 'old-ua',
                appCodeName: 'Mozilla',
                appVersion: 'old-version'
            }
        },
        headers: {}
    }

    const updated = await manager.updateFingerprintUserAgent(fingerprint, true)

    assert.equal(updated.fingerprint.navigator.userAgent.includes('EdgA/147.0.3912.77'), true)
    assert.equal(updated.headers['user-agent'], updated.fingerprint.navigator.userAgent)
    assert.match(updated.headers['sec-ch-ua'], /Microsoft Edge";v="147"/)
    assert.match(updated.headers['sec-ch-ua-full-version-list'], /Microsoft Edge";v="147\.0\.3912\.77"/)
    assert.match(updated.headers['sec-ch-ua-full-version-list'], /Chromium";v="147\.0\.7727\.117"/)
    assert.equal(updated.headers['sec-ch-ua-mobile'], '?1')
    assert.equal(updated.headers['sec-ch-ua-platform'], '"Android"')
    assert.equal(updated.fingerprint.navigator.platform, 'Linux armv8l')
    assert.equal(updated.fingerprint.navigator.maxTouchPoints, 5)
})

test('UserAgentManager.updateFingerprintUserAgent keeps desktop platform hints coherent', async () => {
    const UserAgentManager = await loadUserAgentManager()
    const manager = new UserAgentManager(createBot())

    manager.resolveUserAgentData = async () => ({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.3912.77',
        userAgentMetadata: {
            isMobile: false,
            platform: 'Windows',
            fullVersionList: [
                { brand: 'Not/A)Brand', version: '99.0.0.0' },
                { brand: 'Microsoft Edge', version: '147.0.3912.77' },
                { brand: 'Chromium', version: '147.0.7727.117' }
            ],
            brands: [
                { brand: 'Not/A)Brand', version: '99' },
                { brand: 'Microsoft Edge', version: '147' },
                { brand: 'Chromium', version: '147' }
            ],
            platformVersion: '12.0.0',
            architecture: 'x86',
            bitness: '64',
            model: ''
        },
        componentData: {
            not_a_brand_version: '99.0.0.0',
            not_a_brand_major_version: '99',
            edge_version: '147.0.3912.77',
            edge_major_version: '147',
            chrome_version: '147.0.7727.117',
            chrome_major_version: '147',
            chrome_reduced_version: '147.0.0.0'
        }
    })

    const fingerprint = {
        fingerprint: {
            navigator: {
                userAgent: 'old-ua',
                appCodeName: 'Mozilla',
                appVersion: 'old-version',
                platform: 'Linux x86_64',
                maxTouchPoints: 5
            }
        },
        headers: {
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Linux"'
        }
    }

    const updated = await manager.updateFingerprintUserAgent(fingerprint, false)

    assert.equal(updated.headers['sec-ch-ua-mobile'], '?0')
    assert.equal(updated.headers['sec-ch-ua-platform'], '"Windows"')
    assert.equal(updated.fingerprint.navigator.platform, 'Win32')
    assert.equal(updated.fingerprint.navigator.maxTouchPoints, 0)
})
