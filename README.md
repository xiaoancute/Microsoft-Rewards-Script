# 微软奖励脚本

自动化完成 Microsoft Rewards（必应奖励）的每日任务，使用 TypeScript + Playwright 编写。

本项目 fork 自 [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) ，主要做了**中文本地化**（中文热搜词、日志翻译、PushPlus 推送等），方便国内用户使用。感谢原作者。若有侵权请联系删除。

> 最后一次同步上游：见 git log（近期通常每月一次）。fork 特有功能在 `CLAUDE.md` 有完整说明。

---

## ✨ 功能

- ✅ 多账户并行、会话持久化、2FA / 无密码登录
- ✅ 桌面 + 移动端搜索、中文热搜词
- ✅ 每日任务、打卡、签到、阅读赚取、测验、投票、此或彼
- ✅ 地理位置定位、代理支持
- ✅ Discord / ntfy / **PushPlus**（微信）通知
- ✅ Docker 定时任务 + 本地日志保存
- ✅ 集群多账户并发
- ✅ **小白友好的本地 Web 管理页**：点鼠标加账号、登录、改配置、跑任务、看日志

---

## 🐧 Linux 部署（推荐新手看这里）

### 方式零：三条命令一把梭（最推荐）

```bash
git clone https://github.com/<你的用户名>/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
./setup.sh && ./manage.sh
```

- `setup.sh` 自动装 Node 24（用 nvm，不污染系统）、npm 依赖、Chromium 浏览器 + 系统库，识别 Debian/Ubuntu/Arch/Fedora/openSUSE/Alpine。
- `manage.sh` 启动本地 Web 管理页（默认 <http://127.0.0.1:3000>），自动打开浏览器。在页面里：
  - 「账号」Tab 点 `+ 添加账号` 填邮箱和密码
  - 「Session」Tab 点 `打开浏览器` → 弹出 Chromium 让你手动登录，关窗后 session 自动保存
  - 「配置」Tab 勾选任务开关、调搜索间隔
  - 「运行 & 日志」Tab 点 `立即运行`，日志实时滚动
- 想让脚本每天自动跑（不用 Docker）：`scripts/linux/install-systemd.sh`，装完就是 systemd user timer。

> 不想开 Web 页？`./run.sh` 立即跑一轮，就相当于 Windows 的 `run.bat`。
>
> 远程访问管理页（如 VPS）：`WEBUI_HOST=0.0.0.0 WEBUI_TOKEN=你的长随机串 ./manage.sh`，然后用 Bearer token 登录。默认只绑 `127.0.0.1`。

---

### 方式一：Docker 部署（适合纯服务器）

**1. 安装 Docker**（如果没装过）

```bash
# Debian / Ubuntu
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 把自己加到 docker 组，重新登录后生效
```

**2. 拉取代码**

```bash
git clone https://github.com/<你的用户名>/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
```

**3. 准备配置目录**

Docker 会把宿主机的 `./config` 目录挂载到容器里。先把示例文件放进去：

```bash
mkdir -p config sessions
cp src/accounts.example.json config/accounts.json
cp src/config.example.json   config/config.json
```

**4. 填写账号信息**

编辑 `config/accounts.json`，把 `email_1`、`password_1` 替换成你的真实微软账号：

```bash
nano config/accounts.json   # 或者用 vim / vscode 都行
```

**5. 调整 `config/config.json`**

Docker 里必须是无头模式，把 `headless` 改成 `true`：

```bash
sed -i 's/"headless": false/"headless": true/' config/config.json
```

其它选项按需调整，常用项见文末 [配置参考](#配置参考)。

**6. 配置 `compose.yaml`**

打开 `compose.yaml`，重点看这几行：

```yaml
TZ: "Asia/Shanghai"          # 时区，保持不变
CRON_SCHEDULE: '0 7 * * *'   # 每天几点跑，默认早上 7 点
RUN_ON_START: 'true'         # 容器启动时立即跑一次
```

> 不懂 cron 语法？到 [crontab.guru](https://crontab.guru) 生成即可。

**7. 启动**

```bash
docker compose up -d       # 后台启动
docker compose logs -f     # 查看实时日志，Ctrl+C 退出日志（容器不会停）
docker compose down        # 停止容器
```

**首次登录提示**：如果账号登不进去，脚本会留一个窗口让你手动完成登录。无头模式下看不到窗口，建议第一次在本地先用「方式二」跑一次把 `sessions/` 目录生成好，再丢进 Docker。

---

### 方式二：手动分步（想了解 setup.sh 在做啥）

```bash
# 1. Node.js 24
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 24 && nvm use 24

# 2. 代码 + 依赖
git clone https://github.com/<你的用户名>/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
npm install

# 3. Chromium 本体 + 系统库
npx patchright install chromium
sudo npx patchright install-deps chromium  # Debian/Ubuntu 专用
# Arch: sudo pacman -S --needed nss atk at-spi2-atk libdrm libxkbcommon mesa libxcomposite libxdamage libxrandr libgbm libxss alsa-lib gtk3
# Fedora: sudo dnf install nss atk at-spi2-atk libdrm libxkbcommon mesa-libgbm libXcomposite libXdamage libXrandr libXScrnSaver alsa-lib gtk3

# 4. 准备配置
cp src/accounts.example.json src/accounts.json
cp src/config.example.json   src/config.json
# 然后编辑账号和偏好

# 5. 构建并跑
npm run build
npm start              # 或 npm run webui 启动管理页
```

> ⚠️ **改了 `src/accounts.json` 或 `src/config.json` 必须重新 `npm run build`**（或 `npm run ts-start` 免编译跑源码）。用管理页修改的话自动改 `src/`，仍然需要重建才能影响 `npm start`。

---

### 让它在 Linux 上定时跑（不想用 Docker 的话）

最简单：

```bash
scripts/linux/install-systemd.sh     # 自动生成并启用 systemd user timer，默认每天 07:00
```

改时间：编辑 `~/.config/systemd/user/microsoft-rewards.timer` 里的 `OnCalendar`，然后 `systemctl --user daemon-reload`。

关机后也想触发（关键！）：

```bash
sudo loginctl enable-linger $USER
```

也支持传统 crontab（详见 `scripts/linux/install-systemd.sh` 脚本打印的提示），不再赘述。

---

## 🪟 Windows 部署

1. 下载或克隆源代码
2. 运行 `setup.bat` 一键部署（如果失败请参考上面「方式二」的手动步骤）
3. 在 `dist/` 目录的 `accounts.json` 里填账号
4. 按需修改 `dist/config.json`
5. 运行 `run.bat` 或 `npm start` 启动

## 🍎 macOS 部署

基本同 Linux「方式二」，多账户定时可用 `scripts/mac/local.npm-start.plist` 配合 `launchctl`。

## ❄️ NixOS 部署

```bash
nix develop          # 进入 shell，自动 npm i + npm run build
xvfb-run npm start   # 或直接 ./scripts/nix/run.sh
```

---

## ⚙️ 配置文件

### accounts.json（账号信息）

```jsonc
{
    "email": "your@outlook.com",
    "password": "yourpassword",
    "totpSecret": "",           // 如果开了 2FA 填这里
    "recoveryEmail": "",        // 辅助邮箱（可选）
    "geoLocale": "auto",        // 地区，auto 会自动探测
    "langCode": "zh",
    "proxy": {                  // 不用代理就留空
        "proxyAxios": false,
        "url": "",
        "port": 0,
        "username": "",
        "password": ""
    },
    "saveFingerprint": {        // 保存浏览器指纹，建议开
        "mobile": true,
        "desktop": true
    }
}
```

### 会话目录

登录成功后，cookie 和指纹会保存到：

- 源码运行：`src/browser/sessions/<邮箱>/`
- 构建后运行：`dist/browser/sessions/<邮箱>/`
- Docker：宿主机 `./sessions/<邮箱>/`（由 volume 挂载）

**多备份这个目录**，下次运行就不用重新登录了。

### 不想改 JSON？用管理页

```bash
./manage.sh        # 或 npm run webui
```

环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `WEBUI_HOST` | `127.0.0.1` | 监听地址。改 `0.0.0.0` 允许远程 |
| `WEBUI_PORT` | `3000` | 监听端口 |
| `WEBUI_TOKEN` | 空 | 设后强制 Bearer 鉴权（远程访问必填） |

---

## 配置参考

### 核心
| 设置 | 描述 | 默认值 |
|------|------|--------|
| `baseURL` | Microsoft Rewards 网址 | `https://rewards.bing.com` |
| `sessionPath` | 浏览器会话目录 | `sessions` |
| `headless` | 无头模式（Docker 必须 true） | `false` |
| `clusters` | 并发账户进程数 | `1` |
| `globalTimeout` | 操作超时（可写 `30sec`/`50sec`） | `50sec` |
| `errorDiagnostics` | 失败时保存截图到 `diagnostics/` | `false` |
| `searchOnBingLocalQueries` | 把查询引擎得到的词在必应本地搜而非 Google 热搜接口 | `false` |

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

### 搜索 & 人性化
| 设置 | 描述 | 默认值 |
|------|------|--------|
| `searchSettings.queryEngines` | 热搜来源（`china`/`google`/`wikipedia`/`reddit`/`local`） | `["china","local"]` |
| `searchSettings.searchDelay` | 搜索间隔（长尾 lognormal 分布，多数靠近 min，偶尔接近 max） | `5min - 9min` |
| `searchSettings.readDelay` | 阅读赚取文章间隔（同样走长尾） | `6min - 11min` |
| `searchSettings.searchResultVisitTime` | 点进搜索结果后的停留时间。可写 `"20sec"` 或 `{min, max}` 随机区间 | `8sec - 45sec` |
| `searchSettings.scrollRandomResults` | 随机分步滚动搜索页（4-8 步 `mouse.wheel` + 抖动，模拟真人而非瞬移） | `true` |
| `searchSettings.clickRandomResults` | 点击随机结果的概率。`true`=1.0，`false`=0，或直接写 `0-1` 之间的小数 | `0.6` |
| `searchSettings.parallelSearching` | 并行跑桌面+移动搜索（更快但更可疑） | `false` |
| `quietHours.enabled` | 启用安静时段（真人凌晨不搜索）。`start`>`end` 自动识别为跨午夜 | `false` |
| `quietHours.start` / `.end` | 安静区间，`"HH:MM"` 24h 制 | `01:00 / 06:00` |

> 💡 **隐含的风控机制**（无配置项，直接生效）：
> 搜索失败指数退避（8s × 2ⁿ，clamp 15min）；打字按 gamma-like 分布逐字符延迟 + 5% 思考停顿 + 空格前后减速；账号被封/暂停时 `Logger.alert()` 绕过 `webhookLogFilter` 强制推送告警；`clusters>1` 且多账号无代理时启动 WARN。

### 通知 webhook
| 设置 | 描述 |
|------|------|
| `webhook.discord` | Discord 推送 |
| `webhook.ntfy` | ntfy 推送 |
| `webhook.pushplus` | PushPlus（微信）**仅推送每日汇总** |

PushPlus 填 `token` 即可（[pushplus.plus](https://pushplus.plus) 申请）。

---

## 🛠️ 常见问题

**Q：`Error: browserType.launch: Executable doesn't exist`**
A：Chromium 没装。跑 `npx patchright install chromium`。Linux 还可能缺系统库，跑 `sudo npx patchright install-deps chromium`（或管理页「环境」Tab 点「Chromium 系统库」一键修）。

**Q：`Missing X server or $DISPLAY` / 管理页运行失败但终端直接 `npm start` 就行**
A：管理页被装成了 systemd user service，systemd user 默认不继承桌面会话的 `$DISPLAY`，所以只能 `headless: true` 跑。生产就开 headless；要看着浏览器跑，从桌面终端手动 `npm start`（那个 shell 有 DISPLAY）。非要让 systemd 起的管理页也有头，选项见 `CLAUDE.md` 或[相关 issue/commit]。

**Q：登录时一直卡在密码页 / 人机验证**
A：用 `npm run open-session -- -email 你的邮箱@outlook.com` 在桌面终端里跑一次，弹出窗口手动完成登录（验证码也能过），会话保存后再回到管理页就自动了。别在无头模式下调登录——看不到页面排查不了。

**Q：改了 `config.json`/`accounts.json` 没生效**
A：管理页里改的会直接写 `src/config.json` / `src/accounts.json`。但 `npm start` 跑的是 `dist/` 的编译产物，改完必须在管理页点「重新构建」或 `npm run build`。Docker 跑的话编辑 `./config/*.json` 后 `docker compose restart` 就生效。

**Q：多账户怎么跑得更快？**
A：在管理页「配置」Tab 把 `clusters` 调大（比如账号数 / 2）。注意每个进程一份 Chromium 很吃内存，而且**多账号共享同一出口 IP 很容易被批量封号**——建议每账号配独立代理（没配的话启动时会有 WARN）。

**Q：管理页显示「403 默认仅允许本机访问」**
A：你在远程机子（VPS）上起了 `./manage.sh`。要么 SSH 端口转发 `ssh -L 3000:127.0.0.1:3000 user@server`，要么 `WEBUI_HOST=0.0.0.0 WEBUI_TOKEN=<长随机串> ./manage.sh`（推荐设强 token，不要裸开公网）。

**Q：Docker 容器跑起来但没输出日志**
A：跑 `./diagnose-cron.sh <容器名>` 诊断 cron 状态，或者 `docker compose logs -f`。

**Q：管理页能在 Docker 里用吗？**
A：**暂不行**。当前 Dockerfile 没把 `scripts/webui/` 复制进镜像，容器里只有 cron。在 Docker 里管理账号仍然是改挂载的 `./config/*.json` 然后重启容器。Web UI 的 Docker 整合列入后续计划但未完成。

**Q：我被封号了怎么办？**
A：①停掉该账号（管理页「账号」Tab 删掉，或临时 `accounts.json` 里注释掉）。②看是不是 IP 被标——多账号共享 IP / VPS IP 段被批量封是常见原因。③封号告警会通过 Discord/ntfy/PushPlus 强制推送（即便你设了 `webhookLogFilter`），可以据此定位什么时候被封的。

---

## 📝 更新日志

- 2025-06-24 添加移动端活动领取
- 2025-06-25 添加中文热搜
- 2025-07-10 允许 `useLocale` 自定义地区
- 2025-07-26 添加本地日志保存
- 2025-11-11 改回 npm 管理（pnpm 导致编译问题）；补充 Docker 说明
- 2026-04-19 上线一套大更新：
  - 🎁 **本地 Web 管理页**：账号 / Session / 配置 / 定时 / 环境 / 运行日志 / 历史日志 7 个 Tab，日间 + 夜间模式
  - 🐧 **Linux 一键脚本**：`setup.sh` / `run.sh` / `manage.sh`，识别 Debian/Ubuntu/Arch/Fedora/openSUSE/Alpine
  - ⏰ **systemd user timer** 一键安装（Web UI 也能自启）
  - 🧠 **行为人性化**：搜索/阅读/停留间隔改 lognormal 长尾分布、滚动改真实 `mouse.wheel` 分步、打字改 gamma-like delay + 思考停顿 + 词边界减速、点击结果改概率化（默认 0.6）、新增 `quietHours` 安静时段
  - 🛡️ **风控增强**：搜索失败指数退避（8s×2ⁿ clamp 15min）、dashboard 主动检测 `#suspendedAccountHeader`、封号告警独立通道绕过 webhookLogFilter、集群共享 IP 启动 WARN、Chromium args 对齐上游 v3
  - 🧹 **文档对齐代码**：删掉 README 里代码从未实现的字段（`runOnZeroPoints` / `humanization.*` / `stopOnBan` 等虚假承诺）

---

## ⚠️ 免责声明

**风险自负！** 使用自动化脚本可能导致 Microsoft Rewards 账户被暂停或封禁。本脚本仅供学习研究，因使用本脚本导致的任何账户问题，作者概不负责。
