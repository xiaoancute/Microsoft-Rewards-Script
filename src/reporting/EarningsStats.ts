export interface AccountStats {
    email: string
    initialPoints: number
    finalPoints: number
    collectedPoints: number
    duration: number
    success: boolean
    error?: string
    riskControlStopped?: boolean
    taskStats?: TaskStats[]
}

export interface TaskStats {
    key: string
    label: string
    status: 'success' | 'failed' | 'skipped'
    initialPoints: number
    finalPoints: number
    collectedPoints: number
    duration: number
    error?: string
}

export function normalizePointValue(value: unknown, fallback = 0): number {
    const points = Number(value)
    return Number.isFinite(points) ? points : fallback
}

export function upsertAccountStat(target: AccountStats[], stat: AccountStats): void {
    const index = target.findIndex(item => item.email.toLowerCase() === stat.email.toLowerCase())
    if (index === -1) {
        target.push(stat)
    } else {
        target[index] = stat
    }
}

export function mergeAccountStats(primary: AccountStats[], fallback: AccountStats[]): AccountStats[] {
    const merged = [...primary]
    for (const stat of fallback) {
        if (!merged.some(item => item.email.toLowerCase() === stat.email.toLowerCase())) {
            merged.push(stat)
        }
    }
    return merged
}

export function buildEarningsSummaryMessage(
    accountStats: AccountStats[],
    runStartTime: number,
    hadWorkerFailure: boolean,
    now = new Date(),
    nowMs = Date.now()
): string {
    const totalCollectedPoints = accountStats.reduce((sum, s) => sum + s.collectedPoints, 0)
    const totalInitialPoints = accountStats.reduce((sum, s) => sum + s.initialPoints, 0)
    const totalFinalPoints = accountStats.reduce((sum, s) => sum + s.finalPoints, 0)
    const totalDurationMinutes = ((nowMs - runStartTime) / 1000 / 60).toFixed(1)
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19)

    const lines: string[] = [
        `每日积分摘要 | ${timestamp}`,
        `状态: ${hadWorkerFailure ? '异常' : '完成'}`,
        `账户数: ${accountStats.length}`,
        `总收集积分: +${totalCollectedPoints}`,
        `原始总计: ${totalInitialPoints} → 新总计: ${totalFinalPoints}`,
        `总运行时间: ${totalDurationMinutes}分钟`
    ]

    if (accountStats.length > 0) {
        lines.push('')
        lines.push('账户明细:')
        for (const stat of accountStats) {
            const status = stat.success ? '成功' : '失败'
            const duration = Number.isFinite(stat.duration) ? stat.duration.toFixed(1) : String(stat.duration)
            const error = stat.error ? ` | ${stat.error}` : ''
            lines.push(
                `${stat.email} | +${stat.collectedPoints} | ${stat.initialPoints}→${stat.finalPoints} | ${duration}秒 | ${status}${error}`
            )
        }
    }

    return lines.join('\n')
}
