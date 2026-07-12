#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
VERSION="$(tr -d '\r\n' < "$SCRIPT_DIR/VERSION")"

PORT="${PORT:-9090}"
ADMIN_KEY="${ADMIN_KEY:-}"
DATA_DIR="${DATA_DIR:-data}"

if [ -z "$ADMIN_KEY" ] || [ "$ADMIN_KEY" = "change-me" ] || [ "${#ADMIN_KEY}" -lt 16 ]; then
  echo "[错误] 必须通过 ADMIN_KEY 提供至少 16 个字符的非默认管理密钥。" >&2
  exit 1
fi

if [[ "$DATA_DIR" != /* ]] && [[ ! "$DATA_DIR" =~ ^[A-Za-z]:[\\/] ]]; then
  DATA_DIR="$SCRIPT_DIR/$DATA_DIR"
fi
mkdir -p "$DATA_DIR"
DATA_DIR="$(cd -- "$DATA_DIR" >/dev/null 2>&1 && pwd -P)"

resolve_jar() {
  local candidate

  if [ -n "${ORRYX_JAR:-}" ]; then
    if [[ "$ORRYX_JAR" = /* ]] || [[ "$ORRYX_JAR" =~ ^[A-Za-z]:[\\/] ]]; then
      candidate="$ORRYX_JAR"
    else
      candidate="$SCRIPT_DIR/$ORRYX_JAR"
    fi
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
    return 1
  fi

  for candidate in \
    "$SCRIPT_DIR/orryx-editor-server-$VERSION.jar" \
    "$SCRIPT_DIR/server/build/libs/orryx-editor-server-$VERSION.jar" \
    "$SCRIPT_DIR/orryx-editor-server-all.jar" \
    "$SCRIPT_DIR/server/build/libs/orryx-editor-server-all.jar"
  do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

if ! JAR="$(resolve_jar)"; then
  echo "[错误] 找不到可启动的服务端 JAR。请先执行 build.sh，或设置 ORRYX_JAR。" >&2
  exit 1
fi

if [ -n "${JAVA_HOME:-}" ]; then
  JAVA="$JAVA_HOME/bin/java"
  if [ ! -x "$JAVA" ]; then
    echo "[错误] JAVA_HOME 无效：$JAVA 不存在" >&2
    exit 1
  fi
else
  JAVA="java"
  if ! command -v "$JAVA" >/dev/null 2>&1; then
    echo "[错误] 未找到 java，请安装 Java 21+ 或设置 JAVA_HOME。" >&2
    exit 1
  fi
fi

export PORT ADMIN_KEY DATA_DIR

echo "=== Orryx Editor ==="
echo "  JAR:  $JAR"
echo "  端口: $PORT"
echo "  数据: $DATA_DIR"
echo "===================="

exec "$JAVA" -jar "$JAR"
