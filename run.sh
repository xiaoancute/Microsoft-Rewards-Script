#!/usr/bin/env bash
# Microsoft Rewards Script - 一键运行
# 用法:
#   ./run.sh                     自检 + 自动装依赖/编译 + 启动
#   ./run.sh check               只做自检，不启动
#   ./run.sh build               强制重新编译
#   ./run.sh clear list          查看已保存的登录 session
#   ./run.sh clear email <邮箱>  清掉某个账号的 session
#   ./run.sh clear all           清掉全部 session

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
info() { printf '%s[*]%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s[+]%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s[!]%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
die()  { printf '%s[x]%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

node_major() { "$1" -v 2>/dev/null | sed -e 's/^v//' -e 's/\..*//'; }

find_node() {
    local c
    for c in "$HOME"/.local/node-v24*/bin/node "$HOME"/.nvm/versions/node/v24*/bin/node; do
        [ -x "$c" ] && { printf '%s' "$c"; return 0; }
    done
    if command -v node >/dev/null 2>&1; then
        local sys m
        sys="$(command -v node)"
        m="$(node_major "$sys")"
        if [ -n "$m" ] && [ "$m" -ge 24 ] 2>/dev/null; then
            printf '%s' "$sys"; return 0
        fi
    fi
    return 1
}

needs_build() {
    [ -f dist/index.js ] || return 0
    [ -n "$(find src package.json tsconfig.json -newer dist/index.js -print -quit 2>/dev/null)" ] && return 0
    return 1
}

do_build() {
    info "编译中…"
    if ! npm run build >/dev/null 2>&1; then
        npm run build
        die "编译失败"
    fi
    ok "编译完成"
}

MODE="${1:-}"
case "$MODE" in
    -h|--help|help)
        sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
    build)
        NODE_BIN="$(find_node)" && export PATH="$(dirname "$NODE_BIN"):$PATH"
        do_build
        exit 0
        ;;
    clear)
        NODE_BIN="$(find_node)" && export PATH="$(dirname "$NODE_BIN"):$PATH"
        shift
        exec npm run clear-sessions -- "$@"
        ;;
esac

NODE_BIN="$(find_node)" || die "没找到 Node >= 24。
装一个用户级版本（不需要 sudo）:
    mkdir -p ~/.local && curl -sSL https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz | tar -xJ -C ~/.local"

export PATH="$(dirname "$NODE_BIN"):$PATH"
command -v npm >/dev/null 2>&1 || die "PATH 里没有 npm，Node 安装不完整"
ok "Node $(node -v)  ($NODE_BIN)"

[ -f .env ] || { warn ".env 不存在，已从 env.example 复制，请填账号"; cp env.example .env; }
[ -f config.json ] || { warn "config.json 不存在，已从 config.example.json 复制"; cp config.example.json config.json; }

ACCOUNTS="$(awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*ACCOUNT_[0-9]+_/ {
        line = $0
        sub(/^[[:space:]]*/, "", line)
        eq = index(line, "=")
        if (eq == 0) next
        key = substr(line, 1, eq - 1)
        val = substr(line, eq + 1)
        gsub(/^[ \t]+|[ \t]+$/, "", val)
        gsub(/^["\047]|["\047]$/, "", val)
        n = split(key, p, "_")
        slot = p[2]
        field = p[3]
        for (i = 4; i <= n; i++) field = field "_" p[i]
        if (field == "EMAIL") mail[slot] = val
        if (field == "PASSWORD") pass[slot] = val
        if (field == "PROXY_URL") proxy[slot] = val
        if (field == "TOTP_SECRET") totp[slot] = val
        slots[slot] = 1
    }
    END {
        for (s in slots) {
            if (mail[s] == "" || mail[s] == "email@example.com") continue
            printf "%s|%s|%s|%s|%s\n", s, mail[s],
                (pass[s] == "" || pass[s] == "your_password") ? "0" : "1",
                (totp[s] != "") ? "1" : "0",
                (proxy[s] != "") ? proxy[s] : "-"
        }
    }
' .env | sort -n)"

if [ -z "$ACCOUNTS" ]; then
    die "没有找到可用账号。编辑 .env，把这两行改成真实信息后重跑:
    ACCOUNT_1_EMAIL=你的邮箱
    ACCOUNT_1_PASSWORD=你的密码"
fi

ok "找到以下账号:"
MISSING_PASS=""
while IFS='|' read -r slot mail haspass hastotp proxy; do
    [ -n "$slot" ] || continue
    line="    槽位 $slot: $mail"
    [ "$haspass" = "1" ] || { line="$line  (缺密码)"; MISSING_PASS=1; }
    [ "$hastotp" = "1" ] && line="$line  [2FA]"
    [ "$proxy" != "-" ] && line="$line  [代理]"
    printf '%s\n' "$line"
done <<< "$ACCOUNTS"
[ -z "$MISSING_PASS" ] || die "有账号没填密码，先在 .env 里补上"

if [ "$MODE" = "check" ]; then
    ok "自检通过，跑 ./run.sh 就能启动"
    exit 0
fi

if [ ! -d node_modules ]; then
    info "首次运行，安装依赖…"
    npm install || die "npm install 失败，看上面的报错"
    ok "依赖装好了"
fi

if [ ! -d "$HOME/.cache/ms-playwright" ]; then
    info "下载浏览器（约 290MB，只下一次）…"
    node ./scripts/main/installBrowser.js || die "浏览器下载失败"
fi

if needs_build; then do_build; else ok "代码没变动，跳过编译"; fi

echo
info "启动脚本（Ctrl+C 停止）"
echo
exec node ./dist/index.js
