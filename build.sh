#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
WEB_DIR="$SCRIPT_DIR/web"
SERVER_DIR="$SCRIPT_DIR/server"
VERSION="$(tr -d '\r\n' < "$SCRIPT_DIR/VERSION")"
JAR="$SERVER_DIR/build/libs/orryx-editor-server-$VERSION.jar"

echo "=== Orryx Editor $VERSION 构建 ==="

echo "[1/8] 安装前端依赖..."
cd "$WEB_DIR"
if [ -f package-lock.json ]; then
  npm ci
elif [ -f npm-shrinkwrap.json ]; then
  npm ci
else
  echo "[错误] web 目录缺少 package-lock.json 或 npm-shrinkwrap.json，无法执行可复现安装。" >&2
  exit 1
fi

echo "[2/8] 检查前端代码规范..."
npm run lint

echo "[3/8] 检查前端类型..."
npm run typecheck

echo "[4/8] 运行前端覆盖率测试..."
npm run test:ci

echo "[5/8] 构建前端静态资源..."
npm run build

echo "[6/8] 检查 bundle 预算和前端敏感信息..."
npm run check:bundle
npm run check:secrets

echo "[7/8] 验证 CI 与部署配置..."
node "$SCRIPT_DIR/scripts/validate-deployment.mjs"

echo "[8/8] 测试并构建服务端..."
cd "$SERVER_DIR"
./gradlew --no-daemon test shadowJar

if [ ! -f "$JAR" ]; then
  echo "[错误] 构建完成但未找到 VERSION 对应产物：$JAR" >&2
  exit 1
fi

if command -v du >/dev/null 2>&1; then
  JAR_SIZE="$(du -h "$JAR" | cut -f1)"
else
  JAR_SIZE="unknown"
fi

echo
echo "构建完成：$JAR ($JAR_SIZE)"
echo "启动：bash \"$SCRIPT_DIR/start.sh\""
