# 新版面板额外赚分入口设计

## 背景

当前仓库已经完成了新版 Rewards 仪表盘主流程适配，`dailySetPromotions`、`morePromotions`、搜索积分与基础点数统计都能继续走现有主流程。

但新版面板里仍有一批“网页上可见、当前主流程没有纳入”的赚分相关入口：

- `dailyCheckInPromotion`
- `streakPromotion`
- `streakBonusPromotions`
- `levelInfoPromotion`
- `levelBenefitsPromotion`

这些字段已经存在于 `PanelFlyoutData` 类型中，`BrowserFunc.getPanelFlyoutData()` 也已经能拿到，但当前代码并没有把它们纳入稳定的识别与执行链路。

截至 `2026-04-21`，公开网页入口已从 `https://rewards.bing.com/earn` 迁移到 `https://rewards.microsoft.com/`。微软官方支持文档明确说明：

- Rewards page 上的赚分机会会每日更新
- Level 2 仍然包含 exclusive offers

因此，本次设计聚焦在“新版网页面板上当前可见的额外赚分入口”，而不是继续围绕旧版 `earn` 页假设做补丁式兼容。

## 目标

- 让新版网页面板中当前可见、但未进入主流程的赚分入口被统一识别。
- 对能够稳定复用现有执行器的入口自动完成。
- 对暂时不适合自动化的入口明确记录并跳过，而不是静默忽略。
- 尽量少改现有 legacy 主流程与活动执行器，降低回归风险。
- 为后续继续扩展新版面板入口留出稳定的归一化层。

## 用户确认的边界

本次设计基于以下已确认约束：

- 覆盖范围同时包含：
  - 每日活动类入口
  - 等级 / 专属额外赚分入口
- 自动化策略：
  - 能稳定自动完成的尽量自动完成
  - 做不了或不稳定的入口，明确识别并跳过
- 处理策略：
  - 明确记录跳过原因，不做“硬点到底”的激进自动化
- 表面范围：
  - 只覆盖新版 Rewards 网页仪表盘 / Rewards page 上能看到的入口
  - 不扩展到 App / Xbox 独占入口

## 范围

本阶段覆盖的新版面板来源：

- `dailyCheckInPromotion`
- `streakPromotion`
- `streakBonusPromotions`
- `levelInfoPromotion`
- `levelBenefitsPromotion`

本阶段继续沿用现有主流程处理的来源：

- `dailySetPromotions`
- `morePromotions`
- `morePromotionsWithoutPromotionalItems`（若未来启用）
- `promotionalItems`
- `punchCards`

本阶段明确不覆盖：

- 网页版 `dailyCheckIn` 的真实自动化执行
- 任何需要猜测页面交互或新接口协议的现代专用自动化
- App / Xbox 专属活动的网页模拟
- 重新设计整套 worker 直接消费 `PanelFlyoutData`
- 一次性重写所有 earnable points 统计逻辑以包含全部 modern-only 入口

## 方案对比

### 方案 A：继续把更多现代字段硬塞回 `DashboardData`

优点：

- 改动面最小
- 复用现有 `Workers` 最多

缺点：

- `dailyCheckIn`、`streak`、`level benefits` 与 legacy 结构并不天然等价
- 跳过原因与 modern-only 语义会散落在现有 worker 分支里
- 后续继续补入口时会越来越难维护

### 方案 B：新增“现代面板机会收集层”，再交给现有执行器

优点：

- 能把新版面板额外入口统一识别、分类、去重
- 自动执行与跳过策略都可审计
- 不需要重写现有 quiz / poll / urlreward 执行器
- 最符合“能稳跑就自动，不能稳跑就明确跳过”的目标

缺点：

- 会新增一层 modern-only 抽象
- 需要补专门的测试与日志

### 方案 C：全面改写 worker，使其直接消费 `PanelFlyoutData`

优点：

- 长期结构最纯粹

缺点：

- 改动范围过大
- 会把现有主流程、执行器与测试全部卷进来
- 不适合当前“小步补齐入口覆盖”的目标

推荐采用方案 B。

## 架构设计

在现有 legacy-compatible 主流程旁边，新增一条 modern-only 的机会识别与执行链路。

### 现有链路保持不变

- `BrowserFunc.getDashboardData()` 继续返回统一的 `DashboardData`
- `index.ts` 继续按现有顺序执行：
  - `doDailySet(data, page)`
  - `doSpecialPromotions(data)`
  - `doMorePromotions(data, page)`
  - `doPunchCards(data, page)`

### 新增 modern-only 链路

在现有网页 worker 之后新增：

- `doModernPanelPromotions(panelData, data, page)`

其中：

- `panelData`
  - 用于读取新版面板独有入口
- `data`
  - 用于与已有 `dailySetPromotions` / `morePromotions` 做去重
- `page`
  - 用于把可自动执行的 modern opportunity 转交给现有 browser/API 执行器

### 职责拆分

新增两层清晰职责：

- `collectModernPanelOpportunities(panelData, data)`
  - 只负责收集、归一化、分类、去重
  - 不执行任何活动
- `executeModernPanelOpportunities(opportunities, page)`
  - 只负责根据策略执行或跳过
  - 复用现有 `Activities` 里的执行器

这样职责会稳定分离：

- 收集器决定“它是什么”
- 执行器决定“该不该跑”
- 活动执行器决定“具体怎么跑”

## 机会模型

新增一个 modern opportunity 归一化结构，至少包含：

- `source`
  - `daily`
  - `streak`
  - `level`
- `kind`
  - `quiz`
  - `poll`
  - `urlreward`
  - `checkin`
  - `info-only`
- `decision`
  - `auto`
  - `skip`
- `reason`
  - 决策原因或跳过原因
- `offerId`
- `title`
- `promotionType`
- `destinationUrl`
- `promotion`
  - 指向原始面板 promotion，供执行时转交

## 分类规则

### `quiz`

满足以下条件时识别为 `quiz`：

- `promotionType === 'quiz'`
- 未完成
- 未锁定
- `pointProgressMax > 0`

执行策略：

- `decision = auto`
- 复用现有 `activities.doQuiz(...)`
- 其中 poll 与 8 题测验继续走已存在的 quiz 分流逻辑

### `poll`

满足以下条件时识别为 `poll`：

- `promotionType === 'quiz'`
- `destinationUrl` 包含 `pollScenarioId`
- 其余执行前置条件同 `quiz`

执行策略：

- `decision = auto`
- 复用现有 `activities.doPoll(...)`

### `urlreward`

满足以下条件时识别为 `urlreward`：

- `promotionType === 'urlreward'`
- 未完成
- 未锁定
- `pointProgressMax > 0`
- 具备现有 `UrlRewardNew` 所需的执行字段：
  - `offerId`
  - `hash`
  - `activityType`

执行策略：

- `decision = auto`
- 优先复用现有 `activities.doDaily(...)` / `UrlRewardNew`

### `checkin`

满足以下条件时识别为 `checkin`：

- 来源为 `dailyCheckInPromotion`

执行策略：

- `decision = skip`
- `reason = daily-check-in-web-entry-not-supported`

原因：

- 当前仓库已有的 `doDailyCheckIn()` 走的是 App 路径
- 本次范围限定在网页面板入口
- 这轮不新增网页 check-in 专用自动化

### `info-only`

满足以下条件时识别为 `info-only`：

- 纯说明卡、等级权益卡、锁定说明卡
- 无正向可赚分值
- 无现有执行器可消费的可执行动作

执行策略：

- `decision = skip`
- `reason` 根据具体情形落到：
  - `info-card-without-action`
  - `locked-feature`
  - `unsupported-promotion-type`

## 各来源的处理规则

### 每日活动类

#### `dailySetPromotions`

- 继续交由现有 legacy-compatible worker 处理
- modern collector 不重复产出同 `offerId`

#### `dailyCheckInPromotion`

- 纳入 modern collector
- 统一识别为 `checkin + skip`
- 在日志中明确说明“网页入口可见，但当前仅有 App 执行器”

#### `streakPromotion` / `streakBonusPromotions`

- 如果其结构满足现有 `quiz` / `poll` / `urlreward` 契约，则纳入 `auto`
- 如果只是 streak 展示、补签说明、进度说明或权益说明，则识别为 `info-only + skip`

### 等级 / 专属额外赚分渠道

#### `levelInfoPromotion`

- 默认视为等级说明卡
- 归为 `info-only + skip`

#### `levelBenefitsPromotion`

- 仅在满足以下条件时纳入 `auto`：
  - 未完成
  - 未锁定
  - 有正分值
  - `promotionType` 属于现有支持的 `quiz` / `urlreward`
- 其他情况统一 `skip`
- 跳过时必须记录具体原因，例如：
  - `locked-feature`
  - `info-card-without-action`
  - `unsupported-promotion-type`

## 去重规则

为了避免重复执行，modern collector 必须在收集阶段去重。

去重基准：

- 若 `offerId` 已存在于以下任一集合，则不再为 modern-only 链路产出同一机会：
  - `dailySetPromotions`
  - `morePromotions`
  - `morePromotionsWithoutPromotionalItems`

去重结果不作为 error，只记录为：

- `decision = skip`
- `reason = duplicate-with-legacy-worker`

## 数据流

整体执行顺序如下：

1. `BrowserFunc.getDashboardData()` 返回统一 `DashboardData`
2. 现有主流程先处理 legacy-compatible 来源
3. 若当前账号为 `modern` 且 `panelData` 存在，则执行：
   - `collectModernPanelOpportunities(panelData, data)`
   - `executeModernPanelOpportunities(opportunities, page)`

要求：

- modern-only 链路不得影响现有 `dailySet` / `morePromotions` 正常执行
- 即使 modern-only 收集或执行失败，也不应让整个主流程中断

## 日志设计

新增两组可审计日志域：

### `MODERN-PANEL`

用于记录整体识别结果，例如：

- 识别到多少个 modern-only 机会
- 其中多少个将自动执行
- 多少个将跳过

### `MODERN-ACTIVITY`

用于逐条记录每个机会的决策，至少包含：

- `source`
- `offerId`
- `promotionType`
- `decision`
- `reason`

推荐的 reason 枚举：

- `duplicate-with-legacy-worker`
- `daily-check-in-web-entry-not-supported`
- `locked-feature`
- `info-card-without-action`
- `unsupported-promotion-type`
- `auto-executable`

目标是让日志能直接回答：

- 新版面板额外识别到了什么
- 哪些已经自动做了
- 哪些没做，以及为什么没做

## 错误处理

- 收集器必须对缺失字段做空值保护
- 某个机会识别失败时，只影响该机会，不影响整批处理
- 执行器调用单个活动失败时，记录 `MODERN-ACTIVITY` 错误日志后继续下一个机会
- 不允许因某个 modern-only 入口失败而导致整个账号主流程终止

## 代码影响

预计涉及：

- 新增 modern opportunity 类型定义文件
- 新增 modern collector / executor 文件
- `src/functions/Workers.ts`
  - 挂入 `doModernPanelPromotions(...)`
- `src/index.ts`
  - 在现有网页 worker 之后接入 modern-only 处理
- `src/functions/Activities.ts`
  - 复用现有执行器，不做大规模重写

原则：

- 尽量少改现有 `doDailySet` / `doMorePromotions` / `doPunchCards`
- 不重写 quiz / poll / urlreward 执行器

## 测试策略

本次测试聚焦“识别与路由”，不引入新的真人联调假设。

至少补以下三类测试：

1. 收集器测试
   - `dailyCheckInPromotion` 被识别为 `checkin + skip`
   - `levelInfoPromotion` 被识别为 `info-only + skip`
   - `levelBenefitsPromotion` 在满足条件时被识别为 `quiz/urlreward + auto`

2. 去重测试
   - 当 `offerId` 已存在于 `dailySetPromotions` 或 `morePromotions` 时，modern collector 不再重复产出自动执行机会

3. worker / executor 路由测试
   - `auto quiz` 转发到 `activities.doQuiz(..., page)`
   - `auto poll` 转发到 `activities.doPoll(..., page)`
   - `auto urlreward` 转发到 `activities.doDaily(...)` 或最终统一的 `doUrlReward(...)`
   - `skip` 机会不会执行活动，只记录日志

## 非目标

- 不做网页版 `dailyCheckIn` 的真实自动化
- 不做“看见等级卡片就强行点开猜接口”的激进策略
- 不新增现代专用答题器或新的浏览器脚本
- 不重写 `getBrowserEarnablePoints()` 以纳入所有 modern-only 机会
- 不把现有 legacy worker 全面替换成 modern-first worker

## 参考

- Microsoft Support: How to earn Microsoft Rewards points
  - https://support.microsoft.com/en-us/account-billing/how-to-earn-microsoft-rewards-points-83179747-1807-7a5e-ce9d-a7c544327174
- Microsoft Support: About Microsoft Rewards status levels
  - https://support.microsoft.com/en-us/topic/about-microsoft-rewards-status-levels-6ca5db8e-1e59-caa3-7d96-f7a1d5270c15
