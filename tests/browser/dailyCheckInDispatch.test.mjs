import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

test('Activities.doDailyCheckIn only dispatches the daily check-in executor once per bot session', async () => {
    const require = createRequire(import.meta.url)
    const indexPath = require.resolve('../../dist/index.js')
    const previousIndexCache = require.cache[indexPath]
    require.cache[indexPath] = {
        id: indexPath,
        filename: indexPath,
        loaded: true,
        exports: {
            getCurrentContext() {
                return {}
            }
        }
    }

    const activitiesModule = await import('../../dist/functions/Activities.js')
    const dailyCheckInModule = await import('../../dist/functions/activities/app/DailyCheckIn.js')
    const Activities = activitiesModule.default.default ?? activitiesModule.default
    const DailyCheckIn = dailyCheckInModule.DailyCheckIn ?? dailyCheckInModule.default.DailyCheckIn

    const logs = []
    let executorCalls = 0
    const bot = {
        isMobile: false,
        userData: {
            currentPoints: 0
        },
        logger: {
            info(...args) {
                logs.push(args)
            },
            debug() {},
            warn() {},
            error() {}
        }
    }
    const activities = new Activities(bot)

    const originalDoDailyCheckIn = DailyCheckIn.prototype.doDailyCheckIn
    DailyCheckIn.prototype.doDailyCheckIn = async function doDailyCheckIn() {
        executorCalls++
    }

    try {
        await activities.doDailyCheckIn()
        await activities.doDailyCheckIn()
    } finally {
        DailyCheckIn.prototype.doDailyCheckIn = originalDoDailyCheckIn
        if (previousIndexCache) {
            require.cache[indexPath] = previousIndexCache
        } else {
            delete require.cache[indexPath]
        }
    }

    assert.equal(executorCalls, 1)
    assert.ok(logs.some((entry) => entry.includes('本轮已处理过每日签到，跳过重复执行')))
})
