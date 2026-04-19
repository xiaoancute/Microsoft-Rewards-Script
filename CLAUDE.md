# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is a **downstream fork** of [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) focused on localization for users in mainland China. Fork-specific differences live alongside upstream code and must survive merges:

- `china` query engine in [src/functions/QueryEngine.ts](src/functions/QueryEngine.ts) (registered in `queryEngines` config)
- PushPlus webhook channel in [src/logging/PushPlus.ts](src/logging/PushPlus.ts) — Chinese notification service, summary-only
- Default `langCode: "zh"`, `--lang=zh-CN` Chromium arg in [src/browser/Browser.ts](src/browser/Browser.ts)
- Chinese log messages throughout (keep this style when editing existing strings)
- Local daily log files written to `./logs/YYYY-MM-DD.log` by [src/logging/Logger.ts](src/logging/Logger.ts)
- Docker image pinned to `m.daocloud.io` mirror in the [Dockerfile](Dockerfile)

Sync upstream via `git fetch upstream && git merge upstream/v3 --allow-unrelated-histories` (see `更新同步原项目.txt`). The `main` branch is the working branch; upstream tracks `v3`. When resolving merges, preserve the fork-specific pieces above.

## Commands

Node **>= 24** required (see `engines` in [package.json](package.json)). No test or lint npm scripts exist.

```bash
npm run pre-build    # install deps + clear dist/ + install patchright chromium
npm run build        # rimraf dist && tsc — required after ANY src/config.json or src/accounts.json edit
npm start            # run compiled bundle from ./dist/index.js
npm run ts-start     # run from source via ts-node (no build step)
npm run dev          # ts-node with -dev flag → loads src/accounts.dev.json instead of accounts.json
npm run clear-sessions           # wipe saved login sessions
npm run open-session -- -email <addr>   # open an interactive browser for a specific account (manual login/debug)
npm run format       # prettier --write .
```

Docker workflow: `docker compose up -d` — compose volumes mount `./config` → `dist/config` and `./sessions` → `dist/browser/sessions`. The entrypoint templates `src/crontab.template` with `$CRON_SCHEDULE` and `$TZ`; `RUN_ON_START=true` kicks off an immediate run.

### Runtime config invariants

- [src/config.example.json](src/config.example.json) and [src/accounts.example.json](src/accounts.example.json) must be copied to `config.json` / `accounts.json` **before** `npm run build` — TypeScript's `include` pulls them in and the runtime reads them from `dist/` relative to the compiled JS via `path.join(__dirname, '../', ...)` in [src/util/Load.ts](src/util/Load.ts). After editing either JSON, rebuild before `npm start`.
- `-dev` CLI flag switches account source to `accounts.dev.json` ([src/util/Load.ts:16-18](src/util/Load.ts#L16-L18)).
- Config is validated with zod in [src/util/Validator.ts](src/util/Validator.ts); schema changes must be made there too, not only in [src/interface/Config.ts](src/interface/Config.ts).

## Architecture

The entry point is [src/index.ts](src/index.ts) which defines `MicrosoftRewardsBot` — a single orchestrator class that owns every subsystem (`browser`, `activities`, `workers`, `searchManager`, `login`, `logger`, `axios`, …). Helpers reach back into the bot via a constructor-injected reference (`this.bot.logger`, `this.bot.config`, etc.), so most modules are tightly coupled to that shape.

### Execution flow

1. `main()` constructs the bot, registers signal handlers that flush all webhook queues, then calls `initialize()` (loads accounts) and `run()`.
2. `run()` branches on `config.clusters`:
   - `> 1` → uses Node's `cluster` module. Primary forks workers, splits accounts via `chunkArray`, and aggregates per-account stats through `process.send({ __stats, __ipcLog })` IPC messages.
   - `<= 1` → runs `runTasks` inline in the same process.
3. For each account, `Main(account)` runs inside an `AsyncLocalStorage<ExecutionContext>` scope so that `bot.isMobile` and `getCurrentContext()` reflect the current account/device anywhere in the tree without plumbing parameters.
4. `Main` builds **one mobile browser session per account** via the `Browser` factory, runs login, fetches dashboard / app-dashboard / panel data, then dispatches workers (daily set, promotions, punch cards, check-in, read-to-earn) and finally `SearchManager.doSearches` which handles both mobile and desktop search points.

### Key subsystems

- **[src/browser/Browser.ts](src/browser/Browser.ts)** — wraps `patchright` (a Playwright fork with anti-detection patches). Loads saved cookies + `fingerprint-injector` fingerprints from `sessions/<email>/session_{mobile,desktop}.json` if `account.saveFingerprint.{mobile,desktop}` is true. Applies hard-coded Chromium args including `--lang=zh-CN`.
- **[src/browser/auth/Login.ts](src/browser/auth/Login.ts)** — state-machine login driver (`EMAIL_INPUT` → `PASSWORD_INPUT` → `2FA_TOTP` → `KMSI_PROMPT` → `LOGGED_IN`, etc.). Concrete steps live under [src/browser/auth/methods/](src/browser/auth/methods/) (`EmailLogin`, `PasswordlessLogin`, `Totp2FALogin`, `RecoveryEmailLogin`, `GetACodeLogin`, `MobileAccessLogin`). Adding a new auth branch means extending the `LoginState` union and wiring a handler here.
- **[src/functions/Workers.ts](src/functions/Workers.ts)** — the per-category task runners (`doDailySet`, `doMorePromotions`, `doPunchCards`, `doAppPromotions`). Each filters dashboard data for uncompleted items, then delegates to `bot.activities.*`.
- **[src/functions/Activities.ts](src/functions/Activities.ts)** — thin dispatcher that instantiates the right concrete activity class. Activities are split by transport under [src/functions/activities/](src/functions/activities/):
  - `api/` — direct HTTP calls against the rewards platform (Quiz, FindClippy, UrlReward, DoubleSearchPoints, UrlRewardNew). `UrlRewardNew` is the fork's temporary workaround for daily tasks (see `doDaily` in Activities.ts).
  - `app/` — mobile-app-token based endpoints (DailyCheckIn, ReadToEarn, AppReward). Require `accessToken` obtained from `login.getAppAccessToken`.
  - `browser/` — real in-browser flows (Search, SearchOnBing).
- **[src/functions/SearchManager.ts](src/functions/SearchManager.ts)** and **[src/functions/QueryEngine.ts](src/functions/QueryEngine.ts)** — search orchestration and pluggable query sources (`china | google | wikipedia | reddit | local`). The `local` source uses [src/functions/search-queries.json](src/functions/search-queries.json) / [src/functions/bing-search-activity-queries.json](src/functions/bing-search-activity-queries.json).
- **[src/logging/Logger.ts](src/logging/Logger.ts)** — dual-sink logger: colored console output + `./logs/YYYY-MM-DD.log`. In cluster workers, logs destined for webhooks are forwarded to the primary via `process.send({ __ipcLog })` so webhook delivery stays centralized.
- **Notification channels** — [Discord.ts](src/logging/Discord.ts), [Ntfy.ts](src/logging/Ntfy.ts), [PushPlus.ts](src/logging/PushPlus.ts). Each exposes a `send*` and `flush*Queue`; `flushAllWebhooks()` in [src/index.ts](src/index.ts) must be called before any `process.exit` path (it already is from signal handlers and worker exit logic — preserve this when adding new exit paths). PushPlus is summary-only and fires from `sendPushPlusSummary`, not per-log-line.
- **[src/util/Utils.ts](src/util/Utils.ts)** — timing helpers (`wait`, `randomDelay`), `chunkArray`, `getFormattedDate`, email parsing. Used pervasively; prefer these over inline equivalents.
- **[src/constants.ts](src/constants.ts)** — central `TIMEOUTS` / `RETRY_LIMITS` / `DELAYS` / `SELECTORS` / `URLS`. Prefer referencing these over new magic numbers.

### Sessions and fingerprints

Session files are keyed by email AND by device type:

```
src/browser/sessions/<email>/
  session_mobile.json                 # cookies
  session_desktop.json
  session_fingerprint_mobile.json     # only written if saveFingerprint.mobile
  session_fingerprint_desktop.json
```

`npm run build` wipes `dist/`, which means `dist/browser/sessions/` is lost — mount/persist sessions outside `dist/` (Docker does this via the `./sessions` volume). When a login automation fails, the intended recovery is to complete the login manually in the visible Chromium window so the session file gets saved, then re-run.

### Config surface

There are two ESLint configs in the repo (`.eslintrc.js` and `.eslintrc.json`) with conflicting rules (single vs double quotes, different rule sets). ESLint v9 is installed but no `lint` script exists — do not assume linting is enforced. Formatter is prettier via `npm run format`.

TypeScript is strict (`strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`). `noUnusedLocals` is off.
