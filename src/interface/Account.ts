import type { QueryEngine } from './Config'

export interface Account {
    email: string
    password: string
    totpSecret?: string
    recoveryEmail: string
    geoLocale: 'auto' | string
    langCode: 'en' | string
    proxy: AccountProxy
    saveFingerprint: ConfigSaveFingerprint
    /**
     * 账号级 queryEngines 覆盖。没填（或为空数组）就用 config.searchSettings.queryEngines。
     * 让多账号用不同词源（如 A 用 [china,local]、B 用 [reddit,wikipedia]），
     * 避免跨账号搜索词分布高度重合被批量风控。
     */
    queryEngines?: QueryEngine[]
}

export interface AccountProxy {
    proxyAxios: boolean
    url: string
    port: number
    password: string
    username: string
}

export interface ConfigSaveFingerprint {
    mobile: boolean
    desktop: boolean
}
