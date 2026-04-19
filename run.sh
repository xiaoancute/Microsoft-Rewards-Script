#!/usr/bin/env bash
# 一次性运行一轮微软奖励任务（对标 run.bat）
set -e
cd "$(dirname "$(readlink -f "$0")")"

# 如果 NVM 装的 node 未在 PATH，自动加载
if ! command -v node >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi

exec npm start
