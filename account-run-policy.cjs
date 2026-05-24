const { readEarningsReport } = require('./earnings-report.cjs')

function selectRunnableAccounts({ projectRoot, accounts, config, now = Date.now() }) {
    const runnable = []
    const skipped = []
    const autoSkip = normalizeAutoSkipConfig(config?.accountHealth?.autoSkip)
    const healthByEmail = autoSkip.enabled ? readAccountHealth(projectRoot, now) : new Map()
    const nowMs = new Date(now).getTime()

    for (const account of accounts || []) {
        const email = account?.email || ''
        if (account?.enabled === false) {
            skipped.push({
                email,
                reason: 'disabled',
                detail: '账号配置 enabled=false'
            })
            continue
        }

        const health = healthByEmail.get(String(email).toLowerCase())
        if (health) {
            const lastFailureMs = health.lastFailureAt ? new Date(health.lastFailureAt).getTime() : 0
            const cooldownMs = autoSkip.riskCooldownHours * 60 * 60 * 1000
            const withinRiskCooldown =
                Number.isFinite(lastFailureMs) &&
                lastFailureMs > 0 &&
                nowMs - lastFailureMs >= 0 &&
                nowMs - lastFailureMs < cooldownMs

            if (
                (health.lastStatus === 'risk_control' || health.primaryFailureBucket === 'risk_control') &&
                withinRiskCooldown
            ) {
                skipped.push({
                    email,
                    reason: 'risk-cooldown',
                    detail: `最近 ${autoSkip.riskCooldownHours} 小时内触发风控`
                })
                continue
            }

            if ((health.consecutiveFailures || 0) >= autoSkip.maxConsecutiveFailures) {
                skipped.push({
                    email,
                    reason: 'consecutive-failures',
                    detail: `连续失败 ${health.consecutiveFailures} 次`
                })
                continue
            }
        }

        runnable.push(account)
    }

    return { runnable, skipped }
}

function normalizeAutoSkipConfig(config = {}) {
    return {
        enabled: config.enabled !== false,
        riskCooldownHours: positiveNumber(config.riskCooldownHours, 24),
        maxConsecutiveFailures: positiveNumber(config.maxConsecutiveFailures, 3)
    }
}

function positiveNumber(value, fallback) {
    const num = Number(value)
    return Number.isFinite(num) && num > 0 ? num : fallback
}

function readAccountHealth(projectRoot, now) {
    try {
        const report = readEarningsReport(projectRoot, {
            range: '7d',
            timezoneOffsetMinutes: new Date().getTimezoneOffset(),
            now
        })
        return new Map((report.accounts || []).map(item => [item.email.toLowerCase(), item]))
    } catch {
        return new Map()
    }
}

module.exports = {
    selectRunnableAccounts
}
