import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import cluster, { Worker } from 'cluster'
import type { BrowserContext, Cookie, Page } from 'patchright'
import pkg from '../package.json'

import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'

import Browser from './browser/Browser'
import BrowserFunc from './browser/BrowserFunc'
import BrowserUtils from './browser/BrowserUtils'
import { RiskControlDetectedError, type RiskControlDetection } from './browser/RiskControlDetector'

import { IpcLog, IpcAlert, Logger } from './logging/Logger'
import Utils from './util/Utils'
import { loadAccounts, loadConfig } from './util/Load'
import { checkNodeVersion } from './util/Validator'

import { Login } from './browser/auth/Login'
import { Workers } from './functions/Workers'
import Activities from './functions/Activities'
import { SearchManager } from './functions/SearchManager'

import type { Account } from './interface/Account'
import AxiosClient from './util/Axios'
import { selectRunnableAccounts } from './accounts/AccountRunPolicy'
import { sendDiscord, flushDiscordQueue } from './logging/Discord'
import { sendNtfy, flushNtfyQueue } from './logging/Ntfy'
import { sendPushPlus, flushPushPlusQueue } from './logging/PushPlus'
import type { DashboardData } from './interface/DashboardData'
import type { AppDashboardData } from './interface/AppDashBoardData'
import { PanelFlyoutData } from './interface/PanelFlyoutData'
import {
    buildEarningsSummaryMessage,
    mergeAccountStats,
    normalizePointValue,
    type AccountStats,
    type TaskStats,
    upsertAccountStat
} from './reporting/EarningsStats'

const PROJECT_ROOT = path.resolve(__dirname, '..')
const {
    appendEarningsRun,
    appendFailureSnapshot,
    appendTaskDiscoverySamples,
    writeEarningsCheckpoint,
    clearEarningsCheckpoint,
    recoverEarningsCheckpoint
} = require('../earnings-report.cjs') as {
    appendEarningsRun: (
        projectRoot: string,
        input: {
            runId?: string
            runStartedAt: number
            runFinishedAt: number
            accountStats: AccountStats[]
            hadWorkerFailure?: boolean
            riskControlStopped?: boolean
        }
    ) => Promise<unknown>
    appendTaskDiscoverySamples: (
        projectRoot: string,
        input: {
            account: string
            geoLocale?: string
            tasks?: unknown[]
            capturedAt?: number
        }
    ) => Promise<unknown[]>
    appendFailureSnapshot: (
        projectRoot: string,
        input: {
            runId?: string
            account: string
            stage?: string
            error?: string
            url?: string
            pageTitle?: string
            riskControlStopped?: boolean
            capturedAt?: number
        }
    ) => Promise<unknown>
    writeEarningsCheckpoint: (
        projectRoot: string,
        input: {
            runId: string
            runStartedAt: number
            updatedAt: number
            accountStats: AccountStats[]
            hadWorkerFailure?: boolean
            riskControlStopped?: boolean
            reason?: string
        }
    ) => Promise<unknown>
    clearEarningsCheckpoint: (projectRoot: string, runId?: string) => Promise<unknown>
    recoverEarningsCheckpoint: (
        projectRoot: string
    ) => Promise<{
        recovered: boolean
        reason: string
        checkpoint?: {
            runId: string
            accountStats: AccountStats[]
            runStartedAt: string
        }
    }>
}
interface ExecutionContext {
    isMobile: boolean
    account: Account
}

interface BrowserSession {
    context: BrowserContext
    fingerprint: BrowserFingerprintWithHeaders
}

interface IpcRiskControlStop {
    detection: RiskControlDetection
}

interface IpcWorkerMessage {
    __ipcLog?: IpcLog
    __ipcAlert?: IpcAlert
    __stats?: AccountStats[]
    __accountStat?: AccountStats
    __accountProgress?: AccountStats
    __riskControlStop?: IpcRiskControlStop
}

const executionContext = new AsyncLocalStorage<ExecutionContext>()

export function getCurrentContext(): ExecutionContext {
    const context = executionContext.getStore()
    if (!context) {
        return { isMobile: false, account: {} as any }
    }
    return context
}

async function flushAllWebhooks(timeoutMs = 5000): Promise<void> {
    await Promise.allSettled([flushDiscordQueue(timeoutMs), flushNtfyQueue(timeoutMs), flushPushPlusQueue(timeoutMs)])
}

interface UserData {
    userName: string
    geoLocale: string
    langCode: string
    timezoneOffset: string
    initialPoints: number
    currentPoints: number
    gainedPoints: number
}

// 主要的微软奖励机器人类，负责协调整个积分收集过程
export class MicrosoftRewardsBot {
    public logger: Logger // 日志记录器
    public config // 配置对象
    public utils: Utils // 工具类实例
    public activities: Activities = new Activities(this) // 活动管理器
    public browser: { func: BrowserFunc; utils: BrowserUtils } // 浏览器功能和工具
    private projectRoot = PROJECT_ROOT

    public mainMobilePage!: Page // 主要的移动端页面
    public mainDesktopPage!: Page // 主要的桌面端页面

    public userData: UserData // 用户数据
    public panelData!: PanelFlyoutData

    public rewardsVersion: 'legacy' | 'modern' = 'legacy'
    public currentAccountEmail = ''

    public accessToken = '' // 访问令牌
    public requestToken = '' // 请求令牌
    public cookies: { mobile: Cookie[]; desktop: Cookie[] } // 移动端和桌面端的cookies
    public fingerprint!: BrowserFingerprintWithHeaders // 浏览器指纹

    private pointsCanCollect = 0 // 可收集的积分
    private riskControlStopping = false
    private currentRunId = ''
    private currentRunStartTime = 0
    private currentAccountStartTime = 0
    private currentAccountProgressReady = false
    private currentTaskStats: TaskStats[] = []
    private completedAccountStats: AccountStats[] = []
    private earningsReportWritten = false
    private earningsReportFlushPromise: Promise<void> | null = null
    private earningsCheckpointPromise: Promise<void> | null = null
    private accountProgressTimer: NodeJS.Timeout | null = null
    private runLockFile = ''
    private runLockAcquired = false
    private runLockExitHandler: (() => void) | null = null

    private activeWorkers: number // 活跃的工作进程数
    private exitedWorkers: number[] // 已退出的工作进程PID数组
    private browserFactory: Browser = new Browser(this) // 浏览器工厂实例
    private accounts: Account[] // 账户数组
    private workers: Workers // 工作进程管理器
    private login = new Login(this) // 登录管理器
    private searchManager: SearchManager // 搜索管理器

    public axios!: AxiosClient // HTTP客户端

    constructor() {
        // 初始化用户数据
        this.userData = {
            userName: '', // 用户名
            geoLocale: 'CN', // 地理区域
            langCode: 'zh', // 语言代码
            timezoneOffset: '60', // 时区偏移
            initialPoints: 0, // 初始积分
            currentPoints: 0, // 当前积分
            gainedPoints: 0 // 已获得积分
        }
        this.logger = new Logger(this) // 初始化日志记录器
        this.accounts = [] // 初始化账户数组
        this.cookies = { mobile: [], desktop: [] } // 初始化cookies对象
        this.utils = new Utils() // 初始化工具类
        this.workers = new Workers(this) // 初始化工作进程管理器
        this.searchManager = new SearchManager(this) // 初始化搜索管理器
        this.browser = {
            func: new BrowserFunc(this), // 初始化浏览器功能
            utils: new BrowserUtils(this) // 初始化浏览器工具
        }
        this.config = loadConfig() // 加载配置
        this.activeWorkers = this.config.clusters // 设置活跃工作进程数
        this.exitedWorkers = [] // 初始化已退出工作进程数组
    }

    private buildSummaryMessage(accountStats: AccountStats[], runStartTime: number, hadWorkerFailure: boolean): string {
        return buildEarningsSummaryMessage(accountStats, runStartTime, hadWorkerFailure)
    }

    private async sendPushPlusSummary(
        accountStats: AccountStats[],
        runStartTime: number,
        hadWorkerFailure: boolean
    ): Promise<void> {
        const pushplus = this.config?.webhook?.pushplus
        if (!pushplus?.enabled || !pushplus.token) {
            return
        }

        const content = this.buildSummaryMessage(accountStats, runStartTime, hadWorkerFailure)
        await sendPushPlus(pushplus, content)
    }

    private async appendEarningsReport(
        accountStats: AccountStats[],
        runStartTime: number,
        hadWorkerFailure: boolean
    ): Promise<void> {
        if (!cluster.isPrimary) {
            return
        }

        if (this.earningsReportWritten) {
            this.logger.debug('main', 'EARNINGS-REPORT', '收益报表已写入，跳过重复写入')
            return
        }

        try {
            await this.waitForEarningsCheckpoint()
            await appendEarningsRun(this.getProjectRoot(), {
                runId: this.currentRunId || undefined,
                runStartedAt: runStartTime,
                runFinishedAt: Date.now(),
                accountStats,
                hadWorkerFailure,
                riskControlStopped: this.riskControlStopping
            })
            this.earningsReportWritten = true
            if (this.currentRunId) {
                await clearEarningsCheckpoint(this.getProjectRoot(), this.currentRunId)
            }
            this.logger.info('main', 'EARNINGS-REPORT', '收益报表已写入 reports/earnings.jsonl')
        } catch (error) {
            this.logger.warn(
                'main',
                'EARNINGS-REPORT',
                `收益报表写入失败: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private beginEarningsRun(runStartTime: number): void {
        this.currentRunId = `${new Date(runStartTime).toISOString()}-${process.pid}`
        this.currentRunStartTime = runStartTime
        this.completedAccountStats = []
        this.currentTaskStats = []
        this.earningsReportWritten = false
        this.earningsReportFlushPromise = null
        this.earningsCheckpointPromise = null
    }

    private getProjectRoot(): string {
        return this.projectRoot || PROJECT_ROOT
    }

    private getRunLockFile(): string {
        return path.join(this.getProjectRoot(), 'reports', 'run.lock')
    }

    private isPidAlive(pid: number): boolean {
        try {
            process.kill(pid, 0)
            return true
        } catch (error) {
            return (error as NodeJS.ErrnoException)?.code === 'EPERM'
        }
    }

    private readRunLockPid(filePath: string): number | null {
        try {
            const content = fs.readFileSync(filePath, 'utf8')
            const parsed = JSON.parse(content)
            const pid = Number(parsed?.pid)
            return Number.isInteger(pid) && pid > 0 ? pid : null
        } catch {
            return null
        }
    }

    public async acquireRunLock(): Promise<boolean> {
        if (!cluster.isPrimary) {
            return true
        }

        const filePath = this.getRunLockFile()
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true })

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const handle = await fs.promises.open(filePath, 'wx')
                await handle.writeFile(
                    JSON.stringify({
                        pid: process.pid,
                        startedAt: new Date().toISOString(),
                        projectRoot: this.getProjectRoot()
                    }) + '\n',
                    'utf8'
                )
                await handle.close()

                this.runLockFile = filePath
                this.runLockAcquired = true
                this.runLockExitHandler = () => this.releaseRunLock()
                process.once('exit', this.runLockExitHandler)
                return true
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
                    throw error
                }

                const existingPid = this.readRunLockPid(filePath)
                if (existingPid && this.isPidAlive(existingPid)) {
                    this.logger.warn(
                        'main',
                        'RUN-LOCK',
                        `已有脚本实例正在运行 | pid=${existingPid} | lock=${filePath}`
                    )
                    return false
                }

                this.logger.warn('main', 'RUN-LOCK', `清理陈旧运行锁 | lock=${filePath}`)
                await fs.promises.unlink(filePath).catch(() => undefined)
            }
        }

        return false
    }

    public releaseRunLock(): void {
        if (!this.runLockAcquired || !this.runLockFile) {
            return
        }

        try {
            const existingPid = this.readRunLockPid(this.runLockFile)
            if (existingPid === process.pid) {
                fs.unlinkSync(this.runLockFile)
            }
        } catch {}

        this.runLockAcquired = false
        if (this.runLockExitHandler) {
            process.removeListener('exit', this.runLockExitHandler)
            this.runLockExitHandler = null
        }
    }

    private normalizePointValue(value: unknown, fallback = 0): number {
        return normalizePointValue(value, fallback)
    }

    private beginAccountProgress(accountEmail: string, accountStartTime: number): void {
        this.stopAccountProgressTimer()
        this.currentAccountEmail = accountEmail
        this.currentAccountStartTime = accountStartTime
        this.currentAccountProgressReady = false
        this.currentTaskStats = []

        this.accountProgressTimer = setInterval(() => {
            this.queueEarningsCheckpoint('account-progress')
        }, 30_000)
        this.accountProgressTimer.unref?.()
        this.queueEarningsCheckpoint('account-start')
    }

    private finishAccountProgress(accountEmail: string): void {
        if (this.currentAccountEmail && this.currentAccountEmail !== accountEmail) {
            return
        }

        this.stopAccountProgressTimer()
        this.currentAccountStartTime = 0
        this.currentAccountProgressReady = false
        this.currentAccountEmail = ''
    }

    private stopAccountProgressTimer(): void {
        if (this.accountProgressTimer) {
            clearInterval(this.accountProgressTimer)
            this.accountProgressTimer = null
        }
    }

    private buildCurrentAccountProgressStat(reason: string): AccountStats | null {
        if (!this.currentAccountEmail || !this.currentAccountStartTime || !this.currentAccountProgressReady) {
            return null
        }

        const initialPoints = this.normalizePointValue(this.userData?.initialPoints)
        const finalPoints = Math.max(initialPoints, this.normalizePointValue(this.userData?.currentPoints, initialPoints))
        const duration = Math.max(0, (Date.now() - this.currentAccountStartTime) / 1000)

        return {
            email: this.currentAccountEmail,
            initialPoints,
            finalPoints,
            collectedPoints: Math.max(0, finalPoints - initialPoints),
            duration: parseFloat(duration.toFixed(1)),
            success: false,
            error: `运行中断: ${reason}`,
            riskControlStopped: this.riskControlStopping,
            taskStats: [...(this.currentTaskStats ?? [])]
        }
    }

    private buildCheckpointAccountStats(reason: string): AccountStats[] {
        const stats = [...(this.completedAccountStats ?? [])]
        const progressStat = this.buildCurrentAccountProgressStat(reason)

        if (progressStat && !stats.some(stat => stat.email.toLowerCase() === progressStat.email.toLowerCase())) {
            stats.push(progressStat)
        }

        return stats
    }

    public checkpointEarningsProgress(reason: string): void {
        this.queueEarningsCheckpoint(reason)
    }

    private queueEarningsCheckpoint(reason: string): void {
        if (!this.currentRunStartTime || this.earningsReportWritten) {
            return
        }

        if (!cluster.isPrimary) {
            const progressStat = this.buildCurrentAccountProgressStat(reason)
            if (progressStat && typeof process.send === 'function') {
                try {
                    process.send({ __accountProgress: progressStat } as IpcWorkerMessage)
                } catch {}
            }
            return
        }

        const previous = this.earningsCheckpointPromise ?? Promise.resolve()
        this.earningsCheckpointPromise = previous
            .catch(() => undefined)
            .then(async () => {
                if (this.earningsReportWritten) {
                    return
                }

                const stats = this.buildCheckpointAccountStats(reason)
                if (stats.length === 0) {
                    return
                }

                await writeEarningsCheckpoint(this.getProjectRoot(), {
                    runId: this.currentRunId,
                    runStartedAt: this.currentRunStartTime,
                    updatedAt: Date.now(),
                    accountStats: stats,
                    hadWorkerFailure: true,
                    riskControlStopped: this.riskControlStopping,
                    reason
                })
            })
            .catch(error => {
                this.logger.warn(
                    'main',
                    'EARNINGS-REPORT',
                    `收益 checkpoint 写入失败: ${error instanceof Error ? error.message : String(error)}`
                )
            })
    }

    private async waitForEarningsCheckpoint(): Promise<void> {
        if (this.earningsCheckpointPromise) {
            await this.earningsCheckpointPromise
        }
    }

    private async recoverInterruptedEarningsReport(): Promise<void> {
        if (!cluster.isPrimary) {
            return
        }

        try {
            const result = await recoverEarningsCheckpoint(this.getProjectRoot())
            if (result.recovered) {
                this.logger.warn(
                    'main',
                    'EARNINGS-REPORT',
                    `已恢复上次中断的收益报表 | runId=${result.checkpoint?.runId ?? 'unknown'} | accounts=${
                        result.checkpoint?.accountStats?.length ?? 0
                    }`
                )
            } else if (result.reason !== 'missing') {
                this.logger.debug('main', 'EARNINGS-REPORT', `跳过收益 checkpoint 恢复 | reason=${result.reason}`)
            }
        } catch (error) {
            this.logger.warn(
                'main',
                'EARNINGS-REPORT',
                `收益 checkpoint 恢复失败: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private upsertAccountStat(target: AccountStats[], stat: AccountStats): void {
        upsertAccountStat(target, stat)
    }

    private mergeAccountStats(primary: AccountStats[], fallback: AccountStats[]): AccountStats[] {
        return mergeAccountStats(primary, fallback)
    }

    private rememberCompletedAccountStats(stats: AccountStats[]): void {
        if (!this.completedAccountStats) {
            this.completedAccountStats = []
        }

        for (const stat of stats) {
            this.upsertAccountStat(this.completedAccountStats, stat)
        }

        this.queueEarningsCheckpoint('account-complete')
    }

    private rememberCompletedAccountStat(stat: AccountStats): void {
        this.rememberCompletedAccountStats([stat])

        if (!cluster.isPrimary && typeof process.send === 'function') {
            try {
                process.send({ __accountStat: stat } as IpcWorkerMessage)
            } catch {}
        }
    }

    private buildInterruptedAccountStat(
        accountEmail: string,
        accountStartTime: number,
        error: string,
        riskControlStopped = false
    ): AccountStats {
        const progressStat = this.buildCurrentAccountProgressStat(error)
        if (progressStat && progressStat.email.toLowerCase() === accountEmail.toLowerCase()) {
            return {
                ...progressStat,
                error,
                riskControlStopped
            }
        }

        const durationSeconds = ((Date.now() - accountStartTime) / 1000).toFixed(1)
        return {
            email: accountEmail,
            initialPoints: 0,
            finalPoints: 0,
                collectedPoints: 0,
                duration: parseFloat(durationSeconds),
                success: false,
                error,
                riskControlStopped,
                taskStats: [...(this.currentTaskStats ?? [])]
        }
    }

    private async trackTask<T>(key: string, label: string, task: () => Promise<T>): Promise<T> {
        const startedAt = Date.now()
        const initialPoints = this.normalizePointValue(this.userData?.currentPoints)

        try {
            const result = await task()
            const finalPoints = this.normalizePointValue(this.userData?.currentPoints, initialPoints)
            this.currentTaskStats.push({
                key,
                label,
                status: 'success',
                initialPoints,
                finalPoints,
                collectedPoints: Math.max(0, finalPoints - initialPoints),
                duration: parseFloat(((Date.now() - startedAt) / 1000).toFixed(1))
            })
            return result
        } catch (error) {
            const finalPoints = this.normalizePointValue(this.userData?.currentPoints, initialPoints)
            this.currentTaskStats.push({
                key,
                label,
                status: 'failed',
                initialPoints,
                finalPoints,
                collectedPoints: Math.max(0, finalPoints - initialPoints),
                duration: parseFloat(((Date.now() - startedAt) / 1000).toFixed(1)),
                error: error instanceof Error ? error.message : String(error)
            })
            throw error
        }
    }

    private async captureFailurePageContext(): Promise<{ url?: string; pageTitle?: string }> {
        for (const page of [this.mainMobilePage, this.mainDesktopPage]) {
            if (!page) continue

            try {
                if (typeof page.isClosed === 'function' && page.isClosed()) {
                    continue
                }

                const url = page.url()
                const pageTitle = await page.title().catch(() => undefined)
                if (url || pageTitle) {
                    return { url, pageTitle }
                }
            } catch {}
        }

        return {}
    }

    private async appendFailureSnapshot(
        accountEmail: string,
        stage: string,
        error: string,
        riskControlStopped = false
    ): Promise<void> {
        try {
            const pageContext = await this.captureFailurePageContext()
            await appendFailureSnapshot(this.getProjectRoot(), {
                runId: this.currentRunId || undefined,
                account: accountEmail,
                stage,
                error,
                riskControlStopped,
                capturedAt: Date.now(),
                ...pageContext
            })
        } catch (snapshotError) {
            this.logger.debug(
                'main',
                'FAILURE-SNAPSHOT',
                `失败现场写入失败: ${snapshotError instanceof Error ? snapshotError.message : String(snapshotError)}`
            )
        }
    }

    async flushPartialEarningsReport(reason: string, hadWorkerFailure = true): Promise<void> {
        if (this.earningsReportWritten) {
            return
        }

        if (!cluster.isPrimary) {
            const stats = this.buildCheckpointAccountStats(reason)
            if (stats.length && typeof process.send === 'function') {
                try {
                    process.send({ __stats: stats } as IpcWorkerMessage)
                } catch {}
            }
            return
        }

        if (this.earningsReportFlushPromise) {
            return this.earningsReportFlushPromise
        }

        this.earningsReportFlushPromise = (async () => {
            if (!this.currentRunStartTime) {
                return
            }

            const stats = this.buildCheckpointAccountStats(reason)
            await this.waitForEarningsCheckpoint()
            this.logger.warn(
                'main',
                'EARNINGS-REPORT',
                `检测到运行中断，写入已完成账号的收益报表 | reason=${reason} | accounts=${stats.length}`
            )
            await this.appendEarningsReport(stats, this.currentRunStartTime, hadWorkerFailure)
            this.earningsReportWritten = true
        })()

        try {
            await this.earningsReportFlushPromise
        } finally {
            this.earningsReportFlushPromise = null
        }
    }

    beginRiskControlShutdown(detection: RiskControlDetection, workers: Worker[]): void {
        if (this.riskControlStopping) {
            return
        }

        this.riskControlStopping = true
        this.logger.warn(
            'main',
            'RISK-CONTROL-SHUTDOWN',
            `${detection.message} | selector=${detection.matchedSelector ?? 'none'} | text=${detection.matchedText ?? 'none'}`
        )

        for (const worker of workers) {
            try {
                worker.kill('SIGTERM')
            } catch {}
        }
    }

    // 获取当前是否为移动端的上下文
    get isMobile(): boolean {
        return getCurrentContext().isMobile
    }

    // 初始化账户数据
    async initialize(): Promise<void> {
        this.accounts = loadAccounts()
    }

    // 运行主要的积分收集流程
    async run(): Promise<void> {
        const lockAcquired = await this.acquireRunLock()
        if (!lockAcquired) {
            await flushAllWebhooks()
            return
        }

        try {
            const skipped = []
            await this.recoverInterruptedEarningsReport()
            if (cluster.isPrimary) {
                const selected = selectRunnableAccounts({
                    projectRoot: this.getProjectRoot(),
                    accounts: this.accounts,
                    config: this.config
                })
                this.accounts = selected.runnable
                skipped.push(...selected.skipped)
            }
            const totalAccounts = this.accounts.length
            const runStartTime = Date.now()
            this.beginEarningsRun(runStartTime)

            for (const item of skipped) {
                this.logger.warn('main', 'ACCOUNT-SKIP', `${item.email} 已跳过 | reason=${item.reason} | ${item.detail}`)
            }

            this.logger.info(
                'main',
                'RUN-START',
                `启动微软奖励脚本 | v${pkg.version} | 账户数: ${totalAccounts} | 已跳过: ${skipped.length} | 集群数: ${this.config.clusters}`
            )

            if (totalAccounts === 0) {
                this.logger.warn('main', 'RUN-SKIP', '没有可运行账号，任务结束')
                await flushAllWebhooks()
                return
            }

            // 风控告警：clusters>1 的场景下，如果多个账号共享同一出口 IP（都没配 proxy），
            // 微软会很容易把它们识别为同源批量作业。启动时一次性提醒。
            if (this.config.clusters > 1) {
                const accountsWithoutProxy = this.accounts.filter(a => !a?.proxy?.url)
                if (accountsWithoutProxy.length >= 2) {
                    this.logger.warn(
                        'main',
                        'IP-SHARING',
                        `⚠️ ${accountsWithoutProxy.length} 个账号共享同一出口 IP（未配置代理）：${accountsWithoutProxy
                            .map(a => a.email)
                            .join(', ')}。强烈建议为每个账号配置独立代理，否则会被风控为批量作业。`
                    )
                }
            }

            // 如果集群数大于1，则使用多进程模式
            if (this.config.clusters > 1) {
                if (cluster.isPrimary) {
                    // 主进程逻辑
                    await this.runMaster(runStartTime)
                } else {
                    // 工作进程逻辑
                    this.runWorker(runStartTime)
                }
            } else {
                // 单进程模式，直接运行任务
                await this.runTasks(this.accounts, runStartTime)
            }
        } finally {
            this.releaseRunLock()
        }
    }

    private async runMaster(runStartTime: number): Promise<void> {
        void this.logger.info('main', 'CLUSTER-PRIMARY', `主进程已启动 | PID: ${process.pid}`)

        const rawChunks = this.utils.chunkArray(this.accounts, this.config.clusters)
        const accountChunks = rawChunks.filter(c => c && c.length > 0)
        this.activeWorkers = accountChunks.length

        const allAccountStats: AccountStats[] = []
        let hadWorkerFailure = false

        for (const chunk of accountChunks) {
            const worker = cluster.fork()
            worker.send?.({ chunk, runStartTime })

            worker.on('message', (msg: IpcWorkerMessage) => {
                if (msg.__riskControlStop?.detection) {
                    const workers = Object.values(cluster.workers ?? {}).filter(Boolean) as Worker[]
                    this.beginRiskControlShutdown(msg.__riskControlStop.detection, workers)
                    return
                }

                if (msg.__accountStat) {
                    this.upsertAccountStat(allAccountStats, msg.__accountStat)
                    this.rememberCompletedAccountStats([msg.__accountStat])
                }

                if (msg.__accountProgress) {
                    this.rememberCompletedAccountStats([msg.__accountProgress])
                }

                if (msg.__stats) {
                    for (const stat of msg.__stats) {
                        this.upsertAccountStat(allAccountStats, stat)
                    }
                    this.rememberCompletedAccountStats(msg.__stats)
                }

                // 紧急告警：绕过 webhookLogFilter，强制发所有启用的 webhook
                const alert = msg.__ipcAlert
                if (alert && typeof alert.content === 'string') {
                    const { webhook } = this.config
                    if (webhook.discord?.enabled && webhook.discord.url) {
                        sendDiscord(webhook.discord.url, alert.content, 'error')
                    }
                    if (webhook.ntfy?.enabled && webhook.ntfy.url) {
                        sendNtfy(webhook.ntfy, alert.content, 'error')
                    }
                    if (webhook.pushplus?.enabled && webhook.pushplus.token) {
                        sendPushPlus(webhook.pushplus, alert.content)
                    }
                }

                const log = msg.__ipcLog
                if (log && typeof log.content === 'string') {
                    const { webhook } = this.config
                    const { content, level } = log

                    // Webhooks, for later expansion?
                    if (webhook.discord?.enabled && webhook.discord.url) {
                        sendDiscord(webhook.discord.url, content, level)
                    }
                    if (webhook.ntfy?.enabled && webhook.ntfy.url) {
                        sendNtfy(webhook.ntfy, content, level)
                    }
                }
            })

            // Startup delay for clusters due to resource usage
            if (accountChunks.indexOf(chunk) !== accountChunks.length - 1) {
                await this.utils.wait(5000)
            }
        }

        const onWorkerExit = async (worker: Worker, code?: number, signal?: string): Promise<void> => {
            const { pid } = worker.process

            if (!pid || this.exitedWorkers.includes(pid)) {
                return
            }

            this.exitedWorkers.push(pid)
            this.activeWorkers -= 1

            // exit 0 = good, exit 1 = crash
            const failed = (code ?? 0) !== 0 || Boolean(signal)
            if (failed) {
                hadWorkerFailure = true
            }

            this.logger.warn(
                'main',
                'CLUSTER-WORKER-EXIT',
                `工作进程 ${pid} exit | Code: ${code ?? 'n/a'} | Signal: ${signal ?? 'n/a'} | Active workers: ${this.activeWorkers}`
            )

            if (this.activeWorkers <= 0) {
                const reportAccountStats = this.mergeAccountStats(allAccountStats, this.completedAccountStats)
                const totalCollectedPoints = reportAccountStats.reduce((sum, s) => sum + s.collectedPoints, 0)
                const totalInitialPoints = reportAccountStats.reduce((sum, s) => sum + s.initialPoints, 0)
                const totalFinalPoints = reportAccountStats.reduce((sum, s) => sum + s.finalPoints, 0)
                const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1)

                this.logger.info(
                    'main',
                    'RUN-END',
                    `已完成所有账户 | 已处理账户: ${reportAccountStats.length} | 总收集积分: +${totalCollectedPoints} | 原始总计: ${totalInitialPoints} → 新总计: ${totalFinalPoints} | 总运行时间: ${totalDurationMinutes}分钟`,
                    'green'
                )

                await this.appendEarningsReport(reportAccountStats, runStartTime, hadWorkerFailure)
                await this.sendPushPlusSummary(reportAccountStats, runStartTime, hadWorkerFailure)
                await flushAllWebhooks()

                process.exit(hadWorkerFailure ? 1 : 0)
            }
        }

        cluster.on('exit', (worker, code, signal) => {
            void onWorkerExit(worker, code ?? undefined, signal ?? undefined)
        })

        cluster.on('disconnect', worker => {
            const pid = worker.process?.pid
            this.logger.warn('main', 'CLUSTER-WORKER-DISCONNECT', `Worker ${pid ?? '?'} disconnected`) // <-- Warning only
        })
    }

    private runWorker(runStartTimeFromMaster?: number): void {
        void this.logger.info('main', 'CLUSTER-WORKER-START', `工作进程已生成 | PID: ${process.pid}`)
        process.on('message', async ({ chunk, runStartTime }: { chunk: Account[]; runStartTime: number }) => {
            void this.logger.info(
                'main',
                'CLUSTER-WORKER-TASK',
                `工作进程 ${process.pid} 接收到 ${chunk.length} 个账户。`
            )

            try {
                const stats = await this.runTasks(chunk, runStartTime ?? runStartTimeFromMaster ?? Date.now())

                // Send and flush before exit
                if (process.send) {
                    process.send({ __stats: stats })
                }

                await flushAllWebhooks()
                process.exit(0)
            } catch (error) {
                if (error instanceof RiskControlDetectedError) {
                    process.send?.({
                        __riskControlStop: {
                            detection: error.detection
                        }
                    } as { __riskControlStop: IpcRiskControlStop })
                }

                this.logger.error(
                    'main',
                    'CLUSTER-WORKER-ERROR',
                    `工作进程任务崩溃: ${error instanceof Error ? error.message : String(error)}`
                )

                await flushAllWebhooks()
                process.exit(1)
            }
        })
    }

    private async runTasks(accounts: Account[], runStartTime: number): Promise<AccountStats[]> {
        const accountStats: AccountStats[] = []
        if (!this.currentRunStartTime) {
            this.beginEarningsRun(runStartTime)
        }

        // 打乱账号顺序：避免每次都按 accounts.json 固定顺序跑, 让多账号的首次搜索
        // 时间在微软风控里不再有稳定"账号 A 永远先于账号 B"的特征
        const shuffled = this.utils.shuffleArray([...accounts])

        for (const account of shuffled) {
            const accountStartTime = Date.now()
            const accountEmail = account.email
            this.beginAccountProgress(accountEmail, accountStartTime)
            this.userData.userName = this.utils.getEmailUsername(accountEmail)
            this.userData.timezoneOffset = String(-new Date().getTimezoneOffset())

            try {
                this.logger.info(
                    'main',
                    'ACCOUNT-START',
                    `开始处理账户: ${accountEmail} | 地理位置: ${account.geoLocale}`
                )

                this.axios = new AxiosClient(account.proxy)

                const result: { initialPoints: number; collectedPoints: number } | undefined = await this.Main(
                    account
                ).catch(error => {
                    if (error instanceof RiskControlDetectedError) {
                        throw error
                    }

                    void this.logger.error(
                        true,
                        'FLOW',
                        `${accountEmail} 的移动流程失败: ${error instanceof Error ? error.message : String(error)}`
                    )
                    return undefined
                })

                const durationSeconds = ((Date.now() - accountStartTime) / 1000).toFixed(1)

                if (result) {
                    const collectedPoints = result.collectedPoints ?? 0
                    const accountInitialPoints = result.initialPoints ?? 0
                    const accountFinalPoints = accountInitialPoints + collectedPoints

                    const stat: AccountStats = {
                        email: accountEmail,
                        initialPoints: accountInitialPoints,
                        finalPoints: accountFinalPoints,
                        collectedPoints: collectedPoints,
                        duration: parseFloat(durationSeconds),
                        success: true,
                        taskStats: [...this.currentTaskStats]
                    }
                    accountStats.push(stat)
                    this.rememberCompletedAccountStat(stat)
                    this.finishAccountProgress(accountEmail)

                    this.logger.info(
                        'main',
                        'ACCOUNT-END',
                        `已完成账户: ${accountEmail} | 总计: +${collectedPoints} | 原始: ${accountInitialPoints} → 新值: ${accountFinalPoints} | 持续时间: ${durationSeconds}秒`,
                        'green'
                    )
                } else {
                    const stat = this.buildInterruptedAccountStat(accountEmail, accountStartTime, '流程失败')
                    accountStats.push(stat)
                    this.rememberCompletedAccountStat(stat)
                    await this.appendFailureSnapshot(accountEmail, 'flow', stat.error || '流程失败')
                    this.finishAccountProgress(accountEmail)
                }
            } catch (error) {
                if (error instanceof RiskControlDetectedError) {
                    const stat = this.buildInterruptedAccountStat(accountEmail, accountStartTime, error.message, true)
                    accountStats.push(stat)
                    this.rememberCompletedAccountStat(stat)
                    await this.appendFailureSnapshot(accountEmail, 'risk-control', error.message, true)
                    this.finishAccountProgress(accountEmail)
                    throw error
                }

                const durationSeconds = ((Date.now() - accountStartTime) / 1000).toFixed(1)
                this.logger.error(
                    'main',
                    'ACCOUNT-ERROR',
                    `${accountEmail}: ${error instanceof Error ? error.message : String(error)}`
                )

                const errorMessage = error instanceof Error ? error.message : String(error)
                const stat = this.buildInterruptedAccountStat(accountEmail, accountStartTime, errorMessage)
                accountStats.push(stat)
                this.rememberCompletedAccountStat(stat)
                await this.appendFailureSnapshot(accountEmail, 'account', errorMessage)
                this.finishAccountProgress(accountEmail)
            }
        }

        if (this.config.clusters <= 1 && cluster.isPrimary) {
            const totalCollectedPoints = accountStats.reduce((sum, s) => sum + s.collectedPoints, 0)
            const totalInitialPoints = accountStats.reduce((sum, s) => sum + s.initialPoints, 0)
            const totalFinalPoints = accountStats.reduce((sum, s) => sum + s.finalPoints, 0)
            const totalDurationMinutes = ((Date.now() - runStartTime) / 1000 / 60).toFixed(1)

            this.logger.info(
                'main',
                'RUN-END',
                `已完成所有账户 | 已处理账户: ${accountStats.length} | 总收集积分: +${totalCollectedPoints} | 原始总计: ${totalInitialPoints} → 新总计: ${totalFinalPoints} | 总运行时间: ${totalDurationMinutes}分钟`,
                'green'
            )

            const hadWorkerFailure = accountStats.some(s => !s.success)
            await this.appendEarningsReport(accountStats, runStartTime, hadWorkerFailure)
            await this.sendPushPlusSummary(accountStats, runStartTime, hadWorkerFailure)
            await flushAllWebhooks()
            process.exit(hadWorkerFailure ? 1 : 0)
        }

        return accountStats
    }

    async Main(account: Account): Promise<{ initialPoints: number; collectedPoints: number }> {
        const accountEmail = account.email
        this.logger.info('main', 'FLOW', `开始为 ${accountEmail} 创建会话`)

        // quietHours：真人凌晨不搜。如果此刻在安静区间里，等到区间结束再开始。
        const quietWaitMs = this.utils.quietHoursWaitMs(this.config.quietHours)
        if (quietWaitMs > 0) {
            const endAt = new Date(Date.now() + quietWaitMs).toLocaleString()
            this.logger.info(
                'main',
                'QUIET-HOURS',
                `处于安静时段 | ${accountEmail} 将在 ${endAt} 开始（等待 ${Math.round(quietWaitMs / 60000)} 分钟）`,
                'yellow'
            )
            await this.utils.wait(quietWaitMs)
        }

        let mobileSession: BrowserSession | null = null
        let mobileContextClosed = false

        try {
            return await executionContext.run({ isMobile: true, account }, async () => {
                mobileSession = await this.browserFactory.createBrowser(account)
                const initialContext: BrowserContext = mobileSession.context
                this.mainMobilePage = await initialContext.newPage()

                this.logger.info('main', 'BROWSER', `移动浏览器已启动 | ${accountEmail}`)

                await this.login.login(this.mainMobilePage, account)
                await this.browser.utils.assertNoRiskControlPrompt(
                    this.mainMobilePage,
                    'dashboard-after-login',
                    accountEmail
                )

                try {
                    this.accessToken = await this.login.getAppAccessToken(this.mainMobilePage, accountEmail)
                } catch (error) {
                    this.logger.error(
                        'main',
                        'FLOW',
                        `获取移动访问令牌失败: ${error instanceof Error ? error.message : String(error)}`
                    )
                }

                this.cookies.mobile = await initialContext.cookies()
                this.fingerprint = mobileSession.fingerprint

                const data: DashboardData = await this.browser.func.getDashboardData()
                const appData: AppDashboardData = await this.browser.func.getAppDashboardData()
                if (this.rewardsVersion !== 'modern' || !this.panelData) {
                    this.panelData = await this.browser.func.getPanelFlyoutData()
                }

                await this.browser.utils.assertNoRiskControlPrompt(
                    this.mainMobilePage,
                    'dashboard-after-load',
                    accountEmail
                )

                // 设置地理位置
                this.userData.geoLocale =
                    account.geoLocale === 'auto' ? data.userProfile.attributes.country : account.geoLocale.toLowerCase()
                if (this.userData.geoLocale.length > 2) {
                    this.logger.warn(
                        'main',
                        'GEO-LOCALE',
                        `提供的地理位置长度超过2位 (${this.userData.geoLocale} | 自动=${account.geoLocale === 'auto'})，这可能是无效的并导致错误！`
                    )
                }

                this.userData.initialPoints = data.userStatus.availablePoints
                this.userData.currentPoints = data.userStatus.availablePoints
                this.currentAccountProgressReady = true
                const initialPoints = this.userData.initialPoints ?? 0
                this.checkpointEarningsProgress('initial-points-loaded')

                const browserEarnable = await this.browser.func.getBrowserEarnablePoints()
                const appEarnable = await this.browser.func.getAppEarnablePoints()

                this.pointsCanCollect = browserEarnable.totalEarnablePoints + (appEarnable?.totalEarnablePoints ?? 0)

                this.logger.info(
                    'main',
                    'POINTS',
                    `今日可赚取 | 总计: ${this.pointsCanCollect} | 浏览器: ${
                        browserEarnable.totalEarnablePoints
                    } | 应用: ${appEarnable?.totalEarnablePoints ?? 0} | 任务: ${
                        browserEarnable.taskCount ?? 0
                    } | 未知: ${browserEarnable.unknownTaskCount ?? 0} | ${accountEmail} | 区域设置: ${
                        this.userData.geoLocale
                    }`
                )
                if ((browserEarnable.unknownTaskCount ?? 0) > 0) {
                    try {
                        await appendTaskDiscoverySamples(this.getProjectRoot(), {
                            account: accountEmail,
                            geoLocale: this.userData.geoLocale,
                            tasks: browserEarnable.tasks,
                            capturedAt: Date.now()
                        })
                        this.logger.warn(
                            'main',
                            'TASK-DISCOVERY',
                            `发现未知赚分任务 ${browserEarnable.unknownTaskCount} 个，已记录到 reports/task-discovery.jsonl | ${accountEmail}`
                        )
                    } catch (error) {
                        this.logger.warn(
                            'main',
                            'TASK-DISCOVERY',
                            `未知任务样本写入失败: ${error instanceof Error ? error.message : String(error)}`
                        )
                    }
                }

                if (this.config.ensureStreakProtection) {
                    await this.browser.func.ensureStreakProtection()
                }
                if (this.config.workers.doClaimBonusPoints) {
                    await this.trackTask('claim-bonus-points', '领取积分横幅', () =>
                        this.workers.doClaimBonusPoints(data)
                    )
                    this.checkpointEarningsProgress('claim-bonus-points')
                }
                if (this.config.workers.doAppPromotions) {
                    await this.trackTask('app-promotions', 'App 活动', () => this.workers.doAppPromotions(appData))
                    this.checkpointEarningsProgress('app-promotions')
                }
                if (this.config.workers.doDailySet) {
                    await this.trackTask('daily-set', '每日任务', () =>
                        this.workers.doDailySet(data, this.mainMobilePage)
                    )
                    this.checkpointEarningsProgress('daily-set')
                }
                if (this.config.workers.doSpecialPromotions) {
                    await this.trackTask('special-promotions', '特殊活动', () =>
                        this.workers.doSpecialPromotions(data, this.mainMobilePage)
                    )
                    this.checkpointEarningsProgress('special-promotions')
                }
                if (this.config.workers.doMorePromotions) {
                    await this.trackTask('more-promotions', '更多活动', () =>
                        this.workers.doMorePromotions(data, this.mainMobilePage)
                    )
                    this.checkpointEarningsProgress('more-promotions')
                }
                if (this.config.workers.doDailyCheckIn) {
                    await this.trackTask('daily-check-in', '每日签到', () => this.activities.doDailyCheckIn())
                    this.checkpointEarningsProgress('daily-check-in')
                }
                if (this.config.workers.doReadToEarn) {
                    await this.trackTask('read-to-earn', '阅读赚取', () => this.activities.doReadToEarn())
                    this.checkpointEarningsProgress('read-to-earn')
                }
                if (this.config.workers.doPunchCards) {
                    await this.trackTask('punch-cards', 'Punch Cards', () =>
                        this.workers.doPunchCards(data, this.mainMobilePage)
                    )
                    this.checkpointEarningsProgress('punch-cards')
                }
                if (this.rewardsVersion === 'modern' && this.panelData) {
                    await this.trackTask('modern-panel', '现代面板', () =>
                        this.workers.doModernPanelPromotions(this.panelData, data, this.mainMobilePage)
                    )
                    this.checkpointEarningsProgress('modern-panel')
                }

                const searchPoints = await this.browser.func.getSearchPoints()
                const missingSearchPoints = this.browser.func.missingSearchPoints(searchPoints, true)

                this.cookies.mobile = await initialContext.cookies()

                const { mobilePoints, desktopPoints } = await this.trackTask('searches', '搜索', () =>
                    this.searchManager.doSearches(data, missingSearchPoints, mobileSession!, account, accountEmail)
                )
                this.checkpointEarningsProgress('searches')

                mobileContextClosed = true

                this.userData.gainedPoints = mobilePoints + desktopPoints

                const finalPoints = await this.browser.func.getCurrentPoints()
                const collectedPoints = finalPoints - initialPoints

                this.logger.info(
                    'main',
                    'FLOW',
                    `已收集: +${collectedPoints} | 移动端: +${mobilePoints} | 桌面端: +${desktopPoints} | ${accountEmail}`
                )

                return {
                    initialPoints,
                    collectedPoints: collectedPoints || 0
                }
            })
        } finally {
            if (mobileSession && !mobileContextClosed) {
                try {
                    await executionContext.run({ isMobile: true, account }, async () => {
                        await this.browser.func.closeBrowser(mobileSession!.context, accountEmail)
                    })
                } catch {}
            }
        }
    }
}

export { executionContext }

async function main(): Promise<void> {
    // 在执行任何操作之前进行检查
    checkNodeVersion()
    const rewardsBot = new MicrosoftRewardsBot()

    process.on('beforeExit', () => {
        void flushAllWebhooks()
    })
    process.on('SIGINT', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', '收到 SIGINT 信号，正在刷新并退出...')
        await rewardsBot.flushPartialEarningsReport('SIGINT')
        await flushAllWebhooks()
        process.exit(130)
    })
    process.on('SIGTERM', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', '收到 SIGTERM 信号，正在刷新并退出...')
        await rewardsBot.flushPartialEarningsReport('SIGTERM')
        await flushAllWebhooks()
        process.exit(143)
    })
    process.on('SIGHUP', async () => {
        rewardsBot.logger.warn('main', 'PROCESS', '收到 SIGHUP 信号，正在刷新并退出...')
        await rewardsBot.flushPartialEarningsReport('SIGHUP')
        await flushAllWebhooks()
        process.exit(129)
    })
    process.on('uncaughtException', async error => {
        rewardsBot.logger.error('main', 'UNCAUGHT-EXCEPTION', error)
        await rewardsBot.flushPartialEarningsReport('uncaughtException')
        await flushAllWebhooks()
        process.exit(1)
    })
    process.on('unhandledRejection', async reason => {
        rewardsBot.logger.error('main', 'UNHANDLED-REJECTION', reason as Error)
        await rewardsBot.flushPartialEarningsReport('unhandledRejection')
        await flushAllWebhooks()
        process.exit(1)
    })

    try {
        await rewardsBot.initialize()
        await rewardsBot.run()
    } catch (error) {
        rewardsBot.logger.error('main', 'MAIN-ERROR', error as Error)
        await rewardsBot.flushPartialEarningsReport('main error')
        await flushAllWebhooks()
        process.exit(1)
    }
}

if (require.main === module) {
    main().catch(async error => {
        const tmpBot = new MicrosoftRewardsBot()
        tmpBot.logger.error('main', 'MAIN-ERROR', error as Error)
        await flushAllWebhooks()
        process.exit(1)
    })
}
