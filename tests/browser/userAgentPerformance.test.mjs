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

test('UserAgentManager.getAppComponents reuses one in-flight version fetch', async () => {
    const UserAgentManager = await loadUserAgentManager()
    UserAgentManager.resolvedVersionsCache = null
    UserAgentManager.resolvedVersionsInFlight = null

    const manager = new UserAgentManager(createBot())
    let chromeCalls = 0
    let edgeCalls = 0

    manager.getChromeVersion = async () => {
        chromeCalls++
        await new Promise(resolve => setTimeout(resolve, 10))
        return '147.0.7727.117'
    }

    manager.getEdgeVersions = async () => {
        edgeCalls++
        await new Promise(resolve => setTimeout(resolve, 10))
        return {
            android: '147.0.3912.77',
            windows: '147.0.3912.77'
        }
    }

    const [mobile, desktop] = await Promise.all([manager.getAppComponents(true), manager.getAppComponents(false)])

    assert.equal(chromeCalls, 1)
    assert.equal(edgeCalls, 1)
    assert.equal(mobile.chrome_version, '147.0.7727.117')
    assert.equal(desktop.edge_version, '147.0.3912.77')
})
