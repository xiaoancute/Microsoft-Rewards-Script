import test from 'node:test'
import assert from 'node:assert/strict'

async function loadBrowserFunc() {
    const mod = await import('../../dist/browser/BrowserFunc.js')
    return mod.default?.default ?? mod.default ?? mod.BrowserFunc
}

test('BrowserFunc.getAppEarnablePoints includes unfinished non-dedicated app promotions', async () => {
    const BrowserFunc = await loadBrowserFunc()

    const bot = {
        accessToken: 'token',
        isMobile: false,
        userData: {
            geoLocale: 'us'
        },
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        },
        axios: {
            async request() {
                return {
                    data: {
                        response: {
                            promotions: [
                                {
                                    attributes: {
                                        offerid: 'ENUS_readarticle3_30points',
                                        type: 'msnreadearn',
                                        pointmax: '30',
                                        pointprogress: '10'
                                    }
                                },
                                {
                                    attributes: {
                                        offerid: 'Gamification_Sapphire_DailyCheckIn',
                                        type: 'checkin',
                                        progress: '1',
                                        last_updated: '2026-04-21T00:00:00.000Z',
                                        day_2_points: '10'
                                    }
                                },
                                {
                                    attributes: {
                                        offerid: 'offer-emerald',
                                        type: 'emerald',
                                        complete: 'false',
                                        pointmax: '40',
                                        pointprogress: '15'
                                    }
                                },
                                {
                                    attributes: {
                                        offerid: 'offer-complete',
                                        type: 'emerald',
                                        complete: 'true',
                                        pointmax: '20',
                                        pointprogress: '5'
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        }
    }

    const browserFunc = new BrowserFunc(bot)
    const points = await browserFunc.getAppEarnablePoints()

    assert.equal(points.readToEarn, 20)
    assert.equal(points.checkIn, 10)
    assert.equal(points.appPromotionsPoints, 25)
    assert.equal(points.totalEarnablePoints, 55)
})
