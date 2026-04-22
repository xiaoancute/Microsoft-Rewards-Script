import test from 'node:test'
import assert from 'node:assert/strict'

async function loadSearchOnBing() {
    const mod = await import('../../dist/functions/activities/browser/SearchOnBing.js')
    return mod.SearchOnBing
}

async function loadSearchManager() {
    const mod = await import('../../dist/functions/SearchManager.js')
    return mod.SearchManager
}

test('SearchOnBing.searchBing navigates the provided page instead of mainMobilePage', async () => {
    const SearchOnBing = await loadSearchOnBing()
    const pageNavigations = []
    const mainMobileNavigations = []

    const bot = {
        isMobile: false,
        currentAccountEmail: 'search@example.com',
        config: {
            baseURL: 'https://rewards.bing.com'
        },
        userData: {
            currentPoints: 0,
            gainedPoints: 0
        },
        mainMobilePage: {
            async goto(url) {
                mainMobileNavigations.push(url)
            }
        },
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        },
        browser: {
            utils: {
                async assertNoRiskControlPrompt() {},
                async tryDismissAllMessages() {},
                async ghostClick() {},
                async humanType() {}
            },
            func: {
                async getCurrentPoints() {
                    return 10
                }
            }
        },
        utils: {
            async wait() {},
            randomDelay() {
                return 0
            }
        }
    }

    const searchOnBing = new SearchOnBing(bot)
    const page = {
        async goto(url) {
            pageNavigations.push(url)
        },
        async waitForLoadState() {},
        locator() {
            return {
                async waitFor() {},
                async fill() {}
            }
        },
        keyboard: {
            async press() {}
        }
    }

    await searchOnBing.searchBing(page, ['alpha'])

    assert.match(pageNavigations[0] ?? '', /^https:\/\/bing\.com\/search\?q=/)
    assert.deepEqual(mainMobileNavigations, [])
})

test('SearchManager.doDesktopSearchSequential keeps the account in execution context', async () => {
    const SearchManager = await loadSearchManager()
    const account = {
        email: 'desktop@example.com',
        password: '',
        recoveryEmail: '',
        geoLocale: 'auto',
        langCode: 'zh',
        proxy: {
            proxyAxios: false,
            url: '',
            port: 0,
            username: '',
            password: ''
        },
        saveFingerprint: {
            mobile: true,
            desktop: true
        },
        queryEngines: ['reddit']
    }

    let capturedStore = null

    const bot = {
        config: {
            workers: {
                doDesktopSearch: true
            }
        },
        mainDesktopPage: { tag: 'desktop-page' },
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        },
        browser: {
            utils: {
                async assertNoRiskControlPrompt() {}
            },
            func: {
                async closeBrowser() {}
            }
        },
        activities: {
            async doSearch() {
                return 0
            }
        }
    }

    const manager = new SearchManager(bot)
    manager.createDesktopSession = async () => {
        bot.mainDesktopPage = { tag: 'desktop-page' }
        return { context: {} }
    }

    const fakeExecutionContext = {
        async run(store, callback) {
            capturedStore = store
            return await callback()
        }
    }

    await manager.doDesktopSearchSequential(
        {},
        { mobilePoints: 0, desktopPoints: 30 },
        account,
        account.email,
        fakeExecutionContext
    )

    assert.equal(capturedStore?.isMobile, false)
    assert.equal(capturedStore?.account, account)
})
