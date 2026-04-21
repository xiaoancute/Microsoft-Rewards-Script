# Modern Panel Blank OfferId Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable identification and limited safe auto-execution for modern-panel cards whose upstream `offerId` is blank, while continuing to skip entries that still require a real `offerId`.

**Architecture:** Keep the existing modern panel collector/executor split. Extend the collector to emit a stable `opportunityKey`, classify blank-offerId cards into browser-safe vs API-required paths, and de-duplicate by synthetic identity. Keep execution routing narrow: only browser-safe `poll` and 8-question `quiz` entries with blank `offerId` can be auto-run; all other blank-offerId entries remain explicit skips with better reasons and logs.

**Tech Stack:** TypeScript, Patchright `Page`, Node.js `node:test`, existing modern panel collector/executor, `npm run build`

---

## File Map

- Modify: `src/functions/modernPanel/types.ts`
  - Add `opportunityKey` to `ModernPanelOpportunity`
  - Add new `ModernOpportunityReason` values for blank-offerId execution decisions
- Modify: `src/functions/modernPanel/collectModernPanelOpportunities.ts`
  - Build stable synthetic keys
  - Detect blank-offerId browser-safe poll / 8-question quiz entries
  - Skip API-required blank-offerId quiz/urlreward entries
  - De-duplicate modern opportunities by `opportunityKey`
- Modify: `src/functions/modernPanel/executeModernPanelOpportunities.ts`
  - Include `opportunityKey` in activity logs
  - Preserve existing routing, relying on collector decisions
- Modify: `tests/browser/modernPanelCollector.test.mjs`
  - Add red/green coverage for blank-offerId classification and de-duplication
- Modify: `tests/browser/modernPanelWorker.test.mjs`
  - Add red/green coverage for blank-offerId routing/logging

## Task 1: Add Collector Red Tests For Blank OfferId Classification

**Files:**
- Modify: `tests/browser/modernPanelCollector.test.mjs`
- Test: `tests/browser/modernPanelCollector.test.mjs`

- [ ] **Step 1: Write the failing tests for browser-safe and API-required blank-offerId cards**

Append these tests to `tests/browser/modernPanelCollector.test.mjs`.

```js
test('collectModernPanelOpportunities auto-runs blank-offerId poll and 8-question quiz entries with stable opportunity keys', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            streakPromotion: makePromotion({
                offerId: '   ',
                title: 'Blank Poll',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/task?pollScenarioId=101',
                pointProgressMax: 10,
                activityProgressMax: 10
            }),
            streakBonusPromotions: [
                makePromotion({
                    offerId: '   ',
                    title: 'Blank Eight Quiz',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/quiz/eight',
                    pointProgressMax: 10,
                    activityProgressMax: 80
                })
            ]
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const blankPoll = opportunities.find((item) => item.title === 'Blank Poll')
    assert.ok(blankPoll)
    assert.equal(blankPoll.offerId, null)
    assert.equal(blankPoll.offerIdState, 'blank')
    assert.equal(blankPoll.kind, 'poll')
    assert.equal(blankPoll.decision, 'auto')
    assert.equal(blankPoll.reason, 'auto-executable-without-offerid')
    assert.match(blankPoll.opportunityKey, /^streak\|poll\|quiz\|https:\/\/rewards\.bing\.com\/task\?pollscenarioid=101\|blank poll\|unknown$/)

    const blankEightQuiz = opportunities.find((item) => item.title === 'Blank Eight Quiz')
    assert.ok(blankEightQuiz)
    assert.equal(blankEightQuiz.offerId, null)
    assert.equal(blankEightQuiz.offerIdState, 'blank')
    assert.equal(blankEightQuiz.kind, 'quiz')
    assert.equal(blankEightQuiz.decision, 'auto')
    assert.equal(blankEightQuiz.reason, 'auto-executable-without-offerid')
    assert.match(blankEightQuiz.opportunityKey, /^streak\|quiz\|quiz\|https:\/\/rewards\.bing\.com\/quiz\/eight\|blank eight quiz\|unknown$/)
})

test('collectModernPanelOpportunities skips blank-offerId standard quiz and urlreward entries that still require API execution', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const panelData = {
        flyoutResult: {
            streakPromotion: makePromotion({
                offerId: '   ',
                title: 'Blank Standard Quiz',
                promotionType: 'quiz',
                destinationUrl: 'https://rewards.bing.com/quiz/standard',
                pointProgressMax: 30,
                activityProgressMax: 30
            }),
            levelBenefitsPromotion: makePromotion({
                offerId: '   ',
                title: 'Blank UrlReward',
                promotionType: 'urlreward',
                destinationUrl: 'https://rewards.bing.com/level-benefits',
                pointProgressMax: 10,
                activityProgressMax: 10
            })
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const blankStandardQuiz = opportunities.find((item) => item.title === 'Blank Standard Quiz')
    assert.ok(blankStandardQuiz)
    assert.equal(blankStandardQuiz.kind, 'quiz')
    assert.equal(blankStandardQuiz.decision, 'skip')
    assert.equal(blankStandardQuiz.reason, 'missing-offerid-requires-api-execution')

    const blankUrlReward = opportunities.find((item) => item.title === 'Blank UrlReward')
    assert.ok(blankUrlReward)
    assert.equal(blankUrlReward.kind, 'urlreward')
    assert.equal(blankUrlReward.decision, 'skip')
    assert.equal(blankUrlReward.reason, 'missing-offerid-requires-api-execution')
})

test('collectModernPanelOpportunities de-duplicates blank-offerId cards by opportunityKey', async () => {
    const { collectModernPanelOpportunities } = await loadCollector()

    const duplicatePoll = makePromotion({
        offerId: '   ',
        title: 'Duplicate Blank Poll',
        promotionType: 'quiz',
        destinationUrl: 'https://rewards.bing.com/task?pollScenarioId=500',
        pointProgressMax: 10,
        activityProgressMax: 10
    })

    const panelData = {
        flyoutResult: {
            streakPromotion: duplicatePoll,
            streakBonusPromotions: [
                {
                    ...duplicatePoll,
                    pointProgressMax: 0,
                    activityProgressMax: 0
                }
            ]
        }
    }

    const opportunities = collectModernPanelOpportunities(panelData, {
        morePromotions: [],
        dailySetPromotions: {},
        morePromotionsWithoutPromotionalItems: []
    })

    const duplicates = opportunities.filter((item) => item.title === 'Duplicate Blank Poll')
    assert.equal(duplicates.length, 1)
    assert.equal(duplicates[0].decision, 'auto')
    assert.equal(duplicates[0].reason, 'auto-executable-without-offerid')
})
```

- [ ] **Step 2: Run the collector tests and confirm the new cases fail**

Run:

```bash
npm run build
node --test tests/browser/modernPanelCollector.test.mjs
```

Expected:

- `npm run build` passes
- the new collector assertions fail because `opportunityKey` and the new reasons do not exist yet

- [ ] **Step 3: Commit the red test changes**

Run:

```bash
git add tests/browser/modernPanelCollector.test.mjs
git commit -m "test: cover blank offerId modern collector"
```

## Task 2: Implement Blank OfferId Collector Semantics

**Files:**
- Modify: `src/functions/modernPanel/types.ts`
- Modify: `src/functions/modernPanel/collectModernPanelOpportunities.ts`
- Test: `tests/browser/modernPanelCollector.test.mjs`

- [ ] **Step 1: Extend modern opportunity types with key/reason support**

Update `src/functions/modernPanel/types.ts` to add the new reasons and `opportunityKey`.

```ts
export enum ModernOpportunityReason {
    AutoExecutable = 'auto-executable',
    AutoExecutableWithoutOfferId = 'auto-executable-without-offerid',
    DailyCheckInWebEntryNotSupported = 'daily-check-in-web-entry-not-supported',
    DuplicateWithLegacyWorker = 'duplicate-with-legacy-worker',
    InfoCardWithoutAction = 'info-card-without-action',
    LockedFeature = 'locked-feature',
    MissingOfferIdRequiresApiExecution = 'missing-offerid-requires-api-execution',
    UnsupportedPromotionType = 'unsupported-promotion-type'
}

export interface ModernPanelOpportunity {
    source: ModernOpportunitySource
    kind: ModernOpportunityKind
    decision: ModernOpportunityDecision
    reason: ModernOpportunityReason
    offerId: null | string
    offerIdState: ModernOpportunityFieldState
    opportunityKey: string
    promotionType: null | string
    promotionTypeState: ModernOpportunityFieldState
    destinationUrl: null | string
    title: null | string
    promotion: unknown
}
```

- [ ] **Step 2: Add collector helpers for stable key generation and blank-offerId execution checks**

Add these helpers near the other normalization helpers in `src/functions/modernPanel/collectModernPanelOpportunities.ts`.

```ts
function getLockedStatus(promotion: PromotionLike): null | string {
    return normalizeStringField(promotion.exclusiveLockedFeatureStatus, value => value.toLowerCase()).value
}

function isBlankOfferIdField(field: NormalizedStringField): boolean {
    return (
        field.state === ModernOpportunityFieldState.Blank ||
        field.state === ModernOpportunityFieldState.Missing ||
        field.state === ModernOpportunityFieldState.InvalidType
    )
}

function isEightQuestionQuizPromotion(promotion: PromotionLike): boolean {
    return getPromotionType(promotion) === 'quiz' && (getNumeric(promotion.activityProgressMax) ?? 0) === 80
}

function hasValidDestination(promotion: PromotionLike): boolean {
    return !!getDestinationUrl(promotion)
}

function keyPart(value: null | string): string {
    return value ? value.trim().toLowerCase() : 'unknown'
}

function buildOpportunityKey(
    source: ModernOpportunitySource,
    kind: ModernOpportunityKind,
    offerId: null | string,
    promotionType: null | string,
    destinationUrl: null | string,
    title: null | string,
    lockedStatus: null | string
): string {
    if (offerId) {
        return `offer:${offerId.trim().toLowerCase()}`
    }

    return [
        source,
        kind,
        keyPart(promotionType),
        keyPart(destinationUrl),
        keyPart(title),
        keyPart(lockedStatus)
    ].join('|')
}
```

- [ ] **Step 3: Update classification so only browser-safe blank-offerId cards auto-run**

Replace `classifyOpportunity(...)` with this version in `src/functions/modernPanel/collectModernPanelOpportunities.ts`.

```ts
function classifyOpportunity(
    source: ModernOpportunitySource,
    promotion: PromotionLike,
    offerIdField: NormalizedStringField
): Pick<ModernPanelOpportunity, 'decision' | 'reason'> {
    if (source === ModernOpportunitySource.Daily) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.DailyCheckInWebEntryNotSupported
        }
    }

    if (source === ModernOpportunitySource.Level && isInfoCardWithoutAction(promotion)) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.InfoCardWithoutAction
        }
    }

    if (getComplete(promotion)) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.UnsupportedPromotionType
        }
    }

    if (isLockedPromotion(promotion)) {
        return {
            decision: ModernOpportunityDecision.Skip,
            reason: ModernOpportunityReason.LockedFeature
        }
    }

    const blankOfferId = isBlankOfferIdField(offerIdField)
    const positiveActionability = hasPositiveActionability(promotion)

    if (blankOfferId && positiveActionability) {
        if (isPollPromotion(promotion)) {
            return {
                decision: ModernOpportunityDecision.Auto,
                reason: ModernOpportunityReason.AutoExecutableWithoutOfferId
            }
        }

        if (isEightQuestionQuizPromotion(promotion) && hasValidDestination(promotion)) {
            return {
                decision: ModernOpportunityDecision.Auto,
                reason: ModernOpportunityReason.AutoExecutableWithoutOfferId
            }
        }

        if (isQuizPromotion(promotion) || getPromotionType(promotion) === 'urlreward') {
            return {
                decision: ModernOpportunityDecision.Skip,
                reason: ModernOpportunityReason.MissingOfferIdRequiresApiExecution
            }
        }
    }

    const autoQuizOrPoll = (isPollPromotion(promotion) || isQuizPromotion(promotion)) && positiveActionability
    const autoUrlReward = isValidUrlRewardPromotion(promotion) && positiveActionability

    if (autoQuizOrPoll || autoUrlReward) {
        return {
            decision: ModernOpportunityDecision.Auto,
            reason: ModernOpportunityReason.AutoExecutable
        }
    }

    return {
        decision: ModernOpportunityDecision.Skip,
        reason: ModernOpportunityReason.UnsupportedPromotionType
    }
}
```

- [ ] **Step 4: Populate `opportunityKey` and de-duplicate by synthetic identity**

Update `toOpportunity(...)` and the collector return path in `src/functions/modernPanel/collectModernPanelOpportunities.ts`.

```ts
function preferOpportunity(
    left: ModernPanelOpportunity,
    right: ModernPanelOpportunity
): ModernPanelOpportunity {
    if (left.decision !== right.decision) {
        return left.decision === ModernOpportunityDecision.Auto ? left : right
    }

    if (left.kind !== right.kind) {
        return left.kind !== ModernOpportunityKind.InfoOnly ? left : right
    }

    return left
}

function dedupeOpportunities(opportunities: ModernPanelOpportunity[]): ModernPanelOpportunity[] {
    const seen = new Map<string, ModernPanelOpportunity>()

    for (const opportunity of opportunities) {
        const current = seen.get(opportunity.opportunityKey)
        seen.set(opportunity.opportunityKey, current ? preferOpportunity(current, opportunity) : opportunity)
    }

    return [...seen.values()]
}

function toOpportunity(
    source: ModernOpportunitySource,
    promotion: PromotionLike | null | undefined,
    legacyOfferIds: Set<string>
): null | ModernPanelOpportunity {
    if (!promotion || typeof promotion !== 'object') {
        return null
    }

    const offerIdField = getOfferIdField(promotion)
    const promotionTypeField = getPromotionTypeField(promotion)
    const offerId = offerIdField.value
    const kind = inferKind(source, promotion)
    const initialClassification = classifyOpportunity(source, promotion, offerIdField)
    const duplicateWithLegacyWorker = !!offerId && legacyOfferIds.has(offerId)
    const lockedStatus = getLockedStatus(promotion)

    return {
        source,
        kind,
        decision: duplicateWithLegacyWorker ? ModernOpportunityDecision.Skip : initialClassification.decision,
        reason: duplicateWithLegacyWorker ? ModernOpportunityReason.DuplicateWithLegacyWorker : initialClassification.reason,
        offerId,
        offerIdState: offerIdField.state,
        opportunityKey: buildOpportunityKey(
            source,
            kind,
            offerId,
            promotionTypeField.value,
            getDestinationUrl(promotion),
            normalizeString(promotion.title),
            lockedStatus
        ),
        promotionType: promotionTypeField.value,
        promotionTypeState: promotionTypeField.state,
        destinationUrl: getDestinationUrl(promotion),
        title: normalizeString(promotion.title),
        promotion
    }
}

export function collectModernPanelOpportunities(
    panelData: PanelFlyoutData | null | undefined,
    legacyDashboardData?: LegacyOfferSources | null
): ModernPanelOpportunity[] {
    const legacyOfferIds = collectLegacyOfferIds(legacyDashboardData)
    const streakBonusPromotions = panelData?.flyoutResult?.streakBonusPromotions ?? []

    const candidates = [
        toOpportunity(ModernOpportunitySource.Daily, panelData?.flyoutResult?.dailyCheckInPromotion, legacyOfferIds),
        toOpportunity(ModernOpportunitySource.Streak, panelData?.flyoutResult?.streakPromotion, legacyOfferIds),
        ...streakBonusPromotions.map((promotion) =>
            toOpportunity(ModernOpportunitySource.Streak, promotion, legacyOfferIds)
        ),
        toOpportunity(ModernOpportunitySource.Level, panelData?.flyoutResult?.levelInfoPromotion, legacyOfferIds),
        toOpportunity(ModernOpportunitySource.Level, panelData?.flyoutResult?.levelBenefitsPromotion, legacyOfferIds)
    ].filter((item): item is ModernPanelOpportunity => item !== null)

    return dedupeOpportunities(candidates)
}
```

- [ ] **Step 5: Run collector tests until they pass**

Run:

```bash
npm run build
node --test tests/browser/modernPanelCollector.test.mjs
```

Expected:

- build passes
- all collector tests pass, including the new blank-offerId cases

- [ ] **Step 6: Commit the collector implementation**

Run:

```bash
git add src/functions/modernPanel/types.ts src/functions/modernPanel/collectModernPanelOpportunities.ts tests/browser/modernPanelCollector.test.mjs
git commit -m "feat: classify blank offerId modern opportunities"
```

## Task 3: Add Worker Red Tests For Blank OfferId Routing And Logging

**Files:**
- Modify: `tests/browser/modernPanelWorker.test.mjs`
- Test: `tests/browser/modernPanelWorker.test.mjs`

- [ ] **Step 1: Write the failing worker tests**

Append these tests to `tests/browser/modernPanelWorker.test.mjs`.

```js
test('Workers.doModernPanelPromotions routes blank-offerId poll cards through browser execution', async () => {
    const Workers = await loadWorkers()
    const { bot, logs, dispatchCalls, getWaitCalls, getRandomDelayCalls } = createBot()
    const workers = new Workers(bot)
    const page = { tag: 'modern-page' }

    await workers.doModernPanelPromotions(
        {
            flyoutResult: {
                streakPromotion: makePromotion({
                    offerId: '   ',
                    title: 'Blank Poll',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/task?pollScenarioId=101',
                    pointProgressMax: 10,
                    activityProgressMax: 10
                })
            }
        },
        {
            morePromotions: [],
            dailySetPromotions: {},
            morePromotionsWithoutPromotionalItems: []
        },
        page
    )

    assert.deepEqual(dispatchCalls, [['poll', '   ', page]])
    assert.equal(getWaitCalls(), 1)
    assert.equal(getRandomDelayCalls(), 1)

    const modernActivityLogs = logs
        .filter((entry) => entry[0] === 'info' && entry[1] === false && entry[2] === 'MODERN-ACTIVITY')
        .map((entry) => entry[3])

    assert.equal(modernActivityLogs.length, 1)
    assert.match(modernActivityLogs[0], /offerId=unknown/)
    assert.match(modernActivityLogs[0], /reason=auto-executable-without-offerid/)
    assert.match(modernActivityLogs[0], /opportunityKey=streak\|poll\|quiz\|https:\/\/rewards\.bing\.com\/task\?pollscenarioid=101\|blank poll\|unknown/)
})

test('Workers.doModernPanelPromotions keeps blank-offerId api-required quiz cards skipped', async () => {
    const Workers = await loadWorkers()
    const { bot, logs, dispatchCalls, getWaitCalls, getRandomDelayCalls } = createBot()
    const workers = new Workers(bot)

    await workers.doModernPanelPromotions(
        {
            flyoutResult: {
                streakPromotion: makePromotion({
                    offerId: '   ',
                    title: 'Blank Standard Quiz',
                    promotionType: 'quiz',
                    destinationUrl: 'https://rewards.bing.com/quiz/standard',
                    pointProgressMax: 30,
                    activityProgressMax: 30
                })
            }
        },
        {
            morePromotions: [],
            dailySetPromotions: {},
            morePromotionsWithoutPromotionalItems: []
        },
        { tag: 'modern-page' }
    )

    assert.deepEqual(dispatchCalls, [])
    assert.equal(getWaitCalls(), 0)
    assert.equal(getRandomDelayCalls(), 0)

    const modernActivityLogs = logs
        .filter((entry) => entry[0] === 'info' && entry[1] === false && entry[2] === 'MODERN-ACTIVITY')
        .map((entry) => entry[3])

    assert.equal(modernActivityLogs.length, 1)
    assert.match(modernActivityLogs[0], /offerIdState=blank/)
    assert.match(modernActivityLogs[0], /reason=missing-offerid-requires-api-execution/)
    assert.match(modernActivityLogs[0], /opportunityKey=streak\|quiz\|quiz\|https:\/\/rewards\.bing\.com\/quiz\/standard\|blank standard quiz\|unknown/)
})
```

- [ ] **Step 2: Run the worker tests and confirm the new cases fail**

Run:

```bash
npm run build
node --test tests/browser/modernPanelWorker.test.mjs
```

Expected:

- build passes
- the new worker assertions fail because logs do not include `opportunityKey` and the new reasons yet

- [ ] **Step 3: Commit the red worker tests**

Run:

```bash
git add tests/browser/modernPanelWorker.test.mjs
git commit -m "test: cover blank offerId modern worker"
```

## Task 4: Add Opportunity-Key Logging And Green The Worker Tests

**Files:**
- Modify: `src/functions/modernPanel/executeModernPanelOpportunities.ts`
- Test: `tests/browser/modernPanelWorker.test.mjs`

- [ ] **Step 1: Log `opportunityKey` in modern activity lines**

Update the per-opportunity log line in `src/functions/modernPanel/executeModernPanelOpportunities.ts`.

```ts
bot.logger.info(
    bot.isMobile,
    'MODERN-ACTIVITY',
    `source=${opportunity.source} | offerId=${opportunity.offerId ?? 'unknown'} | offerIdState=${opportunity.offerIdState} | opportunityKey=${opportunity.opportunityKey} | promotionType=${opportunity.promotionType ?? 'unknown'} | promotionTypeState=${opportunity.promotionTypeState} | decision=${opportunity.decision} | reason=${opportunity.reason}`
)
```

- [ ] **Step 2: Run the worker tests until they pass**

Run:

```bash
npm run build
node --test tests/browser/modernPanelWorker.test.mjs
```

Expected:

- build passes
- all worker tests pass, including the new blank-offerId routing/logging coverage

- [ ] **Step 3: Commit the executor/logging changes**

Run:

```bash
git add src/functions/modernPanel/executeModernPanelOpportunities.ts tests/browser/modernPanelWorker.test.mjs
git commit -m "feat: log blank offerId modern opportunities"
```

## Task 5: Run Full Verification And Optional Real Smoke

**Files:**
- Modify: none
- Test: `tests/browser/modernPanelCollector.test.mjs`
- Test: `tests/browser/modernPanelWorker.test.mjs`
- Test: `tests/browser/modernDashboardAdapter.test.mjs`
- Test: `tests/browser/pollAndQuizDispatch.test.mjs`
- Test: `tests/browser/quizEightQuestion.test.mjs`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
npm run build
node --test tests/browser/modernPanelCollector.test.mjs tests/browser/modernPanelWorker.test.mjs tests/browser/modernDashboardAdapter.test.mjs tests/browser/pollAndQuizDispatch.test.mjs tests/browser/quizEightQuestion.test.mjs
```

Expected:

- build passes
- all five test files pass

- [ ] **Step 2: Run a minimal real-account smoke and stop after modern-panel logs**

Run:

```bash
npm run ts-start
```

Expected:

- `GET-REWARD-SESSION` still reports the modern dashboard path
- `MODERN-PANEL` summary appears
- at least one blank-offerId line, if present for the account/day, now includes `opportunityKey=...`
- blank-offerId browser-safe `poll` / 8-question `quiz` cards, if present, show `reason=auto-executable-without-offerid`
- blank-offerId standard quiz/urlreward cards, if present, show `reason=missing-offerid-requires-api-execution`

After observing the relevant `MODERN-ACTIVITY` lines, stop the process manually with `Ctrl+C` before the long desktop-search phase if you do not need a full end-to-end run.

- [ ] **Step 3: Commit the verified implementation**

Run:

```bash
git status --short
git add src/functions/modernPanel/types.ts src/functions/modernPanel/collectModernPanelOpportunities.ts src/functions/modernPanel/executeModernPanelOpportunities.ts tests/browser/modernPanelCollector.test.mjs tests/browser/modernPanelWorker.test.mjs
git commit -m "feat: support blank offerId modern panel cards"
```
