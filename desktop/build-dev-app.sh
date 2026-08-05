#!/usr/bin/env bash
# 一键构建 dev 版 Reasonix.app:依赖 go workspace 里的 Wails CLI 走标准 wails build,
# 本脚本只做两件事:
#   1. dev 版本声明 —— 不传 -X main.version → main.version 保持 "dev"
#      (updater 对 "dev" 短路,永不提示"发现新版本";Info.plist 版本同步标为 dev)
#   2. 本地替换部署 —— --install 把构建产物替换 /Applications/Reasonix.app
#
# 与发布构建(scripts/desktop-build.sh)的差别:
#   - 构建完全复用 `wails build` 的标准行为:macOS 链接参数(含 Monterey staged
#     WebKit)、build tag 注入等都由 go workspace 中的本地增强版 wails 处理,
#     本脚本不手工复刻任何 wails 内部逻辑
#   - 不注入版本号/渠道/证书/notarization;ad-hoc 签名,仅本机可运行
#
# 用法:
#   ./build-dev-app.sh            构建(前端 dist 已存在则跳过)
#   ./build-dev-app.sh --frontend 强制重建前端(改了 TS/样式时用)
#   ./build-dev-app.sh --install  构建后直接替换 /Applications(可写则免 sudo)
#   参数可组合,如:./build-dev-app.sh --frontend --install
#
# 安全说明:--install 会退出运行中的 Reasonix 并替换 /Applications 下的 app,
# 因此必须在系统终端(Terminal.app / iTerm 等)里执行,不能在 Reasonix
# Desktop 自带终端里执行 —— 脚本会先自检并在检测到 Reasonix 父进程时拒绝运行。
# sudo 与否是自适应的:admin 组 + 终端可写 /Applications 时直接用,否则才 sudo。
set -euo pipefail
cd "$(dirname "$0")"

APP=build/bin/reasonix-desktop.app
INSTALLED=/Applications/Reasonix.app
WAILS_PKG=github.com/wailsapp/wails/v2/cmd/wails

# --- 参数解析(可组合) ---
FRONTEND=0
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --frontend) FRONTEND=1 ;;
    --install)  INSTALL=1 ;;
    *)
      echo "✘ 未知参数: $arg(支持: --frontend --install)" >&2
      exit 1
      ;;
  esac
done

# 沿父进程链向上查,判断当前 shell 是否由 Reasonix Desktop 启动。
is_reasonix_child() {
  local pid=$$ name ppid
  for _ in $(seq 1 12); do
    name=$(ps -o comm= -p "$pid" 2>/dev/null || true)
    case "$name" in
      reasonix-desktop|Reasonix|Reasonix.app) return 0 ;;
    esac
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    [ -z "$ppid" ] || [ "$ppid" = "0" ] && break
    pid=$ppid
  done
  return 1
}

# 探测 /Applications 是否可直接写(admin 组 + 终端有权限),不行才用 sudo。
can_write_applications() {
  [ -w /Applications ] || return 1
  local f=/Applications/.reasonix-write-test
  if touch "$f" 2>/dev/null; then rm -f "$f"; return 0; fi
  return 1
}

# 1. 前端 dist(缺失或 --frontend 时构建;wails build 带 -s 跳过前端)
if [ "$FRONTEND" = 1 ] || [ ! -d frontend/dist ]; then
  echo "==> 构建前端 frontend/dist ..."
  (cd frontend && pnpm build)
else
  echo "==> 前端 dist 已存在,跳过 pnpm build(--frontend 可强制重建)"
fi

# 2. 标准 wails build:通过 go workspace 调用 Wails CLI(与发布构建同一套增强版
#    wails,不手工复刻任何链接参数)。行为要点:
#    - go run 受 GOWORK 管辖;无 go.work 时回落 module cache 的官方 wails,见下方警告
#    - 不传 -ldflags → main.version 保持 "dev",updater 短路,永不提示更新
#    - wails build 默认 Production 模式,自动注入 -tags production(与 wails dev 区分)
#    - -s 跳过前端(第 1 步已处理);-skipbindings 跳过 bindings 生成
#    - -m 跳过 mod tidy;-nosyncgomod 防止 wails 改写 desktop/go.mod
GOWORK="$(go env GOWORK)"
WAILS_SRC="$(go list -m -f '{{.Dir}}' github.com/wailsapp/wails/v2 2>/dev/null || true)"
echo "==> wails build(go workspace: ${GOWORK:-<无>})"
echo "    wails 源码: ${WAILS_SRC:-<module cache>}"
if [ -z "$GOWORK" ]; then
  echo "    ⚠ 未检测到 go.work,wails 解析到 module cache 的官方版,"
  echo "      macOS 链接行为(staged WebKit 等)可能与发布构建不一致"
fi
# 首次运行会先编译 wails CLI(约 1 分钟),之后有 go build cache,秒级。
go run "$WAILS_PKG" build -s -skipbindings -m -nosyncgomod

# 3. dev 版本声明:Info.plist 版本标为 dev,与 main.version=dev 一致
#    (updater 判断用的是 Go 变量 version,此处仅影响"关于本机/访达"显示)
echo "==> Info.plist 版本声明为 dev ..."
/usr/libexec/PlistBuddy \
  -c "Set :CFBundleShortVersionString dev" \
  -c "Set :CFBundleVersion dev" \
  "$APP/Contents/Info.plist"

# 4. 部署准备:CLI 二进制(updater 会用到)。wails build 每次重建 bundle,
#    先清掉可能残留的旧 CLI,再从已安装版取一份(若存在)。
rm -f "$APP/Contents/MacOS/reasonix"
if [ -f "$INSTALLED/Contents/MacOS/reasonix" ]; then
  echo "==> 复制 CLI 二进制 reasonix(来自 $INSTALLED)"
  cp "$INSTALLED/Contents/MacOS/reasonix" "$APP/Contents/MacOS/reasonix"
  chmod +x "$APP/Contents/MacOS/reasonix"
fi

# 5. ad-hoc 重新签名(改了 Info.plist / 加了 CLI 后旧签名失效)
echo "==> codesign --force --deep (ad-hoc) ..."
codesign --force --deep -s - "$APP"

echo
echo "✔ 构建完成: $PWD/$APP"
echo "  当前版本: dev(不会提示更新)"
codesign -dv "$APP" 2>&1 | grep -E 'Identifier|Signature' || true

# 6. 可选:替换 /Applications
if [ "$INSTALL" = 1 ]; then
  if is_reasonix_child; then
    echo "✘ 检测到当前终端由 Reasonix Desktop 启动。--install 会退出 Reasonix,"
    echo "  导致本终端被一并终止、安装中断(可能留下半替换状态)。"
    echo "  请退出 Reasonix,在系统终端(Terminal.app 等)里重新执行:"
    echo "    cd \"$PWD\" && ./build-dev-app.sh --install"
    exit 1
  fi
  echo
  echo "==> 退出运行中的 Reasonix ..."
  osascript -e 'quit app "Reasonix"' 2>/dev/null || true
  for _ in $(seq 1 10); do
    pgrep -x reasonix-desktop >/dev/null 2>&1 || break
    sleep 1
  done
  if pgrep -x reasonix-desktop >/dev/null 2>&1; then
    echo "    ⚠ Reasonix 10 秒内未退出,继续替换(旧进程仍在运行,但文件已被替换)"
  fi

  if can_write_applications; then
    SUDO=""
    echo "==> /Applications 可直接写,不需要 sudo"
  else
    SUDO="sudo"
    echo "==> /Applications 不可直接写,将使用 sudo(会要密码)"
  fi

  echo "==> 旧版移入垃圾桶 ..."
  if [ -d "$INSTALLED" ]; then
    if ! osascript -e 'tell application "Finder" to delete POSIX file "/Applications/Reasonix.app"' >/dev/null 2>&1; then
      echo "    Finder 删除失败(权限弹窗被拒?),改用 $SUDO mv 移入垃圾桶"
      $SUDO mv "$INSTALLED" "$HOME/.Trash/Reasonix.app.$(date +%Y%m%d-%H%M%S)"
    fi
  fi

  echo "==> 替换 $INSTALLED ..."
  $SUDO rm -rf "$INSTALLED"
  $SUDO cp -R "$APP" "$INSTALLED"
  $SUDO xattr -dr com.apple.quarantine "$INSTALLED" 2>/dev/null || true

  echo "✔ 已安装。打开: open -a Reasonix"
  echo "  如需回滚:从垃圾桶拖回 Reasonix.app,或去官网重新下载安装"
fi
