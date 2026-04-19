#!/usr/bin/env bash
# 把 systemd user timer 安装到 ~/.config/systemd/user/
set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

echo "项目目录: $PROJECT_DIR"
echo "安装到:   $UNIT_DIR"

mkdir -p "$UNIT_DIR"

# 定位 npm 路径（兼容 nvm/系统安装）
if ! command -v npm >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
NPM_PATH="$(command -v npm || true)"
SHELL_PATH="$(command -v bash || echo /bin/bash)"

if [ -z "$NPM_PATH" ]; then
    echo "❌ 找不到 npm，请先运行 ./setup.sh" >&2
    exit 1
fi

echo "使用 npm:   $NPM_PATH"
echo "使用 shell: $SHELL_PATH"

# 替换占位符
sed \
    -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
    -e "s|__NPM__|$NPM_PATH|g" \
    -e "s|__SHELL__|$SHELL_PATH|g" \
    "$SCRIPT_DIR/microsoft-rewards.service" > "$UNIT_DIR/microsoft-rewards.service"

cp "$SCRIPT_DIR/microsoft-rewards.timer" "$UNIT_DIR/microsoft-rewards.timer"

echo "✓ 单元文件已写入"

systemctl --user daemon-reload
systemctl --user enable --now microsoft-rewards.timer

echo ""
echo "✓ timer 已启用"
echo ""
echo "常用命令:"
echo "  systemctl --user list-timers                 # 查看下次触发时间"
echo "  systemctl --user start  microsoft-rewards    # 立即手动跑一次"
echo "  systemctl --user status microsoft-rewards    # 看上次运行状态"
echo "  journalctl --user -u microsoft-rewards -f    # 实时跟踪日志"
echo "  systemctl --user disable --now microsoft-rewards.timer  # 关闭自动运行"
echo ""
echo "改定时时间: 编辑 $UNIT_DIR/microsoft-rewards.timer，然后 systemctl --user daemon-reload"
echo ""

# 对 headless 提醒
if command -v node >/dev/null 2>&1 && [ -f "$PROJECT_DIR/src/config.json" ]; then
    if ! node -e "const c=require('$PROJECT_DIR/src/config.json');process.exit(c.headless?0:1)"; then
        echo "⚠️  src/config.json 中 headless=false，后台运行时建议改为 true。"
        echo "   可在管理页「配置」Tab 勾选 headless 后保存。"
    fi
fi

# 如果当前未开启 linger，后台运行/关机后不会触发 timer
if ! loginctl show-user "$USER" 2>/dev/null | grep -q '^Linger=yes'; then
    cat <<EOF

⚠️  注意：当前账户未开启 linger。如果你关机或注销登录，timer 不会触发。
   开启方法（需要 root）:
     sudo loginctl enable-linger $USER
EOF
fi
