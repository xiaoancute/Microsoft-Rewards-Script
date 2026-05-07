# 微软奖励脚本

一个尽量省心、适合中文用户的 Microsoft Rewards 自动化脚本。  
基于 TypeScript + Patchright（Playwright 兼容）实现，支持多账号、会话持久化、本地 Web 管理页、Docker 和定时运行。

本项目 fork 自 [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script)，在上游基础上增加了中文本地化、中文热搜、PushPlus、Web 管理页、Linux 一键脚本等更适合中文用户自用的能力。感谢原作者。

> 最后一次同步上游：见 `git log`。  
> fork 独有行为与额外说明可参考 `CLAUDE.md`。

---

## 这个项目适合谁

适合：

- 想长期自用 Microsoft Rewards 的人
- 想少改 JSON，更多通过网页管理账号、会话、配置和日志的人
- 想在 Linux / Docker / VPS 上稳定跑的人

不太适合：

- 想零风险使用自动化的人
- 不愿意手动处理首次登录、验证码、风控提示的人
- 想把它当成“永不维护”的一次性脚本的人

---

## 它能做什么

- 多账户运行、会话持久化、2FA / 无密码登录
- 桌面 + 移动端搜索、中文热搜词
- 每日任务、打卡、签到、阅读赚取、测验、投票、此或彼
- 地理位置定位、代理支持
- Discord / ntfy / PushPlus 通知
- Docker 定时运行 + 本地日志保存
- 本地 Web 管理页：账号、Session、配置、定时、环境、运行日志、历史日志、收益报表

---

## 从这里开始

### 我是第一次用

推荐直接走 Linux / macOS 终端下的一键路径：

```bash
git clone https://github.com/<你的用户名>/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
./setup.sh && ./manage.sh
```

跑完之后：

1. 打开本地管理页 `http://127.0.0.1:3000`
2. 在「账号」里添加微软账号
3. 在「Session」里点 `打开浏览器`，手动完成一次登录
4. 在「运行 & 日志」里点 `立即运行`

如果你只想先跑一轮、不想开管理页：

```bash
./run.sh
```

---

### 我已经会用，只想速查

常用命令：

```bash
# 安装依赖
npm install

# 构建
npm run build

# 直接运行脚本
npm start

# 启动 Web 管理页
npm run webui

# 打开某个账号的登录浏览器
npm run open-session -- -email 你的邮箱@outlook.com

# 清空所有 session
npm run clear-sessions

# Docker
docker compose up -d
docker compose logs -f
docker compose down
```

关键路径：

- 账号配置：`config/accounts.json`
- 主配置：`config/config.json`
- Session：`sessions/<邮箱>/`
- 运行日志：`logs/YYYY-MM-DD.log`
- 收益报表：`reports/earnings.jsonl`

---

## 推荐安装方式

### 方式 A：Linux 一键脚本

最推荐第一次用的人走这个。

```bash
git clone https://github.com/<你的用户名>/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
./setup.sh && ./manage.sh
```

它会帮你做这些事：

- 安装 Node 24（通过 `nvm`，尽量不污染系统）
- 安装 npm 依赖
- 安装 Chromium 和系统库
- 启动本地 Web 管理页

支持的发行版包括：

- Debian / Ubuntu
- Arch
- Fedora
- openSUSE
- Alpine

管理页里最常用的 4 个动作：

- 「账号」：添加 / 修改账号
- 「Session」：打开浏览器完成手动登录
- 「配置」：改任务开关、搜索间隔、并发数
- 「运行 & 日志」：立即运行并看实时日志

远程服务器想打开管理页：

```bash
WEBUI_HOST=0.0.0.0 WEBUI_TOKEN=你的长随机串 ./manage.sh
```

默认只监听 `127.0.0.1`。如果暴露到公网，务必设置 `WEBUI_TOKEN`。

---

### 方式 B：Docker

适合纯服务器、长期挂机、自带重启和挂载目录的人。

#### 1. 安装 Docker

```bash
# Debian / Ubuntu
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

重新登录一次，让 docker 组生效。

#### 2. 拉代码并准备目录

```bash
git clone https://github.com/<你的用户名>/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script

mkdir -p config sessions logs reports
cp src/accounts.example.json config/accounts.json
cp src/config.example.json   config/config.json
```

#### 3. 填账号

编辑：

- `config/accounts.json`
- `config/config.json`

Docker 里请确保：

```json
"headless": true
```

#### 4. 看一下 `compose.yaml`

重点通常只改这几个：

```yaml
TZ: "Asia/Shanghai"
CRON_SCHEDULE: '0 7 * * *'
RUN_ON_START: 'true'
WEBUI_ENABLED: 'true'
WEBUI_TOKEN: '改成你自己的长随机串'
```

#### 5. 启动

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

默认管理页地址：

- `http://127.0.0.1:3000`

第一次进入需要输入 `WEBUI_TOKEN`。

Docker 下要注意：

- 可以看 session、删 session、看日志、跑任务
- 不能直接在容器里弹浏览器登录
- 不能在容器里直接重建 TypeScript 代码
- `config/`、`sessions/`、`logs/`、`reports/` 都在宿主机目录里持久化

如果你是第一次登录，建议先在本地桌面环境完成一次 `open-session`，再把 `sessions/` 带到 Docker。

---

### 方式 C：手动安装

适合想清楚知道每一步做了什么的人。

```bash
# 1. Node.js 24
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24

# 2. 拉代码并安装依赖
git clone https://github.com/<你的用户名>/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
npm install

# 3. 安装 Chromium
npx patchright install chromium

# Debian / Ubuntu 额外系统库
sudo npx patchright install-deps chromium
```

然后准备配置并运行：

```bash
mkdir -p config
cp src/accounts.example.json config/accounts.json
cp src/config.example.json   config/config.json

npm run build
npm start
```

> 改 `config/accounts.json` 或 `config/config.json` 后，下次运行立即生效。  
> 只有代码改动时，才需要重新 `npm run build`。

---

## 其他平台

### Windows

```text
1. 下载或克隆代码
2. 运行 setup.bat
3. 编辑 config/accounts.json
4. 编辑 config/config.json
5. 运行 run.bat 或 npm start
```

### macOS

基本和 Linux 手动安装一致。  
如果要做本地定时，可参考 `scripts/mac/local.npm-start.plist` 配合 `launchctl`。

### NixOS

```bash
nix develop
xvfb-run npm start
```

或直接：

```bash
./scripts/nix/run.sh
```

---

## 第一次跑通的最短路径

如果你只关心“我到底先做哪几步”，照这个顺序来：

1. 跑 `./setup.sh && ./manage.sh`
2. 打开管理页
3. 添加账号
4. 打开浏览器完成一次手动登录
5. 在「配置」里确认 `headless`、任务开关和搜索间隔
6. 在「运行 & 日志」里点 `立即运行`
7. 如果没问题，再决定要不要上 Docker 或 systemd 定时

---

## 常用操作速查

### 运行相关

```bash
./run.sh
npm start
npm run webui
```

### Session 相关

```bash
npm run open-session -- -email 你的邮箱@outlook.com
npm run clear-sessions
```

### 定时运行

Linux 非 Docker 最简单：

```bash
scripts/linux/install-systemd.sh
```

如果你想让关机后也能触发：

```bash
sudo loginctl enable-linger $USER
```

### Docker 相关

```bash
docker compose up -d
docker compose logs -f
docker compose restart
docker compose down
```

---

## 配置怎么改

### 你最常改的 5 项

1. `config/accounts.json`
   放账号、密码、2FA、代理

2. `config/config.json -> headless`
   Docker 必须 `true`

3. `config/config.json -> clusters`
   多账户并发数

4. `config/config.json -> workers.*`
   哪些任务要跑，哪些不要跑

5. `config/config.json -> searchSettings.*`
   搜索间隔、点击结果概率、阅读间隔、安静时段

---

### `accounts.json` 示例

```jsonc
{
    "email": "your@outlook.com",
    "password": "yourpassword",
    "totpSecret": "",
    "recoveryEmail": "",
    "geoLocale": "auto",
    "langCode": "zh",
    "proxy": {
        "proxyAxios": false,
        "url": "",
        "port": 0,
        "username": "",
        "password": ""
    },
    "saveFingerprint": {
        "mobile": true,
        "desktop": true
    }
}
```

### Session 存哪里

登录成功后，cookie 和指纹会保存到：

- 本地：`sessions/<邮箱>/`
- Docker：宿主机 `./sessions/<邮箱>/`

`config.json` 里的 `sessionPath` 表示“项目根目录下的目录名”，默认是 `sessions`。

建议你定期备份这个目录。  
只要 session 还有效，下次运行通常不用重新登录。

### 不想改 JSON？直接用管理页

```bash
./manage.sh
# 或
npm run webui
```

WebUI 相关环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WEBUI_HOST` | `127.0.0.1` | 监听地址 |
| `WEBUI_PORT` | `3000` | 监听端口 |
| `WEBUI_TOKEN` | 空 | 远程访问时建议设置 |

---

## 配置参考

### 核心配置

| 设置 | 描述 | 默认值 |
|------|------|--------|
| `baseURL` | Microsoft Rewards 网址 | `https://rewards.bing.com` |
| `sessionPath` | 浏览器会话目录 | `sessions` |
| `headless` | 无头模式（Docker 必须 `true`） | `false` |
| `clusters` | 并发账户进程数 | `1` |
| `globalTimeout` | 操作超时（可写 `30sec` / `50sec`） | `50sec` |
| `errorDiagnostics` | 失败时保存截图到 `diagnostics/` | `false` |
| `searchOnBingLocalQueries` | 用本地查询而不是 Google 热搜接口 | `false` |

### 任务开关

| 设置 | 描述 | 默认值 |
|------|------|--------|
| `workers.doDailySet` | 每日任务集 | `true` |
| `workers.doMorePromotions` | 更多推广 | `true` |
| `workers.doPunchCards` | 打卡 | `true` |
| `workers.doDesktopSearch` | 桌面搜索 | `true` |
| `workers.doMobileSearch` | 移动搜索 | `true` |
| `workers.doDailyCheckIn` | 每日签到 | `true` |
| `workers.doReadToEarn` | 阅读赚取 | `true` |

### 搜索与行为设置

| 设置 | 描述 | 默认值 |
|------|------|--------|
| `searchSettings.queryEngines` | 热搜来源（`china` / `google` / `wikipedia` / `reddit` / `local`） | `["china","local"]` |
| `searchSettings.searchDelay` | 搜索间隔（lognormal 长尾分布） | `5min - 9min` |
| `searchSettings.readDelay` | 阅读赚取文章间隔 | `6min - 11min` |
| `searchSettings.searchResultVisitTime` | 点击搜索结果后的停留时间 | `8sec - 45sec` |
| `searchSettings.scrollRandomResults` | 是否分步滚动搜索页 | `true` |
| `searchSettings.clickRandomResults` | 点击随机结果的概率 | `0.6` |
| `searchSettings.parallelSearching` | 桌面 + 移动并行搜索 | `false` |
| `quietHours.enabled` | 启用安静时段 | `false` |
| `quietHours.start` / `.end` | 安静区间（24h） | `01:00 / 06:00` |

> 项目里还有一部分“默认生效、无独立开关”的风控友好逻辑，比如搜索失败指数退避、打字停顿、集群共享 IP 告警等。这些不需要你单独配置。

### 通知

| 设置 | 描述 |
|------|------|
| `webhook.discord` | Discord 推送 |
| `webhook.ntfy` | ntfy 推送 |
| `webhook.pushplus` | PushPlus（微信，仅每日汇总） |

PushPlus 只需要填 `token`。  
官网：<https://pushplus.plus>

---

## 日志、报表、排障文件在哪

这是最常被问到的一块，单独放这里。

- 运行日志：`logs/YYYY-MM-DD.log`
- 收益报表：`reports/earnings.jsonl`
- Session：`sessions/<邮箱>/`
- 错误截图（如果打开 `errorDiagnostics`）：`diagnostics/`

WebUI 里对应关系：

- 「运行 & 日志」：看当前这次运行的实时输出
- 「历史日志」：看 `logs/` 里的按天日志
- 「收益报表」：看 `reports/earnings.jsonl` 聚合结果

如果你要找我继续排障，最有用的通常是：

1. `logs/今天日期.log`
2. 如果是收益异常，再加 `reports/earnings.jsonl`

---

## 常见问题

### `Error: browserType.launch: Executable doesn't exist`

Chromium 没装好。

```bash
npx patchright install chromium
```

Linux 还可能缺系统库：

```bash
sudo npx patchright install-deps chromium
```

或者用管理页「环境」里的修复入口。

### `Missing X server or $DISPLAY`

常见于 Linux 下把管理页装成 systemd user service 后，又想看有头浏览器。

简单理解：

- systemd user 默认拿不到桌面会话里的 `$DISPLAY`
- 所以它更适合跑 `headless: true`
- 想看着浏览器登录，请从桌面终端手动运行

### 登录卡在密码页 / 人机验证 / 验证码

先别在无头模式里硬调。

直接跑：

```bash
npm run open-session -- -email 你的邮箱@outlook.com
```

弹出浏览器后手动走完一次登录，session 保存成功后，后续自动运行通常就顺很多。

### 改了 `config.json` 或 `accounts.json` 没生效

现在统一读取：

- `config/config.json`
- `config/accounts.json`

改完后：

- 本地运行：下次启动立即生效
- Docker：`docker compose restart`

只有改了 TypeScript 代码，才需要重新 `npm run build`。

### 多账户怎么更快

把 `clusters` 调大。

但要注意：

- 每个进程都会占用更多内存
- 多账号共用同一出口 IP，风险会明显上升
- 如果没有独立代理，建议不要盲目开很高并发

### 管理页显示「403 默认仅允许本机访问」

说明你在远程服务器上直接起了本地模式管理页。

两个常见方案：

1. SSH 端口转发

```bash
ssh -L 3000:127.0.0.1:3000 user@server
```

2. 允许远程访问并设置 token

```bash
WEBUI_HOST=0.0.0.0 WEBUI_TOKEN=你的长随机串 ./manage.sh
```

### Docker 容器跑了但没看到日志

先看：

```bash
docker compose logs -f
```

再看：

```bash
./diagnose-cron.sh <容器名>
```

### Docker 里的管理页到底能不能用

现在可以。

但它不是“桌面版功能 100% 原样复制”。

Docker 模式下：

- 可以看账号、配置、日志、收益、session
- 可以立即触发任务
- 不支持直接弹浏览器登录
- 不支持 systemd 管理
- 不支持在容器里重新构建 TypeScript 代码

### 我被封号了怎么办

建议顺序：

1. 先停掉该账号
2. 看是不是 IP 风险，而不是账号本身问题
3. 看历史日志和告警时间点，定位是登录出问题还是搜索行为过猛

如果你是多账号共用 VPS IP，被一起风控并不罕见。

---

## 更新日志

- 2025-06-24 添加移动端活动领取
- 2025-06-25 添加中文热搜
- 2025-07-10 允许 `useLocale` 自定义地区
- 2025-07-26 添加本地日志保存
- 2025-11-11 改回 npm 管理（pnpm 导致编译问题）；补充 Docker 说明
- 2026-04-19 上线本地 Web 管理页、Linux 一键脚本、systemd 定时与更人性化的行为模拟

---

## 免责声明

使用自动化脚本存在风险，包括但不限于：

- 账号被暂停
- 任务收益异常
- 登录需要人工重新验证

请把它当成“自担风险的个人工具”，不是官方支持方案。  
本项目仅供学习和研究使用，因使用脚本导致的任何账号问题，作者不承担责任。
