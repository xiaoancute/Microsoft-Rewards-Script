import test from 'node:test'
import assert from 'node:assert/strict'

async function loadEarningsStats() {
    return await import('../../dist/reporting/EarningsStats.js')
}

test('mergeAccountStats preserves primary stats and appends missing fallback stats', async () => {
    const { mergeAccountStats } = await loadEarningsStats()

    const merged = mergeAccountStats(
        [
            {
                email: 'done@example.com',
                initialPoints: 100,
                finalPoints: 130,
                collectedPoints: 30,
                duration: 10,
                success: true
            }
        ],
        [
            {
                email: 'done@example.com',
                initialPoints: 100,
                finalPoints: 120,
                collectedPoints: 20,
                duration: 8,
                success: false
            },
            {
                email: 'partial@example.com',
                initialPoints: 200,
                finalPoints: 210,
                collectedPoints: 10,
                duration: 5,
                success: false
            }
        ]
    )

    assert.deepEqual(
        merged.map(stat => [stat.email, stat.collectedPoints, stat.success]),
        [
            ['done@example.com', 30, true],
            ['partial@example.com', 10, false]
        ]
    )
})

test('buildEarningsSummaryMessage formats totals and account details', async () => {
    const { buildEarningsSummaryMessage } = await loadEarningsStats()

    const summary = buildEarningsSummaryMessage(
        [
            {
                email: 'ok@example.com',
                initialPoints: 100,
                finalPoints: 125,
                collectedPoints: 25,
                duration: 12.345,
                success: true
            },
            {
                email: 'failed@example.com',
                initialPoints: 50,
                finalPoints: 50,
                collectedPoints: 0,
                duration: 7,
                success: false,
                error: '流程失败'
            }
        ],
        1760000000000,
        true,
        new Date('2025-10-09T08:55:00.000Z'),
        1760000060000
    )

    assert.match(summary, /每日积分摘要 \| 2025-10-09 08:55:00/)
    assert.match(summary, /状态: 异常/)
    assert.match(summary, /账户数: 2/)
    assert.match(summary, /总收集积分: \+25/)
    assert.match(summary, /原始总计: 150 → 新总计: 175/)
    assert.match(summary, /总运行时间: 1\.0分钟/)
    assert.match(summary, /ok@example\.com \| \+25 \| 100→125 \| 12\.3秒 \| 成功/)
    assert.match(summary, /failed@example\.com \| \+0 \| 50→50 \| 7\.0秒 \| 失败 \| 流程失败/)
})
