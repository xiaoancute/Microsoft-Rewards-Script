# Modern Dashboard Main Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hybrid modern-dashboard adapter so the current main flow keeps working against the new Rewards panel without rewriting the worker layer.

**Architecture:** Keep `BrowserFunc.getDashboardData()` as the single entry point, but let modern accounts prefer `panelflyout/getuserinfo` and convert its payload into a `DashboardData`-compatible phase-1 subset. When available, reuse the legacy `getuserinfo` response only as a supplement for missing fields such as search counters; otherwise fall back to safe defaults.

**Tech Stack:** TypeScript, node:test, existing bot/browser abstractions

---

### Task 1: Add adapter tests for the modern main-flow subset

**Files:**

- Create: `tests/browser/modernDashboardAdapter.test.mjs`
- Modify: none
- Test: `tests/browser/modernDashboardAdapter.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'

import {
    adaptModernDashboardData,
    createEmptyLegacyDashboardSubset
} from '../../dist/browser/modernDashboardAdapter.js'

test('adaptModernDashboardData maps modern daily set and more promotions into dashboard subset', () => {
    const panel = {
        userInfo: { rewardsCountry: 'CN' },
        flyoutResult: {
            userStatus: {
                availablePoints: 1234,
                lifetimePoints: 5678,
                lifetimeGivingPoints: 25
            },
            dailySetPromotions: {
                '04/20/2026': [{ offerId: 'daily-1', title: 'daily', pointProgress: 0, pointProgressMax: 10 }]
            },
            morePromotions: [{ offerId: 'more-1', title: 'more', pointProgress: 0, pointProgressMax: 30 }]
        }
    }

    const result = adaptModernDashboardData(panel, null, 'cn')

    assert.equal(result.userStatus.availablePoints, 1234)
    assert.equal(result.userProfile.attributes.country, 'CN')
    assert.equal(result.dailySetPromotions['04/20/2026'][0].offerId, 'daily-1')
    assert.equal(result.morePromotions[0].offerId, 'more-1')
})

test('createEmptyLegacyDashboardSubset returns safe defaults for phase-1 unsupported modules', () => {
    const result = createEmptyLegacyDashboardSubset('cn')

    assert.deepEqual(result.punchCards, [])
    assert.deepEqual(result.promotionalItems, [])
    assert.deepEqual(result.morePromotionsWithoutPromotionalItems, [])
    assert.equal(result.userProfile.attributes.country, 'cn')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/browser/modernDashboardAdapter.test.mjs`
Expected: FAIL with module-not-found or missing-export errors because the adapter file does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
export function createEmptyLegacyDashboardSubset(country: string) {
    return {
        userStatus: {
            availablePoints: 0,
            lifetimePoints: 0,
            lifetimeGivingPoints: 0,
            counters: {
                pcSearch: [],
                mobileSearch: [],
                activityAndQuiz: [],
                dailyPoint: []
            }
        },
        userProfile: {
            ruid: '',
            attributes: {
                country
            }
        },
        dailySetPromotions: {},
        morePromotions: [],
        morePromotionsWithoutPromotionalItems: [],
        promotionalItems: [],
        punchCards: []
    }
}

export function adaptModernDashboardData(panel, legacySupplement, countryFallback) {
    const result = createEmptyLegacyDashboardSubset(panel?.userInfo?.rewardsCountry || countryFallback)
    result.userStatus.availablePoints = panel.flyoutResult.userStatus.availablePoints || 0
    result.userStatus.lifetimePoints = panel.flyoutResult.userStatus.lifetimePoints || 0
    result.userStatus.lifetimeGivingPoints = panel.flyoutResult.userStatus.lifetimeGivingPoints || 0
    result.dailySetPromotions = panel.flyoutResult.dailySetPromotions || {}
    result.morePromotions = panel.flyoutResult.morePromotions || []
    if (legacySupplement?.userStatus?.counters) result.userStatus.counters = legacySupplement.userStatus.counters
    return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/browser/modernDashboardAdapter.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/browser/modernDashboardAdapter.test.mjs src/browser/modernDashboardAdapter.ts
git commit -m "test: cover modern dashboard adapter"
```

### Task 2: Wire the adapter into BrowserFunc with hybrid fallback behavior

**Files:**

- Modify: `src/browser/BrowserFunc.ts`
- Modify: `src/index.ts`
- Test: `tests/browser/modernDashboardAdapter.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
test('adaptModernDashboardData prefers legacy counters when supplement is provided', () => {
    const panel = {
        userInfo: { rewardsCountry: 'CN' },
        flyoutResult: {
            userStatus: {
                availablePoints: 1234,
                lifetimePoints: 5678,
                lifetimeGivingPoints: 25
            },
            dailySetPromotions: {},
            morePromotions: []
        }
    }

    const legacy = {
        userStatus: {
            counters: {
                pcSearch: [{ pointProgress: 30, pointProgressMax: 90 }],
                mobileSearch: [{ pointProgress: 20, pointProgressMax: 60 }],
                activityAndQuiz: [],
                dailyPoint: []
            }
        }
    }

    const result = adaptModernDashboardData(panel, legacy, 'cn')

    assert.equal(result.userStatus.counters.pcSearch[0].pointProgressMax, 90)
    assert.equal(result.userStatus.counters.mobileSearch[0].pointProgressMax, 60)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/browser/modernDashboardAdapter.test.mjs`
Expected: FAIL because counters are not preserved yet or the adapter shape is incomplete.

- [ ] **Step 3: Write minimal implementation**

```typescript
const legacyCounters = legacySupplement?.userStatus?.counters
result.userStatus.counters = legacyCounters ?? {
    pcSearch: [],
    mobileSearch: [],
    activityAndQuiz: [],
    dailyPoint: []
}
```

Then update `BrowserFunc.getDashboardData()` so the modern path does this:

```typescript
if (this.bot.rewardsVersion === 'modern') {
    const panelData = await this.getPanelFlyoutData()
    let legacySupplement: DashboardData | null = null

    try {
        legacySupplement = await this.getLegacyDashboardData()
    } catch {
        this.bot.logger.warn(
            this.bot.isMobile,
            'GET-DASHBOARD-DATA',
            '旧版 dashboard 补充数据不可用，继续使用现代适配数据'
        )
    }

    return adaptModernDashboardData(panelData, legacySupplement, this.bot.userData.geoLocale)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/browser/modernDashboardAdapter.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/browser/BrowserFunc.ts src/index.ts src/browser/modernDashboardAdapter.ts tests/browser/modernDashboardAdapter.test.mjs
git commit -m "feat: support modern dashboard main flow"
```

### Task 3: Verify build and regression surface

**Files:**

- Modify: none
- Test: `tests/browser/modernDashboardAdapter.test.mjs`

- [ ] **Step 1: Run targeted tests**

Run: `node --test tests/browser/modernDashboardAdapter.test.mjs`
Expected: PASS

- [ ] **Step 2: Run existing script tests**

Run: `node --test tests/scripts/*.test.mjs`
Expected: PASS

- [ ] **Step 3: Run TypeScript build**

Run: `npm run build`
Expected: TypeScript compilation succeeds and emits `dist/`

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: verify modern dashboard compatibility"
```
