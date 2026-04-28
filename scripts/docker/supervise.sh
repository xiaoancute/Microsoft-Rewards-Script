#!/usr/bin/env bash
set -euo pipefail

cd /usr/src/microsoft-rewards-script

WEBUI_ENABLED="${WEBUI_ENABLED:-false}"
WEBUI_HOST="${WEBUI_HOST:-0.0.0.0}"
WEBUI_PORT="${WEBUI_PORT:-3000}"

declare -a CHILD_PIDS=()

start_child() {
    local label="$1"
    shift
    "$@" &
    local pid=$!
    CHILD_PIDS+=("$pid")
    echo "[supervisor] 已启动 ${label} (PID: ${pid})"
}

shutdown_children() {
    local pid
    for pid in "${CHILD_PIDS[@]:-}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    for pid in "${CHILD_PIDS[@]:-}"; do
        if kill -0 "$pid" 2>/dev/null; then
            wait "$pid" 2>/dev/null || true
        fi
    done
}

handle_signal() {
    echo "[supervisor] 收到退出信号，正在关闭子进程..."
    shutdown_children
    exit 0
}

trap handle_signal SIGINT SIGTERM

mkdir -p /var/log
touch /var/log/microsoft-rewards.log

start_child "log-forwarder" bash ./scripts/docker/log-forwarder.sh
start_child "cron" cron -f -l 2

if [[ "$WEBUI_ENABLED" == "true" ]]; then
    start_child "webui" node ./scripts/webui/server.js --host "$WEBUI_HOST" --port "$WEBUI_PORT"
else
    echo "[supervisor] WEBUI_ENABLED=false，跳过 WebUI 进程"
fi

if [[ ${#CHILD_PIDS[@]} -eq 0 ]]; then
    echo "[supervisor] 没有任何子进程被启动，退出。"
    exit 1
fi

set +e
wait -n "${CHILD_PIDS[@]}"
exit_code=$?
set -e

echo "[supervisor] 检测到子进程退出，准备停止剩余进程并交给 Docker 重启..."
shutdown_children
exit "$exit_code"
