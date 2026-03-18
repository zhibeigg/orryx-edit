#!/usr/bin/env bash
set -e

# ======== 配置（按需修改） ========
PORT="9090"
ADMIN_KEY="change-me"
DATA_DIR="data"
JAVA_HOME=""  # 留空则使用系统默认 java，示例: /usr/lib/jvm/java-21
# ==================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JAR="$SCRIPT_DIR/orryx-editor-server-all.jar"

if [ ! -f "$JAR" ]; then
  echo "[错误] 找不到 $JAR"
  echo "请先执行: bash build.sh"
  exit 1
fi

if [ -n "$JAVA_HOME" ]; then
  JAVA="$JAVA_HOME/bin/java"
  if [ ! -x "$JAVA" ]; then
    echo "[错误] JAVA_HOME 无效: $JAVA 不存在"
    exit 1
  fi
else
  JAVA="java"
  if ! command -v java &>/dev/null; then
    echo "[错误] 未找到 java，请安装 Java 21+ 或设置 JAVA_HOME"
    exit 1
  fi
fi

mkdir -p "$SCRIPT_DIR/$DATA_DIR"

echo "=== Orryx Editor ==="
echo "  Java: $($JAVA -version 2>&1 | head -1)"
echo "  端口: $PORT"
echo "  数据: $SCRIPT_DIR/$DATA_DIR"
echo "===================="

export PORT ADMIN_KEY DATA_DIR
exec "$JAVA" -jar "$JAR"
