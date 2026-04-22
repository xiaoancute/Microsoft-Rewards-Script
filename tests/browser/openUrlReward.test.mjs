import test from 'node:test'
import assert from 'node:assert/strict'

async function loadOpenUrlReward() {
    const mod = await import('../../dist/functions/activities/browser/OpenUrlReward.js')
    return mod.OpenUrlReward
}

test('OpenUrlReward.doOpenUrlReward opens destination and confirms gained points', async () => {
    const OpenUrlReward = await loadOpenUrlReward()
    const navigations = []
    let balanceReads = 0

    const bot = {
        isMobile: false,
        userData: {
            currentPoints: 100,
            gainedPoints: 0
        },
        logger: {
            info() {},
            debug() {},
            warn() {},
            error() {}
        },
        browser: {
            func: {
                async getCurrentPoints() {
                    balanceReads++
                    if (balanceReads === 1) return 100
                    return 110
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

    const openUrlReward = new OpenUrlReward(bot)
    const page = {
        url() {
            return 'https://rewards.bing.com/dashboard'
        },
        async goto(url) {
            navigations.push(url)
        }
    }

    await openUrlReward.doOpenUrlReward(
        {
            offerId: '   ',
            title: 'blank urlreward',
            promotionType: 'urlreward',
            destinationUrl: 'https://rewards.bing.com/level-benefits'
        },
        page
    )

    assert.deepEqual(navigations, ['https://rewards.bing.com/level-benefits'])
    assert.equal(balanceReads, 2)
    assert.equal(bot.userData.currentPoints, 110)
    assert.equal(bot.userData.gainedPoints, 10)
})
