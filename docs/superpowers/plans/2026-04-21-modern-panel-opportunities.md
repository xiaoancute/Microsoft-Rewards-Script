# Modern Panel Opportunities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize modern-only Rewards panel opportunities from the web dashboard, auto-execute only the entries that match existing stable handlers, and explicitly log/skip unsupported or info-only entries.

**Architecture:** Keep the existing legacy-compatible `DashboardData` main flow intact, but add a small modern-only layer beside it. A collector will normalize extra `PanelFlyoutData` promotions into a typed opportunity list with `auto/skip` decisions, and a focused executor will run only `quiz` / `poll` / `urlreward` opportunities through the current `Activities` handlers. `Workers` will expose a single `doModernPanelPromotions(...)` entrypoint, and `index.ts` will call it only when the account is using the modern panel and `panelData` is available.

**Tech Stack:** TypeScript, Patchright `Page`, Node.js `node:test`, existing logger/utils/activity handlers, `npm run build`

---

## File Map

- Create: `src/functions/modernPanel/types.ts`
  Defines the normalized modern opportunity shape and reason enums.
- Create: `src/functions/modernPanel/collectModernPanelOpportunities.ts`
  Collects `dailyCheckInPromotion`, `streakPromotion`, `streakBonusPromotions`, `levelInfoPromotion`, and `levelBenefitsPromotion`, then classifies and de-duplicates them.
- Create: `src/functions/modernPanel/executeModernPanelOpportunities.ts`
  Logs summary / per-opportunity decisions and routes only `auto` opportunities to existing handlers.
- Modify: `src/functions/Workers.ts`
  Adds `doModernPanelPromotions(...)` and wires it to the collector + executor.
- Modify: `src/index.ts`
  Invokes the new worker after existing web activity workers when `rewardsVersion === 'modern'` and `panelData` exists.
- Create: `tests/browser/modernPanelCollector.test.mjs`
  Covers classification, duplicate handling, and skip reasons.
- Create: `tests/browser/modernPanelWorker.test.mjs`
  Covers worker routing, page forwarding, and skip logging.

### Task 1: Add Collector Classification Coverage

**Files:**
- Create: `tests/browser/modernPanelCollector.test.mjs`
- Test: `tests/browser/modernPanelCollector.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/browser/modernPanelCollector.test.mjs` with focused coverage for the collector contract.

```js
import test from 'node:test'
import assert from 'node:assert/strict'

async function loadCollector() {
    return await import('../../dist/functions/modernPanel/collectModernPanelOpportunities.js')
}

function makePromotion(overrides = {}) {
    return {
        offerId: 'offer-1',
        title: 'promo',
        promotionType: 'urlreward',
        destinationUrl: 'https://rewards.microsoft.com/promo',
        pointProgressMax: 10,
        pointProgress: 0,
        activityProgress: 0,
        activityProgressMax: 10,
        complete: false,
        exclusiveLockedFeatureStatus: 'unlocked',
        hash: 'hash-1',
        activityType: 'activity',
        ...overrides
    }
}

test('collectModernPanelOpportunities classifies modern-only entries and duplicate offers', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            dailyCheckInPromotion: makePromotion({
                offerId: 'daily-checkin',
                title: 'Daily check in'
            }),
            streakPromotion: makePromotion({
                offerId: 'streak-poll',
                title: 'Streak poll',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/?pollScenarioId=123'
            }),
            streakBonusPromotions: [
                makePromotion({
                    offerId: 'duplicate-more',
                    title: 'Duplicate streak bonus'
                })
            ],
            levelInfoPromotion: makePromotion({
                offerId: 'level-info',
                title: 'Level info',
                pointProgressMax: 0
            }),
            levelBenefitsPromotion: makePromotion({
                offerId: 'level-benefit',
                title: 'Level benefit'
            })
        }
    }

    const dashboardData = {
        dailySetPromotions: {
            '04/21/2026': [makePromotion({ offerId: 'duplicate-daily' })]
        },
        morePromotions: [makePromotion({ offerId: 'duplicate-more' })],
        morePromotionsWithoutPromotionalItems: []
    }

    const opportunities = collectModernPanelOpportunities(panelData, dashboardData)
    const byId = Object.fromEntries(opportunities.map(item => [item.offerId, item]))

    assert.equal(byId['daily-checkin'].source, 'daily')
    assert.equal(byId['daily-checkin'].kind, 'checkin')
    assert.equal(byId['daily-checkin'].decision, 'skip')
    assert.equal(byId['daily-checkin'].reason, 'daily-check-in-web-entry-not-supported')

    assert.equal(byId['streak-poll'].source, 'streak')
    assert.equal(byId['streak-poll'].kind, 'poll')
    assert.equal(byId['streak-poll'].decision, 'auto')

    assert.equal(byId['duplicate-more'].decision, 'skip')
    assert.equal(byId['duplicate-more'].reason, 'duplicate-with-legacy-worker')

    assert.equal(byId['level-info'].source, 'level')
    assert.equal(byId['level-info'].kind, 'info-only')
    assert.equal(byId['level-info'].decision, 'skip')
    assert.equal(byId['level-info'].reason, 'info-card-without-action')

    assert.equal(byId['level-benefit'].kind, 'urlreward')
    assert.equal(byId['level-benefit'].decision, 'auto')
    assert.equal(byId['level-benefit'].reason, 'auto-executable')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run build
node --test tests/browser/modernPanelCollector.test.mjs
```

Expected:

- build passes
- the test fails because `dist/functions/modernPanel/collectModernPanelOpportunities.js` does not exist yet

- [ ] **Step 3: Add the normalized types and collector implementation**

Create `src/functions/modernPanel/types.ts`.

```ts
import type {
    DailyCheckInPromotion,
    LevelBenefitsPromotion,
    LevelInfoPromotion,
    StreakBonusPromotion,
    StreakPromotion
} from '../../interface/PanelFlyoutData'

export type ModernPanelOpportunitySource = 'daily' | 'streak' | 'level'
export type ModernPanelOpportunityKind = 'quiz' | 'poll' | 'urlreward' | 'checkin' | 'info-only'
export type ModernPanelOpportunityDecision = 'auto' | 'skip'
export type ModernPanelOpportunityReason =
    | 'auto-executable'
    | 'duplicate-with-legacy-worker'
    | 'daily-check-in-web-entry-not-supported'
    | 'locked-feature'
    | 'info-card-without-action'
    | 'unsupported-promotion-type'

export type ModernPanelPromotion =
    | DailyCheckInPromotion
    | StreakPromotion
    | StreakBonusPromotion
    | LevelInfoPromotion
    | LevelBenefitsPromotion

export interface ModernPanelOpportunity {
    source: ModernPanelOpportunitySource
    kind: ModernPanelOpportunityKind
    decision: ModernPanelOpportunityDecision
    reason: ModernPanelOpportunityReason
    offerId: string
    title: string
    promotionType: string
    destinationUrl: string
    promotion: ModernPanelPromotion
}
```

Create `src/functions/modernPanel/collectModernPanelOpportunities.ts`.

```ts
import type { DashboardData } from '../../interface/DashboardData'
import type { PanelFlyoutData } from '../../interface/PanelFlyoutData'
import type {
    ModernPanelOpportunity,
    ModernPanelOpportunityKind,
    ModernPanelOpportunityReason,
    ModernPanelOpportunitySource,
    ModernPanelPromotion
} from './types'

function buildLegacyOfferIdSet(data: DashboardData): Set<string> {
    const seen = new Set<string>()

    for (const promotions of Object.values(data.dailySetPromotions ?? {})) {
        for (const promotion of promotions ?? []) {
            if (promotion?.offerId) seen.add(promotion.offerId)
        }
    }

    for (const promotion of [...(data.morePromotions ?? []), ...(data.morePromotionsWithoutPromotionalItems ?? [])]) {
        if (promotion?.offerId) seen.add(promotion.offerId)
    }

    return seen
}

function classifyOpportunity(
    source: ModernPanelOpportunitySource,
    promotion: ModernPanelPromotion,
    legacyOfferIds: Set<string>
): ModernPanelOpportunity {
    const offerId = promotion.offerId ?? ''
    const title = promotion.title ?? ''
    const promotionType = (promotion.promotionType ?? '').toLowerCase()
    const destinationUrl = promotion.destinationUrl ?? ''
    const isLocked = promotion.exclusiveLockedFeatureStatus === 'locked'
    const hasPoints = (promotion.pointProgressMax ?? 0) > 0

    let kind: ModernPanelOpportunityKind = 'info-only'
    let reason: ModernPanelOpportunityReason = 'info-card-without-action'
    let decision: 'auto' | 'skip' = 'skip'

    if (legacyOfferIds.has(offerId)) {
        reason = 'duplicate-with-legacy-worker'
    } else if (source === 'daily' && offerId === (promotion.offerId ?? '')) {
        kind = 'checkin'
        reason = 'daily-check-in-web-entry-not-supported'
    } else if (isLocked) {
        reason = 'locked-feature'
    } else if (promotionType === 'quiz' && hasPoints) {
        kind = destinationUrl.toLowerCase().includes('pollscenarioid') ? 'poll' : 'quiz'
        decision = 'auto'
        reason = 'auto-executable'
    } else if (promotionType === 'urlreward' && hasPoints && promotion.hash && promotion.activityType) {
        kind = 'urlreward'
        decision = 'auto'
        reason = 'auto-executable'
    } else if (promotionType && promotionType !== 'urlreward' && promotionType !== 'quiz') {
        reason = 'unsupported-promotion-type'
    }

    return {
        source,
        kind,
        decision,
        reason,
        offerId,
        title,
        promotionType,
        destinationUrl,
        promotion
    }
}

export function collectModernPanelOpportunities(
    panelData: PanelFlyoutData,
    data: DashboardData
): ModernPanelOpportunity[] {
    const flyout = panelData.flyoutResult
    const legacyOfferIds = buildLegacyOfferIdSet(data)
    const collected: ModernPanelOpportunity[] = []
    const pushIfPresent = (source: ModernPanelOpportunitySource, promotion?: ModernPanelPromotion | null) => {
        if (!promotion?.offerId) return
        collected.push(classifyOpportunity(source, promotion, legacyOfferIds))
    }

    pushIfPresent('daily', flyout?.dailyCheckInPromotion)
    pushIfPresent('streak', flyout?.streakPromotion)

    for (const promotion of flyout?.streakBonusPromotions ?? []) {
        pushIfPresent('streak', promotion)
    }

    pushIfPresent('level', flyout?.levelInfoPromotion)
    pushIfPresent('level', flyout?.levelBenefitsPromotion)

    return collected
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run build
node --test tests/browser/modernPanelCollector.test.mjs
```

Expected:

- build passes
- the collector test passes and classifies all five fixture entries as expected

- [ ] **Step 5: Commit**

```bash
git add src/functions/modernPanel/types.ts src/functions/modernPanel/collectModernPanelOpportunities.ts tests/browser/modernPanelCollector.test.mjs
git commit -m "feat: classify modern panel opportunities"
```

### Task 2: Add Worker Routing Coverage For Modern Opportunities

**Files:**
- Create: `tests/browser/modernPanelWorker.test.mjs`
- Test: `tests/browser/modernPanelWorker.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/browser/modernPanelWorker.test.mjs`.

```js
import test from 'node:test'
import assert from 'node:assert/strict'

async function loadWorkers() {
    const mod = await import('../../dist/functions/Workers.js')
    return mod.Workers
}

function makePromotion(overrides = {}) {
    return {
        offerId: 'offer-1',
        title: 'promo',
        promotionType: 'urlreward',
        destinationUrl: 'https://rewards.microsoft.com/promo',
        pointProgressMax: 10,
        pointProgress: 0,
        activityProgress: 0,
        activityProgressMax: 10,
        complete: false,
        exclusiveLockedFeatureStatus: 'unlocked',
        hash: 'hash-1',
        activityType: 'activity',
        ...overrides
    }
}

function createBot(logs, overrides = {}) {
    return {
        isMobile: false,
        logger: {
            info(...args) {
                logs.push(['info', ...args])
            },
            debug(...args) {
                logs.push(['debug', ...args])
            },
            warn(...args) {
                logs.push(['warn', ...args])
            },
            error(...args) {
                logs.push(['error', ...args])
            }
        },
        utils: {
            getFormattedDate() {
                return '04/21/2026'
            },
            async wait() {},
            randomDelay() {
                return 0
            }
        },
        activities: {
            async doPoll() {},
            async doQuiz() {},
            async doSearchOnBing() {},
            async doDaily() {},
            async doFindClippy() {},
            async doDoubleSearchPoints() {}
        },
        ...overrides
    }
}

test('Workers.doModernPanelPromotions routes auto opportunities and logs skipped entries', async () => {
    const Workers = await loadWorkers()
    const logs = []
    let pollCalls = 0
    let dailyCalls = 0

    const bot = createBot(logs, {
        activities: {
            async doPoll(promotion, page) {
                pollCalls++
                assert.equal(promotion.offerId, 'streak-poll')
                assert.equal(page.tag, 'page')
            },
            async doQuiz() {
                throw new Error('unexpected quiz route')
            },
            async doDaily(promotion) {
                dailyCalls++
                assert.equal(promotion.offerId, 'level-benefit')
            },
            async doSearchOnBing() {},
            async doFindClippy() {},
            async doDoubleSearchPoints() {}
        }
    })

    const workers = new Workers(bot)

    await workers.doModernPanelPromotions(
        {
            flyoutResult: {
                dailyCheckInPromotion: makePromotion({
                    offerId: 'daily-checkin',
                    title: 'Daily check in'
                }),
                streakPromotion: makePromotion({
                    offerId: 'streak-poll',
                    title: 'Streak poll',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/?pollScenarioId=123'
                }),
                streakBonusPromotions: [],
                levelInfoPromotion: makePromotion({
                    offerId: 'level-info',
                    title: 'Level info',
                    pointProgressMax: 0
                }),
                levelBenefitsPromotion: makePromotion({
                    offerId: 'level-benefit',
                    title: 'Level benefit'
                })
            }
        },
        {
            dailySetPromotions: {},
            morePromotions: [],
            morePromotionsWithoutPromotionalItems: []
        },
        { tag: 'page' }
    )

    assert.equal(pollCalls, 1)
    assert.equal(dailyCalls, 1)
    assert.ok(logs.some(entry => entry.join(' ').includes('daily-check-in-web-entry-not-supported')))
    assert.ok(logs.some(entry => entry.join(' ').includes('info-card-without-action')))
})

test('Workers.doModernPanelPromotions forwards page to quiz opportunities', async () => {
    const Workers = await loadWorkers()
    const logs = []
    let receivedPage = null

    const bot = createBot(logs, {
        activities: {
            async doPoll() {
                throw new Error('unexpected poll route')
            },
            async doQuiz(promotion, page) {
                receivedPage = page
                assert.equal(promotion.offerId, 'level-quiz')
            },
            async doDaily() {},
            async doSearchOnBing() {},
            async doFindClippy() {},
            async doDoubleSearchPoints() {}
        }
    })

    const workers = new Workers(bot)
    const page = { tag: 'quiz-page' }

    await workers.doModernPanelPromotions(
        {
            flyoutResult: {
                streakBonusPromotions: [],
                levelBenefitsPromotion: makePromotion({
                    offerId: 'level-quiz',
                    title: 'Level quiz',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/level-quiz'
                })
            }
        },
        {
            dailySetPromotions: {},
            morePromotions: [],
            morePromotionsWithoutPromotionalItems: []
        },
        page
    )

    assert.equal(receivedPage, page)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build
node --test tests/browser/modernPanelWorker.test.mjs
```

Expected:

- build passes
- the tests fail because `Workers` does not yet expose `doModernPanelPromotions(...)`

- [ ] **Step 3: Implement the executor and worker entrypoint**

Create `src/functions/modernPanel/executeModernPanelOpportunities.ts`.

```ts
import type { Page } from 'patchright'
import type { BasePromotion } from '../../interface/DashboardData'
import type { MicrosoftRewardsBot } from '../../index'
import type { ModernPanelOpportunity } from './types'

export async function executeModernPanelOpportunities(
    bot: MicrosoftRewardsBot,
    opportunities: ModernPanelOpportunity[],
    page: Page
): Promise<void> {
    const autoCount = opportunities.filter(item => item.decision === 'auto').length
    const skipCount = opportunities.length - autoCount

    bot.logger.info(
        bot.isMobile,
        'MODERN-PANEL',
        `识别到 ${opportunities.length} 个 modern-only 机会 | auto=${autoCount} | skip=${skipCount}`
    )

    for (const opportunity of opportunities) {
        bot.logger.info(
            bot.isMobile,
            'MODERN-ACTIVITY',
            `来源=${opportunity.source} | offerId=${opportunity.offerId} | 类型=${opportunity.promotionType} | decision=${opportunity.decision} | reason=${opportunity.reason}`
        )

        if (opportunity.decision === 'skip') continue

        const promotion = opportunity.promotion as unknown as BasePromotion

        switch (opportunity.kind) {
            case 'poll':
                await bot.activities.doPoll(promotion, page)
                break
            case 'quiz':
                await bot.activities.doQuiz(promotion, page)
                break
            case 'urlreward':
                await bot.activities.doDaily(promotion)
                break
            default:
                break
        }

        await bot.utils.wait(bot.utils.randomDelay(5000, 15000))
    }
}
```

Modify `src/functions/Workers.ts` to import the modern collector/executor and expose the new worker method.

```ts
import { collectModernPanelOpportunities } from './modernPanel/collectModernPanelOpportunities'
import { executeModernPanelOpportunities } from './modernPanel/executeModernPanelOpportunities'
import type { PanelFlyoutData } from '../interface/PanelFlyoutData'

public async doModernPanelPromotions(panelData: PanelFlyoutData, data: DashboardData, page: Page) {
    const opportunities = collectModernPanelOpportunities(panelData, data)

    if (!opportunities.length) {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-PANEL', '没有检测到额外的 modern-only 机会')
        return
    }

    await executeModernPanelOpportunities(this.bot, opportunities, page)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm run build
node --test tests/browser/modernPanelCollector.test.mjs tests/browser/modernPanelWorker.test.mjs
```

Expected:

- build passes
- worker tests pass
- collector regression still passes

- [ ] **Step 5: Commit**

```bash
git add src/functions/modernPanel/executeModernPanelOpportunities.ts src/functions/Workers.ts tests/browser/modernPanelWorker.test.mjs
git commit -m "feat: execute modern panel opportunities"
```

### Task 3: Wire The Modern Worker Into The Main Flow

**Files:**
- Modify: `src/index.ts`
- Test: `tests/browser/modernPanelCollector.test.mjs`
- Test: `tests/browser/modernPanelWorker.test.mjs`
- Test: `tests/browser/modernDashboardAdapter.test.mjs`
- Test: `tests/browser/pollAndQuizDispatch.test.mjs`

- [ ] **Step 1: Add the integration change**

Update the existing worker sequence in `src/index.ts` so the modern-only worker runs after current web promotion workers and before search execution.

```ts
if (this.config.workers.doAppPromotions) await this.workers.doAppPromotions(appData)
if (this.config.workers.doDailySet) await this.workers.doDailySet(data, this.mainMobilePage)
if (this.config.workers.doSpecialPromotions) await this.workers.doSpecialPromotions(data)
if (this.config.workers.doMorePromotions) await this.workers.doMorePromotions(data, this.mainMobilePage)
if (this.config.workers.doDailyCheckIn) await this.activities.doDailyCheckIn()
if (this.config.workers.doReadToEarn) await this.activities.doReadToEarn()
if (this.config.workers.doPunchCards) await this.workers.doPunchCards(data, this.mainMobilePage)
if (this.rewardsVersion === 'modern' && this.panelData) {
    await this.workers.doModernPanelPromotions(this.panelData, data, this.mainMobilePage)
}
```

- [ ] **Step 2: Run the focused regression set**

Run:

```bash
npm run build
node --test tests/browser/modernPanelCollector.test.mjs
node --test tests/browser/modernPanelWorker.test.mjs
node --test tests/browser/modernDashboardAdapter.test.mjs
node --test tests/browser/pollAndQuizDispatch.test.mjs
```

Expected:

- build passes
- all four browser test files pass
- the new modern path does not break the existing adapter or poll/quiz routing

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire modern panel opportunities into main flow"
```

### Task 4: Final Verification And Cleanup

**Files:**
- Test: `tests/browser/modernPanelCollector.test.mjs`
- Test: `tests/browser/modernPanelWorker.test.mjs`
- Test: `tests/browser/modernDashboardAdapter.test.mjs`
- Test: `tests/browser/pollAndQuizDispatch.test.mjs`
- Test: `tests/browser/quizEightQuestion.test.mjs`

- [ ] **Step 1: Run the full targeted verification set**

Run:

```bash
npm run build
node --test tests/browser/modernPanelCollector.test.mjs
node --test tests/browser/modernPanelWorker.test.mjs
node --test tests/browser/modernDashboardAdapter.test.mjs
node --test tests/browser/pollAndQuizDispatch.test.mjs
node --test tests/browser/quizEightQuestion.test.mjs
```

Expected:

- build passes
- all five targeted browser test files pass

- [ ] **Step 2: Review logs and code for scope discipline**

Check that the implementation still obeys the spec:

- `dailyCheckInPromotion` is identified and skipped with `daily-check-in-web-entry-not-supported`
- `levelInfoPromotion` is identified and skipped as `info-only`
- only `quiz`, `poll`, and `urlreward` opportunities are auto-executed
- no new webpage-specific check-in automation was introduced
- no legacy worker path was removed

- [ ] **Step 3: Record final evidence**

Capture the exact verification commands and outcomes in the implementation notes or handoff message:

- `npm run build`
- `node --test tests/browser/modernPanelCollector.test.mjs`
- `node --test tests/browser/modernPanelWorker.test.mjs`
- `node --test tests/browser/modernDashboardAdapter.test.mjs`
- `node --test tests/browser/pollAndQuizDispatch.test.mjs`
- `node --test tests/browser/quizEightQuestion.test.mjs`
