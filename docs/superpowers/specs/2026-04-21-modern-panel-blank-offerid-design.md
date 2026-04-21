# 新版面板 blank-offerId 卡片适配设计

## 背景

当前仓库已经具备新版 Rewards 仪表盘的主流程兼容能力，也已经把新版面板额外入口接入了 modern-only 收集与执行链路。

真实账号 smoke 结果表明：

- 新版面板链路已经真实执行。
- `dailyCheckInPromotion` 这类带完整字段的活动可以被稳定识别。
- 一批来自 `streakPromotion`、`streakBonusPromotions`、`levelInfoPromotion`、`levelBenefitsPromotion` 的卡片会出现：
  - `offerId=unknown`
  - `offerIdState=blank`
  - 部分卡片 `promotionType` 仍然存在
  - 部分卡片 `promotionType` 也是 blank

这说明当前缺口已经不是“有没有接入 modern panel”，而是“当上游返回的卡片没有有效 `offerId` 时，是否还能继续稳定识别、去重，并在安全前提下自动执行一部分页面型活动”。

## 目标

- 为 `offerIdState=blank` 的新版面板卡片建立稳定识别能力。
- 在不依赖真实 `offerId` 的前提下，只放行可以安全复用现有浏览器型执行器的活动。
- 继续明确跳过需要真实 `offerId` 的活动，不做激进猜测。
- 让真实 smoke 日志能稳定标识“同一张 blank-offerId 卡片”。
- 尽量少改现有 legacy worker、活动执行器和主流程。

## 用户确认的边界

- 本阶段只处理我能从真实页面结构确认、并且不会和旧流程重复执行的新版卡片。
- 优先覆盖 `streak` / `level` 来源的 blank-offerId 卡片。
- 不做“强行点到底”的页面自动化。
- 对不能稳定执行的卡片，继续显式记录并跳过。

## 范围

本阶段只扩展 modern-only 机会链路：

- `src/functions/modernPanel/types.ts`
- `src/functions/modernPanel/collectModernPanelOpportunities.ts`
- `src/functions/modernPanel/executeModernPanelOpportunities.ts`
- 相关测试

本阶段关注的来源：

- `streakPromotion`
- `streakBonusPromotions`
- `levelInfoPromotion`
- `levelBenefitsPromotion`

本阶段明确不覆盖：

- 重写 `UrlRewardNew`
- 为 blank-offerId 卡片新增新的私有接口调用
- 猜测或伪造 `offerId`
- App / Xbox 专属入口
- 通用页面点击器

## 方案对比

### 方案 A：继续保持现状，只补日志

优点：

- 风险最低
- 改动最小

缺点：

- 不能扩展新版卡片的自动执行覆盖
- smoke 只能观察，不能推进兼容性

### 方案 B：为 blank-offerId 卡片增加稳定识别与有限自动执行

优点：

- 改动集中在 modern-only 层
- 可以先把可页面执行的安全子集接入自动链路
- 后续真实 smoke 更容易识别相同卡片

缺点：

- 仍然不能覆盖依赖 `offerId` 的活动
- 需要补一层 synthetic identity

### 方案 C：直接用页面点击兜底所有 blank-offerId 卡片

优点：

- 表面覆盖范围最大

缺点：

- 风险最高
- 最容易被新版 UI 改挂
- 很难证明不会重复执行或误点信息卡

推荐采用方案 B。

## 核心设计

### 1. 为 blank-offerId 卡片新增稳定标识

在 `ModernPanelOpportunity` 中新增 `opportunityKey`，用于标识没有真实 `offerId` 的现代卡片。

设计要求：

- 如果存在正常 `offerId`，`opportunityKey` 仍然生成，但优先反映真实 `offerId`
- 如果 `offerIdState !== normalized`，则基于稳定字段组合生成 synthetic key
- synthetic key 只用于日志、去重和调试，不冒充真实 `offerId`

建议组成字段：

- `source`
- `kind`
- `promotionType`
- `destinationUrl`
- `title`
- `exclusiveLockedFeatureStatus`

生成规则：

- 所有字段先做统一 trim / lowercase / 空值归一化
- 缺失字段使用固定占位符，例如 `unknown`
- 使用可读字符串拼接，不做哈希，便于直接读日志

示例：

- `streak|poll|quiz|https://...pollscenarioid=42|bonus poll|unlocked`
- `level|info-only|unknown|unknown|level benefits|locked`

### 2. 把 blank-offerId 卡片分成“可页面执行”和“不可执行”

对于 `offerIdState=blank` 的 modern 卡片，不再只按 `promotionType` 粗分，而是结合现有执行器依赖做二次判定。

#### 可页面执行

只允许以下类型进入 `decision=auto`：

- `poll`
- 8 题浏览器型 `quiz`

判定依据：

- `poll`
  - `promotionType === 'quiz'`
  - `destinationUrl` 包含 `pollScenarioId`
  - 非 locked
  - 有正向可执行性，例如 `pointProgressMax > 0` 或 `activityProgressMax > 0`
- 8 题 `quiz`
  - `promotionType === 'quiz'`
  - 非 locked
  - `activityProgressMax === 80`
  - 有有效 `destinationUrl`

原因：

- 现有 `Poll` 执行器主要依赖页面和 `destinationUrl`
- 现有 8 题 `Quiz` 分支主要依赖页面导航和点击，不依赖 `ReportActivity`

#### 不可执行

以下情况继续 `decision=skip`：

- 标准 `quiz`，因为 `ReportActivity` 仍需真实 `offerId`
- `urlreward`，因为 `UrlRewardNew` 仍需真实 `offerId` 在 panel data 中查回完整 promotion
- `exploreonbing`
- 所有 locked 卡片
- `promotionType` 为空且没有可靠页面目标的卡片
- 纯信息卡

### 3. 新增更细的 skip / auto 原因

在现有 reason 基础上补充必要枚举，使日志能表达“为什么明明是 quiz 却不自动执行”。

建议新增：

- `AutoExecutableWithoutOfferId`
- `MissingOfferIdRequiresApiExecution`

说明：

- `AutoExecutableWithoutOfferId` 只用于 blank-offerId 但仍可安全页面执行的子集
- `MissingOfferIdRequiresApiExecution` 用于标准 quiz / urlreward 等必须依赖真实 `offerId` 的场景

若实现时不想扩大 reason 枚举太多，也可以保留现有 reason，并额外引入：

- `executionMode: browser-safe | api-required | unsupported`

推荐优先扩 reason，避免把解释分散到多个字段。

### 4. 去重策略

现有 legacy 去重逻辑仍以真实 `offerId` 为准：

- 当 modern 卡片有正常 `offerId` 且出现在 legacy 集合中时，继续跳过

blank-offerId 卡片不尝试与 legacy 做强绑定去重，因为没有可信主键。

但需要在 modern 内部去重：

- 同一轮采集里，如果两个机会的 `opportunityKey` 相同，则只保留一个
- 保留优先级：
  - `auto` 优先于 `skip`
  - 非 `info-only` 优先于 `info-only`

## 代码影响

预计涉及：

- `src/functions/modernPanel/types.ts`
  - 扩展 `ModernPanelOpportunity`
  - 新增必要的 reason 枚举
- `src/functions/modernPanel/collectModernPanelOpportunities.ts`
  - 生成 `opportunityKey`
  - 识别 blank-offerId 可执行子集
  - modern 内部去重
- `src/functions/modernPanel/executeModernPanelOpportunities.ts`
  - 日志增加 `opportunityKey`
  - 放行 blank-offerId 的安全浏览器型活动
- `tests/browser/modernPanelCollector.test.mjs`
- `tests/browser/modernPanelWorker.test.mjs`

现有 `Activities`、`Poll`、`Quiz`、`UrlRewardNew` 预计不需要结构性修改。

## 错误处理

- 当 blank-offerId 卡片缺少足够字段生成稳定 `opportunityKey` 时，仍然生成带 `unknown` 占位符的 key，避免空 key。
- 执行器遇到 blank-offerId 的 auto 条目时，仍以当前执行器自己的失败处理为准，不额外吞错。
- 如果未来真实 smoke 表明某类 blank-offerId `quiz` 实际仍依赖 `offerId`，应立即把该类型重新降级为 `skip`。

## 测试策略

至少覆盖以下场景：

1. blank-offerId `poll` 会被识别为可自动执行，并生成稳定 `opportunityKey`
2. blank-offerId 8 题 `quiz` 会被识别为可自动执行
3. blank-offerId 标准 `quiz` 会因缺少 `offerId` 而跳过
4. blank-offerId `urlreward` 会因缺少 `offerId` 而跳过
5. 相同 synthetic key 的重复条目会在 collector 中去重
6. worker 日志会输出 `opportunityKey`

验证顺序：

- 先写/改测试，确认新增场景先失败
- 再补实现
- 最后跑 build 和 modern 相关回归测试

## 风险与控制

- 风险：把实际上仍依赖 `offerId` 的活动误判为可页面执行
  - 控制：本阶段只放行 `poll` 和 8 题 `quiz`
- 风险：synthetic key 不够稳定，导致重复日志难追踪
  - 控制：优先使用 destinationUrl + title + source + type 组合
- 风险：同一张卡在不同日期 key 变化
  - 控制：允许变化，但保持同一天同一轮 smoke 稳定即可；后续再按真实数据优化

## 非目标

- 不承诺“所有 blank-offerId 卡片都能自动完成”
- 不承诺新版仪表盘完全适配
- 不解决 locked-feature 本身
- 不为缺失 `offerId` 的 `urlreward` 伪造请求参数
