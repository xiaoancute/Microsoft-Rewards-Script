export interface Config {
    baseURL: string
    sessionPath: string
    headless: boolean
    clusters: number
    errorDiagnostics: boolean
    workers: ConfigWorkers
    searchOnBingLocalQueries: boolean
    globalTimeout: number | string
    searchSettings: ConfigSearchSettings
    debugLogs: boolean
    proxy: ConfigProxy
    consoleLogFilter: LogFilter
    webhook: ConfigWebhook
    /** 可选：安静时段。落在这个区间里启动时会等到区间外才开始（跨日也支持）。真人不会凌晨 3 点搜索。 */
    quietHours?: ConfigQuietHours
}

export interface ConfigQuietHours {
    /** true 才真的生效，省得用户误触发。 */
    enabled: boolean
    /** HH:MM 24 小时制。例如 "01:00"。 */
    start: string
    /** HH:MM 24 小时制。例如 "06:00"。start > end 表示跨午夜（例如 23:00→07:00）。 */
    end: string
}

export type QueryEngine = 'china' | 'google' | 'wikipedia' | 'reddit' | 'local'

export interface ConfigSearchSettings {
    scrollRandomResults: boolean
    clickRandomResults: boolean | number
    parallelSearching: boolean
    queryEngines: QueryEngine[]
    /** 访问一个随机结果后停留的时间。支持单值（"20sec"）或随机区间 `{min, max}`。 */
    searchResultVisitTime: number | string | ConfigDelay
    searchDelay: ConfigDelay
    readDelay: ConfigDelay
    /**
     * 查询词变体：从 queryEngine 返回的词以小概率附加后缀（"新闻"/"最近"/"怎么样" 等），
     * 让跨账号即使词源重合也会呈现不同形态。默认 true。
     */
    queryMutation?: boolean
}

export interface ConfigDelay {
    min: number | string
    max: number | string
}

export interface ConfigProxy {
    queryEngine: boolean
}

export interface ConfigWorkers {
    doDailySet: boolean
    doSpecialPromotions: boolean
    doMorePromotions: boolean
    doPunchCards: boolean
    doAppPromotions: boolean
    doDesktopSearch: boolean
    doMobileSearch: boolean
    doDailyCheckIn: boolean
    doReadToEarn: boolean
}

// Webhooks
export interface ConfigWebhook {
    discord?: WebhookDiscordConfig
    ntfy?: WebhookNtfyConfig
    pushplus?: WebhookPushPlusConfig
    webhookLogFilter: LogFilter
}

export interface LogFilter {
    enabled: boolean
    mode: 'whitelist' | 'blacklist'
    levels?: Array<'debug' | 'info' | 'warn' | 'error'>
    keywords?: string[]
    regexPatterns?: string[]
}

export interface WebhookDiscordConfig {
    enabled: boolean
    url: string
}

export interface WebhookNtfyConfig {
    enabled?: boolean
    url: string
    topic?: string
    token?: string
    title?: string
    tags?: string[]
    priority?: 1 | 2 | 3 | 4 | 5 // 5 highest (important)
}

export interface WebhookPushPlusConfig {
    enabled?: boolean
    token: string
    title?: string
    template?: 'txt' | 'html' | 'markdown'
    channel?: string
}
