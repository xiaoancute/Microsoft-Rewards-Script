# Microsoft Rewards 风控研究笔记

更新时间：2026-04-20

## 目的

这份文档用于整理 Microsoft Rewards 的风控机制，方便后续评估本仓库的实现风险。

范围包括：

- 官方规则和帮助文档
- 中文社区样本
- 英文社区样本
- 对当前项目的风险映射
- 当前配置项的风险分级

不包括：

- 规避风控的方法
- 绕过检测的实现建议
- 对封号后的申诉策略做详细指导

## 一页结论

把官方规则、中英文社区、以及本仓库的实现一起看，Microsoft Rewards 的风控更像是 5 层叠加：

1. 搜索真实性风控
2. 账户关联和批量作业风控
3. 地区、网络、手机号一致性风控
4. 奖励动作自动化风控
5. 兑换阶段的单独审核

对这个仓库来说，最危险的不是“点击是不是够像真人”，而是下面几件事：

1. 自动补满搜索积分
2. 多账号批量运行
3. 多账号共享出口 IP
4. 全量自动完成奖励任务
5. 某些活动直接走 API 完成奖励动作

一句话概括：

这个项目现在更像“经过拟人化处理的自动化作业器”，而不是“真人辅助工具”。

## 官方口径

### 1. 搜索必须是善意、手动、真实研究目的

官方规则已经明确写过，Rewards 的搜索应当是用户本人为了真实研究目的进行的手动搜索；程序、机器人、宏、快速连续搜索、乱输字母数字，都可能被视为异常。

这意味着：

- 风控不只看有没有结果页
- 也看搜索行为是否像真实使用
- “把分搜满”本身就可能构成风险信号

### 2. 账户、地区和兑换资格有单独规则

官方规则还明确提到：

- 一人只能使用一个 Rewards 账户
- 每户最多 6 个账户
- 仅限在支持市场使用
- VPN、VoIP、地区不一致、号码异常，都可能导致兑换失败或订单取消

这说明 Rewards 风控不是只盯搜索行为，还会盯：

- 账户之间的关系
- 地区和网络的一致性
- 兑换时的身份和号码可信度

### 3. 搜索限制和兑换限制不是一回事

官方帮助页和社区反馈都说明了一个事实：

- 搜索可能会被限流
- 兑换可能会被单独限制
- 即使还能赚分，也不代表可以安全兑换

我对这一点的判断是：

Rewards 很可能至少有一套“日常行为风控”和一套“兑换审核风控”。

## 中文社区观察

### 样本特征

中文社区里更常见的话题，不是“搜索被限 15 分钟”，而是：

- 兑换时提示区域或定位异常
- 订单处理中后被取消
- 手机号无法通过验证
- 国区目录、IP、定位权限之间不一致

这和英文社区的关注点不太一样。

### 中文社区的高频共识

中文社区里比较稳定的共识有：

- 多账号共享网络环境容易出问题
- 地区和 IP 不一致时，兑换更容易出问题
- 搜索本身不是唯一风险，兑换往往更严格
- VPS、机房 IP、跨区环境更容易触发额外审查

### 中文社区的不确定点

中文社区里也有很多“经验说法”，但证据不够硬：

- 是否会精确看设备指纹
- 是否会精确看某个浏览器特征
- 是否会对某些网络运营商或 IP 段做特殊标记

这些更像推测，不能当成定论。

## 英文社区观察

### 样本特征

英文社区里更常见的话题是：

- `unusual search activity`
- 搜几次后需要等 15 分钟
- 冷却时间从 15 分钟升到 30 分钟
- 还能赚分但兑换受限
- 被 restricted 后很难获得明确原因

### 英文社区的高频共识

英文社区里比较稳定的共识有：

- 搜索节律异常很容易先触发限流
- 兑换限制通常比搜索限流更难恢复
- 自动化项目用户更容易讨论浏览器环境和自动化痕迹
- 微软支持答复常常是模板化的，原因不透明

### 英文社区的额外信息

英文 GitHub 自动化社区会更多讨论这些问题：

- Selenium、Playwright、请求头、UA、浏览器自动化痕迹
- 是否需要保存会话和环境连续性
- 是否存在“还能赚分，但兑换不让过”的两阶段风控

这些讨论不能直接证明微软一定在用哪条具体规则，但能说明：

自动化社区普遍感知到“浏览器环境”和“行为模式”是风险面。

## 中英文社区放在一起后的结论

### 共识

中英文社区都基本同意下面几点：

- 搜索真实性很重要
- 自动化会提高风险
- 多账号和同源环境会提高风险
- 兑换风控和搜索风控不是同一层

### 差异

中英文社区的重点不同：

- 中文社区更关注地区、IP、定位、手机号、兑换
- 英文社区更关注搜索限流、冷却时间、自动化痕迹

我的判断是：

这不一定代表中外规则不同，更可能代表不同用户群更常撞到不同层的风控。

## 可信度分层

### 高可信

- 搜索必须是手动且出于真实研究目的
- 快速连续搜索、乱输字母数字、程序/机器人/宏存在明确风险
- 一人一个 Rewards 账户、每户最多 6 个账户
- 地区、VPN、VoIP、号码验证会影响兑换
- 搜索风控和兑换风控不是同一层

### 中可信

- 多账号共享 IP、共享设备环境，会提高被关联的概率
- 自动化任务完成链路，会提高整体风控分数
- 浏览器环境连续性对账户稳定性有一定影响

### 低到中可信

- 微软是否明确看某个具体浏览器指纹字段
- 微软是否明确看 MAC 地址
- 某个单独 HTTP 头是否会直接触发风控

这些说法在社区里很多，但公开证据不足。

## 对当前项目的风险映射

### 1. 搜索链路

相关文件：

- `src/functions/activities/browser/Search.ts`
- `src/functions/SearchManager.ts`
- `src/functions/QueryEngine.ts`

风险等级：很高

原因：

- 项目会自动生成和扩展查询词
- 项目会自动补满搜索积分
- 积分没拿满时会继续生成额外查询池
- 这依旧是“脚本安排搜索”，不是“用户自然搜索”

### 2. 批量账户链路

相关文件：

- `src/index.ts`
- `src/accounts.example.json`

风险等级：最高

原因：

- 支持 `clusters` 多进程批量跑账号
- 项目自己已经承认“多账号共享同一出口 IP 很容易被批量封号”
- 这是最接近“批量作业”的特征

### 3. 奖励任务链路

相关文件：

- `src/functions/Workers.ts`
- `src/functions/Activities.ts`
- `src/functions/activities/api/UrlRewardNew.ts`

风险等级：很高

原因：

- 不只是搜索，项目还会自动完成 Daily Set、More Promotions、App Promotions、签到、阅读
- 某些任务不是完整模拟用户操作，而是更直接地完成奖励动作

### 4. 浏览器环境和拟人化链路

相关文件：

- `src/browser/Browser.ts`
- `src/browser/BrowserUtils.ts`
- `src/util/Utils.ts`

风险等级：中

原因：

- 项目已经使用 `patchright`、指纹注入、`ghostClick`、`humanType`
- 还加了随机滚动、随机点击、长尾延迟、quiet hours
- 这些确实能降低“太机械”的痕迹
- 但它们不能改变“整个流程是自动化决定的”这一点

### 5. 兑换链路

当前仓库没有完整自动化兑换流程。

风险等级：仓库内直接风险较低，但账户整体风险仍在

原因：

- 本仓库的主要风险集中在赚分阶段
- 但即便赚分阶段没直接报错，到了兑换阶段仍可能触发另一套限制

## 配置项风险榜

下面按“把风险拉高的力度”排序。

### 第一档：最高风险

- `clusters`
- 多账号 `proxy.url` 为空，导致共享出口 IP
- `workers.doDesktopSearch = true`
- `workers.doMobileSearch = true`

这几项叠加时，最容易把项目推向“自动化批量搜索作业”。

### 第二档：很高风险

- `workers.doDailySet = true`
- `workers.doMorePromotions = true`
- `workers.doAppPromotions = true`
- `workers.doDailyCheckIn = true`
- `workers.doReadToEarn = true`
- `workers.doPunchCards = true`
- `workers.doSpecialPromotions = true`
- `searchSettings.parallelSearching = true`

这些会扩大项目自动完成奖励动作的覆盖面。

### 第三档：中高风险

- 所有账号共用同一组 `searchSettings.queryEngines`
- 不设置账号级 `queryEngines`
- `queryMutation = false`
- `saveFingerprint.mobile = false`
- `saveFingerprint.desktop = false`

这些会让多账号行为更同质化，或者让账户环境连续性变差。

### 第四档：中风险

- `quietHours.enabled = false`
- `searchSettings.searchDelay` 过短
- `searchSettings.readDelay` 过短
- `searchSettings.searchResultVisitTime` 太短或过于固定

这些会让项目的节律更不像真人。

### 第五档：较低但有影响

- `searchSettings.clickRandomResults` 取极端值
- `headless`
- `proxy.queryEngine`
- `proxyAxios`

这些有影响，但通常不是决定性风险源。

## 对“这个项目够不够像人”的判断

如果只看交互表面：

- 这个项目已经明显比传统脚本更像人

如果看微软真正可能关心的核心信号：

- 还不够像人

因为它仍然具备这些核心特征：

- 自动决定搜什么
- 自动决定何时补查询池
- 自动决定任务执行顺序
- 自动补满搜索积分
- 自动批量跑多个账号

所以更准确的表述应该是：

这个项目“像真人交互”，但“不像真人使用”。

## 最后的结论

对当前仓库来说：

- 单账号、串行、不开并行搜索、只启用部分任务时，风险是中高
- 多账号、`clusters > 1`、共享出口 IP、全任务开启时，风险是最高

风控上最危险的不是某个小开关没开，而是：

1. 多账号批量运行
2. 搜索全开并补满积分
3. 任务全开
4. 同源网络环境

## 参考来源

### 官方

- Microsoft Services Agreement  
  https://www.microsoft.com/en/servicesagreement/

- Limiting your searches in Microsoft Rewards  
  https://support.microsoft.com/en-au/topic/limiting-your-searches-in-microsoft-rewards-439be015-897e-4a5f-ae01-b3aff4ea2404

- 限制 Microsoft Rewards 中的搜索  
  https://support.microsoft.com/zh-cn/topic/%E9%99%90%E5%88%B6microsoft-rewards-%E4%B8%AD%E7%9A%84%E6%90%9C%E7%B4%A2-439be015-897e-4a5f-ae01-b3aff4ea2404

- 如何兑换 Microsoft Rewards 积分  
  https://support.microsoft.com/zh-cn/account-billing/%E5%A6%82%E4%BD%95%E5%85%91%E6%8D%A2-microsoft-rewards-%E7%A7%AF%E5%88%86-52f5f51f-38ed-3a9b-b6e1-8308dd49a3c3

- 为什么我的 Microsoft 奖励订单已取消  
  https://support.microsoft.com/zh-cn/topic/%E4%B8%BA%E4%BD%95%E6%88%91%E7%9A%84-microsoft-%E5%A5%96%E5%8A%B1%E8%AE%A2%E5%8D%95%E5%B7%B2%E5%8F%96%E6%B6%88-5c680077-ccf6-219f-71e5-139ae572eb18

### 中文社区

- V2EX，2023-08-23  
  https://v2ex.com/t/967572

- V2EX，2025  
  https://jp.v2ex.com/t/1159700

- V2EX 浏览器扩展讨论，2025-08-09  
  https://cn.v2ex.com/t/1151179

- 百度贴吧，2025-01-04  
  https://tieba.baidu.com/p/9386640343

### 英文社区

- GitHub Discussion #264  
  https://github.com/charlesbel/Microsoft-Rewards-Farmer/discussions/264

- GitHub Issue #178  
  https://github.com/charlesbel/Microsoft-Rewards-Farmer/issues/178

- Microsoft Q&A，2025-07-31  
  https://learn.microsoft.com/en-us/answers/questions/5510352/microsoft-rewards-account-is-temporarily-restricte

- Microsoft Q&A，2025-10-26  
  https://learn.microsoft.com/en-us/answers/questions/5598691/microsoft-reward-restricted

- Reddit 样本 1  
  https://www.reddit.com/r/MicrosoftRewards/comments/1jk18z7

- Reddit 样本 2  
  https://www.reddit.com/r/MicrosoftRewards/comments/1mw63dm

- Reddit 样本 3  
  https://www.reddit.com/r/MicrosoftRewards/comments/1nkjjlr
