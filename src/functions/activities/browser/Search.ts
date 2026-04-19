import type { Page } from 'patchright'
import { randomBytes } from 'crypto'
import type { Counters, DashboardData } from '../../../interface/DashboardData'

import { QueryCore } from '../../QueryEngine'
import { Workers } from '../../Workers'

/**
 * 必应搜索类，负责执行必应搜索以获取积分
 * 该类继承自Workers，提供了搜索相关的核心功能
 */
export class Search extends Workers {
    /** 必应主页URL */
    private bingHome = 'https://bing.com'
    /** 当前搜索页面URL */
    private searchPageURL = ''
    /** 搜索计数器 */
    private searchCount = 0
    /** 首次滚动标志 */
    private firstScroll: boolean = true;

    public async doSearch(data: DashboardData, page: Page, isMobile: boolean): Promise<number> {
        const startBalance = Number(this.bot.userData.currentPoints ?? 0)

        this.bot.logger.info(isMobile, 'SEARCH-BING', `开始必应搜索 | currentPoints=${startBalance}`)

        let totalGainedPoints = 0

        try {
            let searchCounters: Counters = await this.bot.browser.func.getSearchPoints()
            const missingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
            let missingPointsTotal = missingPoints.totalPoints

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `初始搜索计数器 | mobile=${missingPoints.mobilePoints} | desktop=${missingPoints.desktopPoints} | edge=${missingPoints.edgePoints}`
            )

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `剩余搜索积分 | Edge=${missingPoints.edgePoints} | Desktop=${missingPoints.desktopPoints} | Mobile=${missingPoints.mobilePoints}`
            )

            const queryCore = new QueryCore(this.bot)
            const locale = (this.bot.userData.geoLocale ?? 'US').toUpperCase()
            const langCode = (this.bot.userData.langCode ?? 'en').toLowerCase()

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `通过QueryCore解析搜索查询 | locale=${locale} | lang=${langCode} | related=true`
            )

            // 根据地区选择查询方式，如果是CN地区则使用中国热搜
            let queries = await queryCore.queryManager({
                shuffle: true,
                related: true,
                langCode,
                geoLocale: locale,
                // sourceOrder: ['google', 'wikipedia', 'reddit', 'local']
                sourceOrder: ['china','local']
            })

            queries = [...new Set(queries.map(q => q.trim()).filter(Boolean))]

            this.bot.logger.info(isMobile, 'SEARCH-BING', `搜索查询池准备就绪 | count=${queries.length}`)

            // 跳转到bing
            const targetUrl = this.searchPageURL ? this.searchPageURL : this.bingHome
            this.bot.logger.debug(isMobile, 'SEARCH-BING', `导航到搜索页面 | url=${targetUrl}`)

            await page.goto(targetUrl)
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(page)

            let stagnantLoop = 0
            const stagnantLoopMax = 10

            for (let i = 0; i < queries.length; i++) {
                const query = queries[i] as string

                searchCounters = await this.bingSearch(page, query, isMobile)
                const newMissingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
                const newMissingPointsTotal = newMissingPoints.totalPoints

                const rawGained = missingPointsTotal - newMissingPointsTotal
                const gainedPoints = Math.max(0, rawGained)

                if (gainedPoints === 0) {
                    stagnantLoop++
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        `未获得积分 ${stagnantLoop}/${stagnantLoopMax} | query="${query}" | remaining=${newMissingPointsTotal}`
                    )
                } else {
                    stagnantLoop = 0

                    const newBalance = Number(this.bot.userData.currentPoints ?? 0) + gainedPoints
                    this.bot.userData.currentPoints = newBalance
                    this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints

                    totalGainedPoints += gainedPoints

                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        `获得积分=${gainedPoints} points | query="${query}" | remaining=${newMissingPointsTotal}`,
                        'green'
                    )
                }

                missingPointsTotal = newMissingPointsTotal

                if (missingPointsTotal === 0) {
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        '已获得所有必需的搜索积分，停止主搜索循环'
                    )
                    break
                }

                if (stagnantLoop > stagnantLoopMax) {
                    this.bot.logger.warn(
                        isMobile,
                        'SEARCH-BING',
                        `搜索在 ${stagnantLoopMax} 次迭代中未获得积分，中止主搜索循环`
                    )
                    stagnantLoop = 0
                    break
                }

                const remainingQueries = queries.length - (i + 1)
                const minBuffer = 20
                if (missingPointsTotal > 0 && remainingQueries < minBuffer) {
                    this.bot.logger.warn(
                        isMobile,
                        'SEARCH-BING',
                        `在仍有积分缺失的情况下查询缓冲区过低，重新生成 | remainingQueries=${remainingQueries} | missing=${missingPointsTotal}`
                    )

                    const extra = await queryCore.queryManager({
                        shuffle: true,
                        related: true,
                        langCode,
                        geoLocale: locale,
                        sourceOrder: this.bot.config.searchSettings.queryEngines
                    })

                    const merged = [...queries, ...extra].map(q => q.trim()).filter(Boolean)
                    queries = [...new Set(merged)]
                    queries = this.bot.utils.shuffleArray(queries)

                    this.bot.logger.debug(isMobile, 'SEARCH-BING', `查询池已重新生成 | count=${queries.length}`)
                }
            }

            if (missingPointsTotal > 0) {
                this.bot.logger.info(
                    isMobile,
                    'SEARCH-BING',
                    `搜索完成但仍有积分缺失，继续使用重新生成的查询 | remaining=${missingPointsTotal}`
                )

                let stagnantLoop = 0
                const stagnantLoopMax = 5

                while (missingPointsTotal > 0) {
                    const extra = await queryCore.queryManager({
                        shuffle: true,
                        related: true,
                        langCode,
                        geoLocale: locale,
                        sourceOrder: this.bot.config.searchSettings.queryEngines
                    })

                    const merged = [...queries, ...extra].map(q => q.trim()).filter(Boolean)
                    const newPool = [...new Set(merged)]
                    queries = this.bot.utils.shuffleArray(newPool)

                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING-EXTRA',
                        `新搜索查询池已生成 | count=${queries.length}`
                    )

                    for (const query of queries) {
                        this.bot.logger.info(
                            isMobile,
                            'SEARCH-BING-EXTRA',
                            `额外搜索 | remaining=${missingPointsTotal} | query="${query}"`
                        )

                        searchCounters = await this.bingSearch(page, query, isMobile)
                        const newMissingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
                        const newMissingPointsTotal = newMissingPoints.totalPoints

                        const rawGained = missingPointsTotal - newMissingPointsTotal
                        const gainedPoints = Math.max(0, rawGained)

                        if (gainedPoints === 0) {
                            stagnantLoop++
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `未获得积分 ${stagnantLoop}/${stagnantLoopMax} | query="${query}" | remaining=${newMissingPointsTotal}`
                            )
                        } else {
                            stagnantLoop = 0

                            const newBalance = Number(this.bot.userData.currentPoints ?? 0) + gainedPoints
                            this.bot.userData.currentPoints = newBalance
                            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints

                            totalGainedPoints += gainedPoints

                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `获得积分=${gainedPoints} points | query="${query}" | remaining=${newMissingPointsTotal}`,
                                'green'
                            )
                        }

                        missingPointsTotal = newMissingPointsTotal

                        if (missingPointsTotal === 0) {
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                '在额外搜索期间已获得所有必需的搜索积分'
                            )
                            break
                        }

                        if (stagnantLoop > stagnantLoopMax) {
                            this.bot.logger.warn(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `搜索在 ${stagnantLoopMax} 次迭代中未获得积分，中止额外搜索`
                            )
                            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING',
                                `中止额外搜索 | startBalance=${startBalance} | finalBalance=${finalBalance}`
                            )
                            return totalGainedPoints
                        }
                    }
                }
            }

            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `完成必应搜索 | startBalance=${startBalance} | newBalance=${finalBalance}`
            )

            return totalGainedPoints
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-BING',
                `doSearch中出现错误 | message=${error instanceof Error ? error.message : String(error)}`
            )
            return totalGainedPoints
        }
    }

    private async bingSearch(searchPage: Page, query: string, isMobile: boolean) {
        const maxAttempts = 5
        const refreshThreshold = 10 // 页面在x次搜索后变得缓慢？

        this.searchCount++

        if (this.searchCount % refreshThreshold === 0) {
            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `返回主页以清除累积的页面上下文 | count=${this.searchCount} | threshold=${refreshThreshold}`
            )

            this.bot.logger.debug(isMobile, 'SEARCH-BING', `返回主页以刷新状态 | url=${this.bingHome}`)

            const cvid = randomBytes(16).toString('hex')
            const url = `${this.bingHome}/search?q=${encodeURIComponent(query)}&PC=U531&FORM=ANNTA1&cvid=${cvid}`

            await searchPage.goto(url)
            await searchPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(searchPage)
        }

        // 每次搜索重置首次滚动标志，确保有初始向下滚动
        this.firstScroll = true;

        this.bot.logger.debug(
            isMobile,
            'SEARCH-BING',
            `开始bingSearch | query="${query}" | maxAttempts=${maxAttempts} | searchCount=${this.searchCount} | refreshEvery=${refreshThreshold} | scrollRandomResults=${this.bot.config.searchSettings.scrollRandomResults} | clickRandomResults=${this.bot.config.searchSettings.clickRandomResults}`
        )

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const searchBar = '#sb_form_q'
                const searchBox = searchPage.locator(searchBar)

                await searchPage.evaluate(() => {
                    window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
                })

                await searchPage.keyboard.press('Home')
                await searchBox.waitFor({ state: 'visible', timeout: 15000 })

                await this.bot.utils.wait(1000)
                await this.bot.browser.utils.ghostClick(searchPage, searchBar, { clickCount: 3 })
                await searchBox.fill('')

                await this.bot.browser.utils.humanType(searchPage, query)
                await searchPage.keyboard.press('Enter')

                this.bot.logger.debug(
                    isMobile,
                    'SEARCH-BING',
                    `提交查询到必应 | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                await this.bot.utils.wait(3000)

                if (this.bot.config.searchSettings.scrollRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.randomScroll(searchPage, isMobile)
                }

                // clickRandomResults 支持两种语义：
                //   boolean -> 等同 1.0 / 0.0（全点 / 全不点）
                //   number  -> 本次搜索点击的概率（0-1）
                // 真人不是每次搜索都点结果，默认 0.6 比 true 更自然
                const clickCfg = this.bot.config.searchSettings.clickRandomResults as boolean | number
                const clickProb = typeof clickCfg === 'number' ? clickCfg : (clickCfg ? 1 : 0)
                if (clickProb > 0 && Math.random() < clickProb) {
                    await this.bot.utils.wait(2000)
                    await this.clickRandomLink(searchPage, isMobile)
                }

                await this.bot.utils.wait(
                    this.bot.utils.randomDelay(
                        this.bot.config.searchSettings.searchDelay.min,
                        this.bot.config.searchSettings.searchDelay.max,
                        'lognormal'
                    )
                )

                const counters = await this.bot.browser.func.getSearchPoints()

                this.bot.logger.debug(
                    isMobile,
                    'SEARCH-BING',
                    `查询后的搜索计数器 | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                return counters
            } catch (error) {
                if (i >= 5) {
                    this.bot.logger.error(
                        isMobile,
                        'SEARCH-BING',
                        `5次重试后失败 | query="${query}" | message=${error instanceof Error ? error.message : String(error)}`
                    )
                    break
                }

                this.bot.logger.error(
                    isMobile,
                    'SEARCH-BING',
                    `搜索尝试失败 | attempt=${i + 1}/${maxAttempts} | query="${query}" | message=${error instanceof Error ? error.message : String(error)}`
                )

                // 指数退避：base 8s × 2ⁿ，clamp 到 15min，±10% 抖动
                // 失败率是风控强信号，越连续失败越该拉长等待，避免更快触发封禁
                const baseMs = 8000
                const capMs = 15 * 60 * 1000
                const exp = Math.min(baseMs * Math.pow(2, i), capMs)
                const jittered = Math.floor(exp * (0.9 + Math.random() * 0.2))

                this.bot.logger.warn(
                    isMobile,
                    'SEARCH-BING',
                    `重试搜索 | attempt=${i + 1}/${maxAttempts} | query="${query}" | backoff=${Math.round(jittered / 1000)}s`
                )

                await this.bot.utils.wait(jittered)
            }
        }

        this.bot.logger.debug(
            isMobile,
            'SEARCH-BING',
            `在重试失败后返回当前搜索计数器 | query="${query}"`
        )

        return await this.bot.browser.func.getSearchPoints()
    }
  private async randomScroll(page: Page, isMobile: boolean) {
        try {
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const scrollableDistance = Math.max(0, totalHeight - viewportHeight)
            const targetPosition = Math.floor(Math.random() * scrollableDistance)

            this.bot.logger.debug(
                isMobile,
                'SEARCH-RANDOM-SCROLL',
                `分步滚动 | 视口=${viewportHeight} | 总高=${totalHeight} | 目标=${targetPosition}`
            )

            if (scrollableDistance === 0) return

            // 真人滚动是连续的 wheel 事件流，不是瞬移。分 4-8 步，每步 100-300px，间隔 120-320ms。
            const steps = this.bot.utils.randomNumber(4, 8)
            const currentY = await page.evaluate(() => window.scrollY)
            const remaining = targetPosition - currentY

            for (let i = 0; i < steps; i++) {
                const progress = (i + 1) / steps
                const expected = currentY + remaining * progress
                // 每一步带些随机抖动，避免每次步幅一致
                const jitter = this.bot.utils.randomNumber(-40, 40)
                const targetY = Math.floor(expected + jitter)
                const deltaY = targetY - (await page.evaluate(() => window.scrollY))

                if (Math.abs(deltaY) < 4) continue
                // mouse.wheel 在真实 user input 流里产生 wheel 事件，和 JS scrollTo 不同源
                await page.mouse.wheel(0, deltaY)
                await this.bot.utils.wait(this.bot.utils.randomNumber(120, 320))
            }
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-SCROLL',
                `随机滚动过程中出现错误 | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    private async clickRandomLink(page: Page, isMobile: boolean) {
        try {
            this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', '尝试点击随机搜索结果链接')

            const searchPageUrl = page.url()

            await this.bot.browser.utils.ghostClick(page, '#b_results .b_algo h2')
            // searchResultVisitTime 支持单值或 {min,max}；{min,max} 走长尾分布，模拟真人
            // 多数快速扫读（min 附近）、偶尔认真读（tail 到 max）
            const vt = this.bot.config.searchSettings.searchResultVisitTime
            const visitMs = typeof vt === 'object' && vt !== null && 'min' in vt && 'max' in vt
                ? this.bot.utils.randomDelay(vt.min, vt.max, 'lognormal')
                : vt
            await this.bot.utils.wait(visitMs)

            if (isMobile) {
                await page.goto(searchPageUrl)
                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', '已返回搜索页面')
            } else {
                const newTab = await this.bot.browser.utils.getLatestTab(page)
                const newTabUrl = newTab.url()

                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', `已访问结果标签页 | url=${newTabUrl}`)

                await this.bot.browser.utils.closeTabs(newTab)
                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', '已关闭结果标签页')
            }
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-CLICK',
                `随机点击过程中出现错误 | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}
