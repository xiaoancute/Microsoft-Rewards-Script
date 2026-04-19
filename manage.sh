#!/usr/bin/env bash
# 启动 Web 管理页。默认监听 127.0.0.1:3000，尝试调用浏览器打开。
set -e
cd "$(dirname "$(readlink -f "$0")")"

# NVM 兼容
if ! command -v node >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi

PORT="${WEBUI_PORT:-3000}"
HOST="${WEBUI_HOST:-127.0.0.1}"

# 解析 --port/--host 命令行参数（只为拿到给 xdg-open 的地址，server 自己会再解一次）
while [ $# -gt 0 ]; do
    case "$1" in
        --port|-p) PORT="$2"; shift 2 ;;
        --host|-H) HOST="$2"; shift 2 ;;
        *) break ;;
    esac
done

URL="http://${HOST}:${PORT}"
echo "[manage.sh] 启动管理页: $URL"

# 起在后台监听一会儿，成功后再开浏览器（避免 xdg-open 打开时服务还没起来）
(
    sleep 1
    if command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
        xdg-open "$URL" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
        open "$URL" >/dev/null 2>&1 || true
    else
        echo "[manage.sh] 未检测到可用的浏览器命令，请手动访问: $URL"
    fi
) &

exec node ./scripts/webui/server.js --host "$HOST" --port "$PORT"
