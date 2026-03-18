#!/usr/bin/env bash
set -e

echo "=== Orryx Editor 构建 ==="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/3] 构建前端..."
cd "$SCRIPT_DIR/web"
npm run build

echo "[2/3] 构建后端..."
cd "$SCRIPT_DIR/server"
./gradlew shadowJar --quiet

JAR="$SCRIPT_DIR/server/build/libs/orryx-editor-server-all.jar"
SIZE=$(du -h "$JAR" | cut -f1)
echo ""
echo "[3/3] 构建完成!"
echo "  产物: $JAR ($SIZE)"
echo ""
echo "  启动: java -jar orryx-editor-server-all.jar"
echo "  环境变量:"
echo "    PORT=9090                # 监听端口"
echo "    SERVER_SECRET=your-key   # 插件端连接密钥"
