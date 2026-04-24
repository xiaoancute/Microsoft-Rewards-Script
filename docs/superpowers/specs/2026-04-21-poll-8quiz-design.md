# Poll And 8-Question Quiz Design

## Goal

Restore two missing daily-activity paths in the current codebase:

1. Poll activities detected from dashboard promotions should be executed instead of skipped.
2. 8-question quiz activities should no longer exit early as "not implemented".

This change is intentionally limited to daily browser activities. It does not include Edge high-value cards, Xbox rewards, Store rewards, or other Level 2 reward channels.

## Current State

- `Workers.solveActivities()` detects poll-shaped quiz promotions by checking:
  - `promotionType === "quiz"`
  - `pointProgressMax === 10`
  - `destinationUrl` contains `pollscenarioid`
- Those poll activities are logged and then skipped.
- `Quiz.doQuiz()` supports standard point-based quiz flows via `https://www.bing.com/bingqa/ReportActivity?ajaxreq=1`.
- `Quiz.doQuiz()` explicitly returns early for 8-question quizzes when `activityProgressMax === 80`.
- There is no current browser activity implementation for Poll or This-or-That in this repository.

## Requirements

### Functional

- Poll promotions must execute when discovered in daily set, more promotions, or punch cards.
- 8-question quiz promotions must execute through a browser-driven path.
- Existing standard quiz behavior for 20/30/40/50-point quiz flows must remain unchanged.
- Existing URL reward, search-on-Bing, and find-clippy flows must remain unchanged.

### Non-Functional

- Follow the repository's current structure:
  - browser-driven activity handlers live under `src/functions/activities/browser/`
  - activity dispatch stays in `Activities` and `Workers`
- Prefer the smallest change that restores real execution.
- Preserve current logging style and point-tracking updates.
- Add automated coverage for dispatch and regression-sensitive logic.

## Chosen Approach

Use a hybrid activity model:

- Keep the current API-driven quiz flow for standard quiz configurations.
- Add a new browser-driven Poll handler.
- Add a browser-driven fallback path for 8-question quizzes inside the existing Quiz activity flow.

This avoids unnecessary churn in the standard quiz path while restoring support for the activity types that currently require page interaction.

## Design

### 1. Poll handler

Add `src/functions/activities/browser/Poll.ts`.

Responsibilities:

- Navigate within the already-open activity tab.
- Wait for poll answer options to appear.
- Choose one available option using existing browser utilities when practical.
- Wait for either:
  - visible completion state, or
  - balance progress / points change, or
  - disappearance / disablement of answer options indicating completion.
- Refresh or re-read current points if needed and update `bot.userData.currentPoints` / `gainedPoints`.
- Log success, no-op completion, and failure in the same style as the rest of the codebase.

Implementation notes:

- The handler should not try to "solve" a correct answer; any valid poll selection is acceptable.
- The handler should be defensive about selector drift by trying a small ordered selector list rather than relying on one exact DOM shape.
- It should not assume a new tab is always created; it should work with the page object it receives.

### 2. Activity dispatch changes

Update `src/functions/Activities.ts` and `src/functions/Workers.ts`.

Dispatch rules:

- When quiz-shaped activity matches the current poll heuristic, call `activities.doPoll(basePromotion, page)` instead of skipping.
- All other quiz activities continue to go through `activities.doQuiz(basePromotion, page?)`.

This keeps the existing routing rule in one place and turns the current dead-end branch into a real execution path.

### 3. 8-question quiz browser flow

Extend `src/functions/activities/api/Quiz.ts` so it can run a browser-driven branch for `activityProgressMax === 80`.

Responsibilities:

- Accept the current activity page context from the caller.
- Reuse the existing `Quiz` class as the owner of quiz-related point tracking and logging.
- Loop through questions until completion or a safe stop condition.
- On each question:
  - detect currently available answer options
  - choose one candidate option
  - wait for state transition before proceeding
- Stop when:
  - `#quizCompleteContainer` appears, or
  - the activity reports completion through points/progress, or
  - no forward progress can be detected after a bounded number of retries.

Implementation notes:

- This path should be isolated in helper methods so the existing API-driven standard quiz path remains readable.
- The initial implementation does not need to compute correct answers; it only needs to complete the quiz interaction flow robustly enough for the site to advance through the question set.
- If the page exposes progress or result markers more reliably than point deltas, prefer those markers first and use points as secondary confirmation.

### 4. Method signature adjustment

Update the `Activities.doQuiz(...)` call chain so browser-capable quiz flows can receive a `Page`.

Expected shape:

- `Activities.doQuiz(promotion, page?)`
- `Workers.solveActivities(...)` passes the active page for quiz and poll paths

Standard API quiz logic may ignore the page argument; the 8-question branch uses it.

## Testing Strategy

Use TDD and add focused automated coverage before implementation.

### Tests to add

- A dispatch test proving poll-shaped quiz promotions call the Poll path instead of being skipped.
- A quiz behavior test proving `activityProgressMax === 80` no longer returns immediately as unimplemented.
- A regression test proving standard quiz configurations still use the existing API path.

### Test level

- Prefer unit tests around dispatch and branching decisions.
- For browser-heavy internals, mock the minimum page surface needed for branch verification rather than attempting a full site integration test.
- Keep existing real-world manual verification as follow-up evidence after code changes.

## Error Handling

- Poll and 8-question quiz paths should fail closed:
  - log a warning or error
  - return control to the worker loop
  - avoid crashing the whole account flow
- Bounded retry loops must be used for DOM progress checks to avoid hanging on selector drift.
- If activity completion cannot be confirmed, log the exact stop reason for later dashboard-specific tuning.

## Out Of Scope

- Edge high-value promotions
- Edge acquisition promotions
- Xbox reward tasks
- Microsoft Store purchase rewards
- Cashback / coupons / auto-redeem flows
- Full This-or-That answer-solving logic beyond what is needed to keep 8-question browser quizzes moving

## Files Expected To Change

- `src/functions/Activities.ts`
- `src/functions/Workers.ts`
- `src/functions/activities/api/Quiz.ts`
- `src/functions/activities/browser/Poll.ts`
- one or more new test files under `tests/`

## Verification Plan

After implementation:

- run targeted node tests for the new dispatch / quiz coverage
- run existing related browser/activity tests if present
- run `npm run build`
- perform one manual smoke check on a live account when a Poll or 8-question quiz is available
