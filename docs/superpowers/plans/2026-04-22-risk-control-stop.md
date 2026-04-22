# Risk Control Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect high-confidence Microsoft Rewards risk-control prompts and stop the entire run immediately instead of continuing with other accounts.

**Architecture:** Add one focused browser-side detector plus one dedicated fatal error type, then thread that error through the existing login/search/activity flow so single-process mode aborts cleanly and cluster mode escalates a worker hit into a primary-process shutdown. Keep selectors/phrases centralized, reuse existing `logger.alert(...)` and browser cleanup, and cover the behavior with small browser-style tests plus one run-loop regression test.

**Tech Stack:** TypeScript, Patchright page objects, existing cluster IPC in `src/index.ts`, Zod config validation, `node:test`

---

## File Map

- Create: `src/browser/RiskControlDetector.ts`
  - Centralized selector/text detection and the dedicated `RiskControlDetectedError`
- Create: `tests/browser/riskControlDetector.test.mjs`
  - Unit-style detector coverage
- Create: `tests/browser/riskControlRunStop.test.mjs`
  - Single-process fatal-stop regression coverage
- Modify: `src/constants.ts`
  - Centralized selectors/text lists and stage labels
- Modify: `src/interface/Config.ts`
  - Add `riskControlStop.enabled`
- Modify: `src/util/Validator.ts`
  - Validate the new config shape
- Modify: `src/config.example.json`
  - Add the default-enabled config block
- Modify: `src/browser/BrowserUtils.ts`
  - Add a thin helper that runs the detector against a `Page` and throws on hit
- Modify: `src/index.ts`
  - Integrate detector at login/dashboard checkpoints, add single-process fatal propagation, add cluster-wide stop coordination
- Modify: `src/functions/SearchManager.ts`
  - Check before and after mobile/desktop searches
- Modify: `src/functions/activities/api/Quiz.ts`
  - Check browser-quiz landing pages
- Modify: `src/functions/activities/browser/Poll.ts`
  - Check poll landing pages
- Modify: `src/functions/activities/browser/OpenUrlReward.ts`
  - Check browser urlreward landing pages
- Modify: `src/functions/activities/browser/SearchOnBing.ts`
  - Check Search-on-Bing landing/result pages

## Task 1: Add the Detector, Fatal Error, and Config Surface

**Files:**
- Create: `src/browser/RiskControlDetector.ts`
- Modify: `src/constants.ts`
- Modify: `src/interface/Config.ts`
- Modify: `src/util/Validator.ts`
- Modify: `src/config.example.json`
- Test: `tests/browser/riskControlDetector.test.mjs`

- [ ] **Step 1: Write the failing detector test**

Create `tests/browser/riskControlDetector.test.mjs` with focused fake-page coverage:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

async function loadDetector() {
    const mod = await import('../../dist/browser/RiskControlDetector.js')
    return {
        detectRiskControlPrompt: mod.detectRiskControlPrompt,
        RiskControlDetectedError: mod.RiskControlDetectedError
    }
}

function createPage({ content = '', visibleSelectors = {} } = {}) {
    return {
        async content() {
            return content
        },
        locator(selector) {
            return {
                async count() {
                    return visibleSelectors[selector] ? 1 : 0
                }
            }
        }
    }
}

test('detectRiskControlPrompt matches explicit selectors before scanning page text', async () => {
    const { detectRiskControlPrompt } = await loadDetector()
    const page = createPage({
        content: '<html><body><h1>normal page</h1></body></html>',
        visibleSelectors: { '#suspendedAccountHeader': true }
    })

    const hit = await detectRiskControlPrompt(page, {
        accountEmail: 'risk@example.com',
        stage: 'dashboard-after-login'
    })

    assert.equal(hit?.matchedSelector, '#suspendedAccountHeader')
    assert.match(hit?.message ?? '', /risk@example.com/)
})

test('detectRiskControlPrompt matches high-confidence text fallbacks', async () => {
    const { detectRiskControlPrompt } = await loadDetector()
    const page = createPage({
        content: '<html><body>Your Microsoft Rewards searches are temporarily limited because of unusual activity.</body></html>'
    })

    const hit = await detectRiskControlPrompt(page, {
        accountEmail: 'risk@example.com',
        stage: 'search-after-run'
    })

    assert.equal(hit?.matchedSelector ?? null, null)
    assert.match(hit?.matchedText ?? '', /unusual activity/i)
})

test('detectRiskControlPrompt ignores ordinary rewards pages', async () => {
    const { detectRiskControlPrompt } = await loadDetector()
    const page = createPage({
        content: '<html><body>Daily set complete. Keep searching with Bing.</body></html>'
    })

    const hit = await detectRiskControlPrompt(page, {
        accountEmail: 'ok@example.com',
        stage: 'dashboard-after-login'
    })

    assert.equal(hit, null)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run build
node --test tests/browser/riskControlDetector.test.mjs
```

Expected:

- Build succeeds
- Test fails with `ERR_MODULE_NOT_FOUND` for `../../dist/browser/RiskControlDetector.js`

- [ ] **Step 3: Add the detector module and config/types**

Create `src/browser/RiskControlDetector.ts`:

```ts
import type { Page } from 'patchright'
import { RISK_CONTROL_SELECTORS, RISK_CONTROL_TEXT_PATTERNS } from '../constants'

export interface RiskControlDetection {
    accountEmail: string
    stage: string
    matchedSelector: null | string
    matchedText: null | string
    message: string
}

export class RiskControlDetectedError extends Error {
    public readonly detection: RiskControlDetection

    constructor(detection: RiskControlDetection) {
        super(detection.message)
        this.name = 'RiskControlDetectedError'
        this.detection = detection
    }
}

export async function detectRiskControlPrompt(
    page: Page,
    input: { accountEmail: string; stage: string }
): Promise<null | RiskControlDetection> {
    for (const selector of RISK_CONTROL_SELECTORS) {
        const matched = await page
            .locator(selector)
            .count()
            .then(count => count > 0)
            .catch(() => false)

        if (matched) {
            return {
                accountEmail: input.accountEmail,
                stage: input.stage,
                matchedSelector: selector,
                matchedText: null,
                message: `${input.accountEmail} 在阶段 ${input.stage} 命中风控提示选择器 ${selector}，已停止运行`
            }
        }
    }

    const html = await page.content().catch(() => '')
    const normalized = html.toLowerCase()

    for (const pattern of RISK_CONTROL_TEXT_PATTERNS) {
        if (!normalized.includes(pattern.toLowerCase())) continue
        return {
            accountEmail: input.accountEmail,
            stage: input.stage,
            matchedSelector: null,
            matchedText: pattern,
            message: `${input.accountEmail} 在阶段 ${input.stage} 命中风控提示文案 "${pattern}"，已停止运行`
        }
    }

    return null
}
```

Modify `src/constants.ts`:

```ts
export const RISK_CONTROL_SELECTORS = [
  '#serviceAbuseLandingTitle',
  '#suspendedAccountHeader'
] as const

export const RISK_CONTROL_TEXT_PATTERNS = [
  'unusual activity',
  'temporarily limited',
  'earning limit',
  'restricted',
  'not following the rules',
  '异常行为',
  '暂停',
  '受限'
] as const
```

Modify `src/interface/Config.ts`:

```ts
export interface Config {
    // existing fields...
    quietHours?: ConfigQuietHours
    riskControlStop?: ConfigRiskControlStop
}

export interface ConfigRiskControlStop {
    enabled: boolean
}
```

Modify `src/util/Validator.ts`:

```ts
    quietHours: z
        .object({
            enabled: z.boolean(),
            start: z.string().regex(/^\d{1,2}:\d{2}$/, '需要 HH:MM 格式'),
            end: z.string().regex(/^\d{1,2}:\d{2}$/, '需要 HH:MM 格式')
        })
        .optional(),
    riskControlStop: z
        .object({
            enabled: z.boolean()
        })
        .optional()
```

Modify `src/config.example.json`:

```json
    "quietHours": {
        "enabled": false,
        "start": "01:00",
        "end": "06:00"
    },
    "riskControlStop": {
        "enabled": true
    },
    "searchSettings": {
```

- [ ] **Step 4: Run the detector test to verify it passes**

Run:

```bash
npm run build
node --test tests/browser/riskControlDetector.test.mjs
```

Expected:

- Build succeeds
- `3/3` detector tests pass

- [ ] **Step 5: Commit**

```bash
git add src/browser/RiskControlDetector.ts src/constants.ts src/interface/Config.ts src/util/Validator.ts src/config.example.json tests/browser/riskControlDetector.test.mjs
git commit -m "feat: add risk-control detector scaffold"
```

## Task 2: Add a Reusable Browser Helper and Wire Core Flow Checkpoints

**Files:**
- Modify: `src/browser/BrowserUtils.ts`
- Modify: `src/index.ts`
- Test: `tests/browser/riskControlRunStop.test.mjs`

- [ ] **Step 1: Write the failing single-process regression test**

Create `tests/browser/riskControlRunStop.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'

async function loadBotModule() {
    return await import('../../dist/index.js')
}

test('runTasks rethrows RiskControlDetectedError instead of continuing to the next account', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod
    const { RiskControlDetectedError } = await import('../../dist/browser/RiskControlDetector.js')

    const bot = new MicrosoftRewardsBot()
    bot.config = { ...bot.config, clusters: 1, riskControlStop: { enabled: true } }
    bot.logger = { info() {}, warn() {}, error() {}, debug() {}, alert() {} }

    let processed = []

    bot.Main = async (account) => {
        processed.push(account.email)
        if (account.email === 'first@example.com') {
            throw new RiskControlDetectedError({
                accountEmail: account.email,
                stage: 'dashboard-after-login',
                matchedSelector: '#suspendedAccountHeader',
                matchedText: null,
                message: 'stop now'
            })
        }
        return { initialPoints: 0, collectedPoints: 0 }
    }

    await assert.rejects(
        () => bot.runTasks(
            [
                { email: 'first@example.com', password: '', recoveryEmail: '', geoLocale: 'auto', langCode: 'zh', proxy: { proxyAxios: false, url: '', port: 0, username: '', password: '' }, saveFingerprint: { mobile: true, desktop: true } },
                { email: 'second@example.com', password: '', recoveryEmail: '', geoLocale: 'auto', langCode: 'zh', proxy: { proxyAxios: false, url: '', port: 0, username: '', password: '' }, saveFingerprint: { mobile: true, desktop: true } }
            ],
            Date.now()
        ),
        /stop now/
    )

    assert.deepEqual(processed, ['first@example.com'])
})
```

- [ ] **Step 2: Run the regression to verify it fails**

Run:

```bash
npm run build
node --test tests/browser/riskControlRunStop.test.mjs
```

Expected:

- Test fails because `runTasks()` currently swallows the account error and continues

- [ ] **Step 3: Add a reusable browser helper and core-flow checks**

Modify `src/browser/BrowserUtils.ts` to add one shared assertion helper:

```ts
import {
    detectRiskControlPrompt,
    RiskControlDetectedError
} from './RiskControlDetector'

    async assertNoRiskControlPrompt(
        page: Page,
        stage: string,
        accountEmail: string
    ): Promise<void> {
        if (this.bot.config.riskControlStop?.enabled === false) {
            return
        }

        const detection = await detectRiskControlPrompt(page, { stage, accountEmail })
        if (!detection) {
            return
        }

        this.bot.logger.alert(
            'main',
            'RISK-CONTROL-STOP',
            `${detection.message} | selector=${detection.matchedSelector ?? 'none'} | text=${detection.matchedText ?? 'none'}`
        )

        throw new RiskControlDetectedError(detection)
    }
```

Modify `src/index.ts` to reuse the helper in the existing mobile flow and to stop swallowing fatal risk-control errors:

```ts
import { RiskControlDetectedError } from './browser/RiskControlDetector'

// inside Main(), immediately after login:
await this.browser.utils.assertNoRiskControlPrompt(
    this.mainMobilePage,
    'dashboard-after-login',
    accountEmail
)

// remove the inline suspended-account locator block and replace it with the helper above

// inside runTasks():
            } catch (error) {
                if (error instanceof RiskControlDetectedError) {
                    throw error
                }

                const durationSeconds = ((Date.now() - accountStartTime) / 1000).toFixed(1)
                this.logger.error(
                    'main',
                    'ACCOUNT-ERROR',
                    `${accountEmail}: ${error instanceof Error ? error.message : String(error)}`
                )
                // keep the existing non-fatal stats push here
            }

// inside main():
    } catch (error) {
        rewardsBot.logger.error('main', 'MAIN-ERROR', error as Error)
        await flushAllWebhooks()
        process.exit(1)
    }
```

- [ ] **Step 4: Run the regression test to verify it passes**

Run:

```bash
npm run build
node --test tests/browser/riskControlRunStop.test.mjs
```

Expected:

- Build succeeds
- The run-stop regression passes

- [ ] **Step 5: Commit**

```bash
git add src/browser/BrowserUtils.ts src/index.ts tests/browser/riskControlRunStop.test.mjs
git commit -m "feat: stop single-process runs on risk-control prompts"
```

## Task 3: Wire Search and Browser Activity Checkpoints

**Files:**
- Modify: `src/functions/SearchManager.ts`
- Modify: `src/functions/activities/api/Quiz.ts`
- Modify: `src/functions/activities/browser/Poll.ts`
- Modify: `src/functions/activities/browser/OpenUrlReward.ts`
- Modify: `src/functions/activities/browser/SearchOnBing.ts`
- Test: `tests/browser/riskControlDetector.test.mjs`

- [ ] **Step 1: Extend the existing detector test with checkpoint-oriented coverage**

Append one focused helper test to `tests/browser/riskControlDetector.test.mjs`:

```js
test('detectRiskControlPrompt matches Chinese fallback text used on warning pages', async () => {
    const { detectRiskControlPrompt } = await loadDetector()
    const page = createPage({
        content: '<html><body>由于异常行为，你的搜索积分目前受限。</body></html>'
    })

    const hit = await detectRiskControlPrompt(page, {
        accountEmail: 'risk@example.com',
        stage: 'search-after-run'
    })

    assert.match(hit?.matchedText ?? '', /异常行为|受限/)
})
```

- [ ] **Step 2: Run the focused detector suite to verify the new test fails if Chinese text is not covered**

Run:

```bash
npm run build
node --test tests/browser/riskControlDetector.test.mjs
```

Expected:

- If the fallback list is still missing the needed phrase, the new test fails
- Otherwise, if the phrase is already covered, keep the test and continue without changing detector logic

- [ ] **Step 3: Add the runtime checkpoints**

Modify `src/functions/SearchManager.ts` in the mobile and desktop search wrappers:

```ts
                await this.bot.browser.utils.assertNoRiskControlPrompt(
                    this.bot.mainMobilePage,
                    'search-before-run',
                    accountEmail
                )
                const pointsEarned = await this.bot.activities.doSearch(data, this.bot.mainMobilePage, true)
                await this.bot.browser.utils.assertNoRiskControlPrompt(
                    this.bot.mainMobilePage,
                    'search-after-run',
                    accountEmail
                )
```

```ts
                await this.bot.browser.utils.assertNoRiskControlPrompt(
                    this.bot.mainDesktopPage,
                    'search-before-run',
                    accountEmail
                )
                const pointsEarned = await this.bot.activities.doSearch(data, this.bot.mainDesktopPage, false)
                await this.bot.browser.utils.assertNoRiskControlPrompt(
                    this.bot.mainDesktopPage,
                    'search-after-run',
                    accountEmail
                )
```

Modify `src/functions/activities/browser/Poll.ts`:

```ts
        if (destinationUrl) {
            await page.goto(destinationUrl).catch(() => {})
        }

        await this.bot.browser.utils.assertNoRiskControlPrompt(
            page,
            'poll-landing',
            this.bot.userData.userName || 'unknown-account'
        )
```

Modify `src/functions/activities/browser/OpenUrlReward.ts`:

```ts
        if (currentUrl !== destinationUrl) {
            await page.goto(destinationUrl).catch(() => {})
        }

        await this.bot.browser.utils.assertNoRiskControlPrompt(
            page,
            'urlreward-landing',
            this.bot.userData.userName || 'unknown-account'
        )
```

Modify `src/functions/activities/browser/SearchOnBing.ts`:

```ts
                await this.bot.mainMobilePage.goto(url)
                await this.bot.browser.utils.assertNoRiskControlPrompt(
                    page,
                    'search-on-bing-landing',
                    this.bot.userData.userName || 'unknown-account'
                )
```

Modify `src/functions/activities/api/Quiz.ts` in both browser-quiz paths:

```ts
        if (promotion.destinationUrl && currentUrl !== promotion.destinationUrl) {
            await page.goto(promotion.destinationUrl).catch((error) => {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'QUIZ',
                    `浏览器测验跳转失败 | offerId=${offerId} | url=${promotion.destinationUrl} | 消息=${error instanceof Error ? error.message : String(error)}`
                )
            })
        }

        await this.bot.browser.utils.assertNoRiskControlPrompt(
            page,
            'quiz-landing',
            this.bot.userData.userName || 'unknown-account'
        )
```

Use the account email from the current execution context if available; if `userName` is too lossy, switch the helper call sites to `getCurrentContext().account.email`.

- [ ] **Step 4: Run the detector suite and the existing browser suite**

Run:

```bash
npm run build
node --test tests/browser/riskControlDetector.test.mjs tests/browser/pollAndQuizDispatch.test.mjs tests/browser/openUrlReward.test.mjs tests/browser/quizEightQuestion.test.mjs
```

Expected:

- Risk-control detector tests pass
- Existing poll/urlreward/quiz browser tests still pass

- [ ] **Step 5: Commit**

```bash
git add src/functions/SearchManager.ts src/functions/activities/api/Quiz.ts src/functions/activities/browser/Poll.ts src/functions/activities/browser/OpenUrlReward.ts src/functions/activities/browser/SearchOnBing.ts tests/browser/riskControlDetector.test.mjs
git commit -m "feat: check risk-control prompts around browser activities"
```

## Task 4: Escalate a Worker Hit into a Cluster-Wide Shutdown

**Files:**
- Modify: `src/index.ts`
- Test: `tests/browser/riskControlRunStop.test.mjs`

- [ ] **Step 1: Add the failing cluster-coordination regression**

Append a focused helper-level test to `tests/browser/riskControlRunStop.test.mjs` by extracting a primary-side shutdown method first:

```js
test('handleRiskControlStop kills sibling workers only once', async () => {
    const mod = await loadBotModule()
    const { MicrosoftRewardsBot } = mod

    const bot = new MicrosoftRewardsBot()
    bot.logger = { info() {}, warn() {}, error() {}, debug() {}, alert() {} }

    const kills = []
    const workerA = { process: { pid: 111 }, kill(signal) { kills.push(['a', signal]) } }
    const workerB = { process: { pid: 222 }, kill(signal) { kills.push(['b', signal]) } }

    bot.beginRiskControlShutdown({
        accountEmail: 'risk@example.com',
        stage: 'search-after-run',
        matchedSelector: null,
        matchedText: 'unusual activity',
        message: 'risk hit'
    }, [workerA, workerB])

    bot.beginRiskControlShutdown({
        accountEmail: 'risk@example.com',
        stage: 'search-after-run',
        matchedSelector: null,
        matchedText: 'unusual activity',
        message: 'risk hit'
    }, [workerA, workerB])

    assert.deepEqual(kills, [['a', 'SIGTERM'], ['b', 'SIGTERM']])
})
```

- [ ] **Step 2: Run the regression to verify it fails**

Run:

```bash
npm run build
node --test tests/browser/riskControlRunStop.test.mjs
```

Expected:

- The new test fails because `beginRiskControlShutdown()` does not exist yet

- [ ] **Step 3: Implement one-shot cluster shutdown coordination**

Modify `src/index.ts`:

```ts
import { RiskControlDetectedError, type RiskControlDetection } from './browser/RiskControlDetector'

interface IpcRiskControlStop {
    detection: RiskControlDetection
}

export class MicrosoftRewardsBot {
    private riskControlStopping = false

    beginRiskControlShutdown(detection: RiskControlDetection, workers: Worker[]): void {
        if (this.riskControlStopping) {
            return
        }

        this.riskControlStopping = true
        this.logger.alert(
            'main',
            'RISK-CONTROL-STOP',
            `${detection.message} | selector=${detection.matchedSelector ?? 'none'} | text=${detection.matchedText ?? 'none'}`
        )

        for (const worker of workers) {
            try {
                worker.kill('SIGTERM')
            } catch {}
        }
    }
}
```

Then update the primary-side worker message handler:

```ts
            worker.on('message', (msg: {
                __ipcLog?: IpcLog
                __ipcAlert?: IpcAlert
                __stats?: AccountStats[]
                __riskControlStop?: IpcRiskControlStop
            }) => {
                if (msg.__riskControlStop?.detection) {
                    const workers = Object.values(cluster.workers ?? {}).filter(Boolean) as Worker[]
                    this.beginRiskControlShutdown(msg.__riskControlStop.detection, workers)
                    return
                }
                // existing stats / alert / log handling stays here
            })
```

Finally update `runWorker()`:

```ts
            } catch (error) {
                if (error instanceof RiskControlDetectedError) {
                    process.send?.({
                        __riskControlStop: {
                            detection: error.detection
                        }
                    })
                }

                this.logger.error(
                    'main',
                    'CLUSTER-WORKER-ERROR',
                    `工作进程任务崩溃: ${error instanceof Error ? error.message : String(error)}`
                )

                await flushAllWebhooks()
                process.exit(1)
            }
```

This keeps the worker simple: detect, report, flush, exit. The primary becomes the only place that fans the stop signal out to siblings.

- [ ] **Step 4: Run the regression plus the full browser suite**

Run:

```bash
npm run build
node --test tests/browser/riskControlRunStop.test.mjs tests/browser/*.test.mjs
```

Expected:

- Risk-control run-stop tests pass
- Existing browser suite remains green

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/browser/riskControlRunStop.test.mjs
git commit -m "feat: stop cluster runs on risk-control prompts"
```

## Task 5: Final Verification and Config Hygiene

**Files:**
- Modify: `src/config.example.json` if any key order or comments drifted during implementation
- Modify: any touched file only if verification reveals a mismatch

- [ ] **Step 1: Run the full verification set**

Run:

```bash
npm run build
node --test tests/browser/*.test.mjs
```

Expected:

- Build succeeds with exit code `0`
- All browser tests pass with `0` failures

- [ ] **Step 2: Manually inspect the resulting config surface**

Check:

```bash
rg -n "riskControlStop" src/interface/Config.ts src/util/Validator.ts src/config.example.json src/browser/BrowserUtils.ts src/index.ts
```

Expected:

- The new config exists in all five places
- `riskControlStop.enabled` defaults to `true` in `src/config.example.json`

- [ ] **Step 3: Verify spec coverage against the implementation**

Checklist:

```text
- Detector exists and centralizes selectors/text
- Single-process mode stops the whole run on a fatal risk hit
- Cluster mode escalates one worker hit into a global shutdown
- Search hooks run before/after search
- Browser activity landing pages run the detector
- Alert path is reused
```

If any item is missing, add the smallest follow-up patch before finishing.

- [ ] **Step 4: Commit the final cleanup**

```bash
git add src/config.example.json src/browser/RiskControlDetector.ts src/browser/BrowserUtils.ts src/constants.ts src/functions/SearchManager.ts src/functions/activities/api/Quiz.ts src/functions/activities/browser/Poll.ts src/functions/activities/browser/OpenUrlReward.ts src/functions/activities/browser/SearchOnBing.ts src/index.ts src/interface/Config.ts src/util/Validator.ts tests/browser/riskControlDetector.test.mjs tests/browser/riskControlRunStop.test.mjs
git commit -m "test: verify risk-control stop flow"
```

- [ ] **Step 5: Push or hand off**

If this branch is meant to be published:

```bash
git push origin HEAD
```

If this is staying local for review, stop here and summarize:

```text
Risk-control stop flow implemented, verified with npm run build and node --test tests/browser/*.test.mjs.
```

## Self-Review

- Spec coverage: all four spec requirements map cleanly to tasks:
  - detector + config surface: Task 1
  - single-process fatal stop: Task 2
  - key search/activity checkpoints: Task 3
  - cluster-wide shutdown: Task 4
  - verification and config sanity: Task 5
- Placeholder scan: no `TBD`, `TODO`, “similar to previous task”, or empty testing instructions remain
- Type consistency:
  - `RiskControlDetection` is introduced before any task references it
  - `RiskControlDetectedError` is defined before single-process/cluster tasks depend on it
  - `beginRiskControlShutdown()` is introduced in the cluster task before its regression test expects it
