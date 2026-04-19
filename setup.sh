#!/usr/bin/env bash
# Microsoft Rewards Script — Linux 一键安装
# 对标 setup.bat: 检测系统、装 Node 24、装 npm 依赖、装 Chromium (+系统库)、
# 准备 accounts.json / config.json、构建项目。

set -e
cd "$(dirname "$(readlink -f "$0")")"

# ─────────────────────────────────────────────────────────────────────────────
# 美化输出
# ─────────────────────────────────────────────────────────────────────────────

if [ -t 1 ]; then
    C_RESET=$'\e[0m'
    C_BOLD=$'\e[1m'
    C_BLUE=$'\e[34m'
    C_GREEN=$'\e[32m'
    C_YELLOW=$'\e[33m'
    C_RED=$'\e[31m'
else
    C_RESET=''; C_BOLD=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''
fi

step() { echo "${C_BLUE}${C_BOLD}==>${C_RESET}${C_BOLD} $*${C_RESET}"; }
ok()   { echo "${C_GREEN}✓${C_RESET} $*"; }
warn() { echo "${C_YELLOW}⚠${C_RESET} $*"; }
err()  { echo "${C_RED}✗${C_RESET} $*" >&2; }

# ─────────────────────────────────────────────────────────────────────────────
# 检测发行版
# ─────────────────────────────────────────────────────────────────────────────

DISTRO="unknown"
if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}${ID_LIKE:-}" in
        *debian*|*ubuntu*) DISTRO="debian" ;;
        *arch*)            DISTRO="arch" ;;
        *fedora*|*rhel*|*centos*) DISTRO="fedora" ;;
        *opensuse*|*suse*) DISTRO="suse" ;;
        *alpine*)          DISTRO="alpine" ;;
    esac
fi

step "检测系统: ${DISTRO}"

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 1. Node.js 24
# ─────────────────────────────────────────────────────────────────────────────

need_node=false
if ! command -v node >/dev/null 2>&1; then
    need_node=true
    warn "未检测到 node"
else
    current_major=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
    if [ -z "$current_major" ] || [ "$current_major" -lt 24 ] 2>/dev/null; then
        warn "检测到 node $(node -v)，版本过低，需要 >= 24"
        need_node=true
    else
        ok "node $(node -v) 已满足要求"
    fi
fi

if [ "$need_node" = "true" ]; then
    step "通过 nvm 安装 Node 24（不污染系统）"
    if ! command -v nvm >/dev/null 2>&1; then
        export NVM_DIR="$HOME/.nvm"
        if [ ! -d "$NVM_DIR" ]; then
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        fi
        # shellcheck disable=SC1091
        [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    fi
    if ! command -v nvm >/dev/null 2>&1; then
        err "nvm 安装失败，请手动安装 Node 24 后重试"
        exit 1
    fi
    nvm install 24
    nvm use 24
    ok "node $(node -v)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. npm 依赖
# ─────────────────────────────────────────────────────────────────────────────

step "安装 npm 依赖（首次可能较久）"
npm install
ok "npm install 完成"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Chromium + 系统库
# ─────────────────────────────────────────────────────────────────────────────

step "安装 Chromium（patchright）"
if ! npx patchright install chromium; then
    warn "下载 Chromium 失败，尝试继续"
fi

step "检查系统库"
install_deps() {
    case "$DISTRO" in
        debian)
            # patchright/playwright 官方 install-deps 对 debian 系最靠谱
            if ! npx patchright install-deps chromium 2>/dev/null; then
                $SUDO apt-get update
                $SUDO apt-get install -y --no-install-recommends \
                    libglib2.0-0 libdbus-1-3 libexpat1 libfontconfig1 libgtk-3-0 \
                    libnspr4 libnss3 libasound2 libatk1.0-0 libatspi2.0-0 \
                    libdrm2 libgbm1 libxkbcommon0 libx11-xcb1 libxcomposite1 \
                    libxcursor1 libxdamage1 libxfixes3 libxi6 libxrandr2 libxss1 libxtst6
            fi ;;
        arch)
            $SUDO pacman -S --needed --noconfirm \
                nss atk at-spi2-atk libdrm libxkbcommon mesa libxcomposite \
                libxdamage libxrandr libgbm libxss alsa-lib gtk3 || warn "pacman 部分包安装失败"
            ;;
        fedora)
            $SUDO dnf install -y \
                nss atk at-spi2-atk libdrm libxkbcommon mesa-libgbm libXcomposite \
                libXdamage libXrandr libXScrnSaver alsa-lib gtk3 || warn "dnf 部分包安装失败"
            ;;
        suse)
            $SUDO zypper install -y \
                mozilla-nss libatk-1_0-0 libdrm2 libxkbcommon0 libgbm1 libXcomposite1 \
                libXdamage1 libXrandr2 libXss1 libasound2 gtk3-tools || warn "zypper 部分包安装失败"
            ;;
        alpine)
            $SUDO apk add --no-cache nss freetype harfbuzz ca-certificates ttf-freefont \
                gtk+3.0 libxcomposite libxdamage libxrandr alsa-lib || warn "apk 部分包安装失败"
            ;;
        *)
            warn "未识别的发行版，跳过自动装系统库。若启动浏览器报 .so 缺失请手动安装 Chromium 依赖。"
            ;;
    esac
}
install_deps
ok "系统库检查完成"

# ─────────────────────────────────────────────────────────────────────────────
# 4. 准备 accounts.json 和 config.json
# ─────────────────────────────────────────────────────────────────────────────

step "准备配置文件"
if [ ! -f "src/accounts.json" ]; then
    cp src/accounts.example.json src/accounts.json
    ok "已生成 src/accounts.json（记得填入账号）"
else
    ok "src/accounts.json 已存在，保留现有内容"
fi
if [ ! -f "src/config.json" ]; then
    cp src/config.example.json src/config.json
    ok "已生成 src/config.json"
else
    ok "src/config.json 已存在，保留现有内容"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. 构建项目
# ─────────────────────────────────────────────────────────────────────────────

step "构建项目 (tsc)"
npm run build
ok "构建完成"

# ─────────────────────────────────────────────────────────────────────────────
# 完成提示
# ─────────────────────────────────────────────────────────────────────────────

cat <<EOF

${C_GREEN}${C_BOLD}安装完成！${C_RESET}

下一步，推荐使用小白管理页：

  ${C_BOLD}./manage.sh${C_RESET}        # 启动 Web 管理页（http://127.0.0.1:3000）

或者直接运行：

  ${C_BOLD}./run.sh${C_RESET}           # 一次性运行一轮任务
  ${C_BOLD}npm start${C_RESET}          # 同上

想让脚本每天定时跑：

  ${C_BOLD}scripts/linux/install-systemd.sh${C_RESET}   # 安装 systemd user timer

EOF
