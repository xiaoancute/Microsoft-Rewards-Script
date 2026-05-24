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

async function loadSearch() {
    const mod = await import('../../dist/functions/activities/browser/Search.js')
    return mod.Search
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

test('Search.bingSearch stops immediately when the results page hits risk control', async () => {
    const Search = await loadSearch()
    const { RiskControlDetectedError } = await import('../../dist/browser/RiskControlDetector.js')
    const calls = []
    const bot = {
        isMobile: true,
        currentAccountEmail: 'risk@example.com',
        config: {
            searchSettings: {
                scrollRandomResults: true,
                clickRandomResults: 1,
                searchDelay: { min: 0, max: 0 }
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
                async ghostClick() {},
                async humanType() {},
                async randomScroll() {},
                async assertNoRiskControlPrompt(page, stage, email) {
                    calls.push([stage, email])
                    throw new RiskControlDetectedError({
                        accountEmail: email,
                        stage,
                        matchedSelector: null,
                        matchedText: 'searches are temporarily limited',
                        message: 'risk stop'
                    })
                }
            },
            func: {
                async getSearchPoints() {
                    throw new Error('should not read counters after risk control')
                }
            }
        },
        utils: {
            async wait() {},
            randomDelay() {
                return 0
            },
            randomNumber() {
                return 1
            }
        }
    }

    const search = new Search(bot)
    const page = {
        async goto() {},
        async evaluate(fn) {
            if (String(fn).includes('innerHeight')) return 800
            if (String(fn).includes('scrollHeight')) return 1000
            if (String(fn).includes('scrollY')) return 0
            return null
        },
        locator() {
            return {
                async waitFor() {},
                async fill() {}
            }
        },
        keyboard: {
            async press() {}
        },
        mouse: {
            async wheel() {}
        }
    }

    await assert.rejects(() => search.bingSearch(page, 'risk query', true), /risk stop/)
    assert.deepEqual(calls, [['search-bing-results', 'risk@example.com']])
})

test('Search.doSearch rethrows risk control errors instead of returning partial points', async () => {
    const Search = await loadSearch()
    const { QueryCore } = await import('../../dist/functions/QueryEngine.js')
    const { RiskControlDetectedError } = await import('../../dist/browser/RiskControlDetector.js')

    const originalQueryManager = QueryCore.prototype.queryManager
    QueryCore.prototype.queryManager = async () => ['risk query']

    try {
        const riskError = new RiskControlDetectedError({
            accountEmail: 'risk@example.com',
            stage: 'search-bing-results',
            matchedSelector: null,
            matchedText: 'searches are temporarily limited',
            message: 'risk stop'
        })

        const bot = {
            isMobile: true,
            currentAccountEmail: 'risk@example.com',
            userData: {
                geoLocale: 'US',
                langCode: 'en',
                currentPoints: 0,
                gainedPoints: 0
            },
            config: {
                searchSettings: {
                    queryEngines: ['local']
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
                    async tryDismissAllMessages() {}
                },
                func: {
                    async getSearchPoints() {
                        return {}
                    },
                    missingSearchPoints() {
                        return {
                            totalPoints: 10,
                            mobilePoints: 10,
                            desktopPoints: 0,
                            edgePoints: 0
                        }
                    }
                }
            },
            utils: {
                shuffleArray(value) {
                    return value
                }
            }
        }

        const search = new Search(bot)
        search.bingSearch = async () => {
            throw riskError
        }

        const page = {
            async goto() {}
        }

        await assert.rejects(() => search.doSearch({}, page, true), /risk stop/)
    } finally {
        QueryCore.prototype.queryManager = originalQueryManager
    }
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
