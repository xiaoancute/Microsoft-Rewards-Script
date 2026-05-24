import type { Account } from '../interface/Account'

const { selectRunnableAccounts: selectRunnableAccountsBase } = require('../../account-run-policy.cjs') as {
    selectRunnableAccounts: (input: {
        projectRoot: string
        accounts: Account[]
        config?: AccountRunPolicyConfig
        now?: number | string
    }) => AccountRunSelection
}

export interface AccountHealthAutoSkipConfig {
    enabled?: boolean
    riskCooldownHours?: number
    maxConsecutiveFailures?: number
}

export interface AccountRunPolicyConfig {
    accountHealth?: {
        autoSkip?: AccountHealthAutoSkipConfig
    }
}

export interface SkippedAccount {
    email: string
    reason: 'disabled' | 'risk-cooldown' | 'consecutive-failures'
    detail: string
}

export interface AccountRunSelection {
    runnable: Account[]
    skipped: SkippedAccount[]
}

export function selectRunnableAccounts(input: {
    projectRoot: string
    accounts: Account[]
    config?: AccountRunPolicyConfig
    now?: number | string
}): AccountRunSelection {
    return selectRunnableAccountsBase(input)
}
