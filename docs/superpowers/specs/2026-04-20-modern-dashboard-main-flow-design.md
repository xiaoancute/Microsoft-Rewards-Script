# 新版仪表盘主流程适配设计

## 背景

当前仓库已经能识别新版 Rewards 仪表盘，并在登录阶段把 `rewardsVersion` 标记为 `modern`。但主执行流仍然把旧版 `dashboard` 结构当成唯一数据源，`Workers`、搜索积分计算和点数统计都依赖 `DashboardData`。实际联调结果表明：

- 新版页面已成为登录后的主 UI。
- 旧版 `https://rewards.bing.com/api/getuserinfo?type=1` 目前仍可返回数据，但不能假设长期稳定。
- 新版 `panelflyout/getuserinfo` 已稳定返回主流程所需的核心数据。

因此，这次改动不做整套 worker 重写，而是在浏览器数据层增加一个“现代面板到旧 dashboard 主流程子集”的适配层，让现有主流程继续消费统一的 `DashboardData` 形状。

## 目标

- 让新版仪表盘账号在当前仓库里稳定执行主流程。
- 尽量不改 `Workers` 和活动执行逻辑。
- 保留旧版接口作为回退路径，降低上线风险。
- 为后续再补 `punchCards`、特殊活动等模块留出扩展点。

## 范围

本阶段只覆盖主流程：

- `dailySetPromotions`
- `morePromotions`
- 搜索积分计数
- `availablePoints`
- `userProfile.attributes.country`
- 与日常执行相关的安全默认字段
- 当旧版 `getuserinfo` 仍可用时，从 legacy supplement 回填：
    - `punchCards`
    - `promotionalItems`
    - `findClippyPromotion`

本阶段明确不覆盖：

- `morePromotionsWithoutPromotionalItems` 的现代专用补全逻辑
- 不为 `punchCards` / 特殊活动单独设计新的现代数据结构；仅在 legacy supplement 存在时复用旧结构
- 任何需要旧版 `RequestVerificationToken` 的特殊活动兼容性重写

## 方案对比

### 方案 A：继续只用旧版 `getuserinfo`

优点：

- 改动最小。

缺点：

- 对上游兼容性最脆弱。
- 已经和新版页面事实状态脱节。
- 新版面板里已有更贴近当前产品形态的数据源，没有必要继续把旧接口当唯一真相。

### 方案 B：主流程优先使用新版 `panelflyout`，转换成统一 `DashboardData` 子集，并保留旧版回退

优点：

- 改动聚焦在数据适配层。
- 主流程 worker 基本不用改。
- 既利用新版数据，又不丢失旧版兜底能力。

缺点：

- 需要定义一个受控的“主流程兼容子集”。
- 要明确哪些字段是有意置空的。

### 方案 C：全面改造所有 worker 直接消费 `PanelFlyoutData`

优点：

- 长期最纯粹。

缺点：

- 本次范围过大。
- 会把 `Workers`、活动执行器、类型和测试全部拖进来，超出当前目标。

推荐采用方案 B。

## 架构设计

新增一个现代仪表盘适配模块，负责把 `PanelFlyoutData.flyoutResult` 转换成主流程所需的 `DashboardData` 兼容对象。

职责拆分如下：

- `BrowserFunc.getDashboardData()`
    - 继续作为统一入口。
    - 当 `rewardsVersion === 'modern'` 时，优先请求 `panelflyout/getuserinfo`。
    - 将面板数据送入适配器，返回兼容后的 `DashboardData`。
    - 若现代接口失败，则回退到旧版 `getuserinfo`。
- 现代适配器
    - 只负责结构转换与安全默认值。
    - 不做网络请求。
    - 不耦合 worker 逻辑。
- `index.ts`
    - 仍然保留 `this.panelData`，供 `UrlRewardNew` 继续直接使用。
    - 主流程的 `data` 改为来自统一入口，避免调用方感知新旧差异。

## 数据映射

### 必须映射的字段

- `userStatus.availablePoints` <- `panel.flyoutResult.userStatus.availablePoints`
- `userStatus.lifetimePoints` <- `panel.flyoutResult.userStatus.lifetimePoints`
- `userStatus.lifetimeGivingPoints` <- `panel.flyoutResult.userStatus.lifetimeGivingPoints`
- `userStatus.counters`
    - `pcSearch`、`mobileSearch` 优先从旧版接口继承；若旧版不可用，则使用空数组安全降级
    - `activityAndQuiz`、`dailyPoint` 使用空数组安全默认值
- `dailySetPromotions` <- `panel.flyoutResult.dailySetPromotions`
- `morePromotions` <- `panel.flyoutResult.morePromotions`
- `userProfile.attributes.country`
    - 优先取 `panel.userInfo.rewardsCountry`
    - 取不到时回退 `bot.userData.geoLocale`

### 明确使用安全默认值的字段

以下字段在 phase 1 不参与主流程，但为满足现有 `DashboardData` 读取路径需要返回安全值：

- `morePromotionsWithoutPromotionalItems: []`
- `componentImpressionPromotions: []`
- `streakBonusPromotions: []`
- `suggestedRewards: []`
- 其他对象字段返回最小空对象并避免影响当前调用路径

以下字段在 modern 面板里没有直接等价结构，但在 legacy supplement 可用时允许回填旧结构：

- `punchCards`
- `promotionalItems`
- `findClippyPromotion`

## 回退策略

统一入口按以下顺序工作：

1. 若账号被检测为 `modern`，先请求新版 `panelflyout/getuserinfo`。
2. 新版成功时，尝试再拿旧版 `getuserinfo` 作为补充数据源。
3. 若旧版也成功，则把旧版中仍然有价值但新版缺失的字段补进兼容结果，尤其是搜索 counters。
   同时允许回填 `punchCards`、`promotionalItems`、`findClippyPromotion` 等 legacy-only 模块。
4. 若旧版失败，不影响新版主流程；兼容对象使用安全默认值继续运行。
5. 若新版失败，再整体回退到旧版 `getuserinfo`。

这样可以保证：

- 新版主流程优先走现代接口。
- 搜索积分和统计在旧接口仍可用时保持完整。
- 当旧接口将来失效时，脚本仍然能跑主流程，只是个别统计字段会降级。

## 代码影响

预计涉及：

- `src/browser/BrowserFunc.ts`
- 新增一个适配器文件，建议放在 `src/browser/` 或 `src/interface/` 邻近目录
- `src/index.ts`
- 新增针对适配器的单元测试

`Workers.ts` 和活动实现预计不需要结构性改动。

## 错误处理

- 新版接口失败时记录 `GET-PANEL-FLYOUT-DATA` 相关日志，并进入旧版回退。
- 旧版补充请求失败时只记 `warn`，不让主流程报错退出。
- 适配器必须对缺失字段做空值保护，避免 `undefined` 访问导致的运行时异常。

## 测试策略

以适配器为核心做单元测试：

1. 新版面板数据可被转换成主流程所需的 `DashboardData` 子集。
2. 当未提供旧版补充数据时，搜索 counters 和 phase 1 未覆盖字段会落到安全默认值。
3. 当提供旧版补充数据时，兼容结果优先继承旧版 counters。
4. `BrowserFunc.getDashboardData()` 在 `modern` 模式下会优先走现代接口，并在现代失败时回退旧版。

## 非目标

- 不在本次修复 `punchCards` 与特殊推广活动。
- 不重写 `UrlRewardNew` 的接口协议。
- 不调整登录流程里“检测现代仪表盘”的逻辑，只消费已有判断结果。
