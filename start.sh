#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
VERSION="$(tr -d '\r\n' < "$SCRIPT_DIR/VERSION")"
PORT="${PORT:-9090}"
ADMIN_KEY="${ADMIN_KEY:-}"
DATA_DIR="${DATA_DIR:-data}"
DEPLOYMENT_MODE="${DEPLOYMENT_MODE:-source}"

if [ -z "$ADMIN_KEY" ] || [ "$ADMIN_KEY" = "change-me" ] || [ "${#ADMIN_KEY}" -lt 16 ]; then
  printf '%s\n' "[错误] 必须通过 ADMIN_KEY 提供至少 16 个字符的非默认管理密钥。" >&2
  exit 1
fi
if [[ "$DATA_DIR" != /* ]] && [[ ! "$DATA_DIR" =~ ^[A-Za-z]:[\\/] ]]; then DATA_DIR="$SCRIPT_DIR/$DATA_DIR"; fi
mkdir -p "$DATA_DIR"
DATA_DIR="$(cd -- "$DATA_DIR" >/dev/null 2>&1 && pwd -P)"
UPDATE_DIR="${UPDATE_STAGING_DIR:-$DATA_DIR/updates}"

resolve_jar() {
  local candidate
  if [ -n "${ORRYX_JAR:-}" ]; then
    [[ "$ORRYX_JAR" = /* || "$ORRYX_JAR" =~ ^[A-Za-z]:[\\/] ]] && candidate="$ORRYX_JAR" || candidate="$SCRIPT_DIR/$ORRYX_JAR"
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
    return 1
  fi
  for candidate in "$SCRIPT_DIR/orryx-editor-server-$VERSION.jar" "$SCRIPT_DIR/server/build/libs/orryx-editor-server-$VERSION.jar"; do
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

if ! JAR="$(resolve_jar)"; then
  printf '%s\n' "[错误] 找不到可启动的服务端 JAR。请先执行 build.sh，或设置 ORRYX_JAR。" >&2
  exit 1
fi
if [ -n "${JAVA_HOME:-}" ]; then JAVA="$JAVA_HOME/bin/java"; else JAVA="java"; fi
if ! command -v "$JAVA" >/dev/null 2>&1 && [ ! -x "$JAVA" ]; then
  printf '%s\n' "[错误] 未找到 Java 21+。" >&2
  exit 1
fi

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d ' ' -f1
  else return 1; fi
}

APPLIED=0
APPLIED_BACKUP=""
TARGET_VERSION=""
apply_pending_update() {
  APPLIED=0
  [ "$DEPLOYMENT_MODE" = "launcher" ] || return 0
  local manifest="$UPDATE_DIR/pending-update.properties"
  [ -f "$manifest" ] || return 0
  local version="" artifact="" expected="" key value actual staged backup
  while IFS='=' read -r key value; do
    value="${value%$'\r'}"
    case "$key" in version) version="$value" ;; artifact) artifact="$value" ;; sha256) expected="$value" ;; esac
  done < "$manifest"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf '%s\n' "[错误] pending version 无效" >&2; return 1; }
  [ "$artifact" = "orryx-editor-$version.jar" ] || { printf '%s\n' "[错误] pending artifact 无效" >&2; return 1; }
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { printf '%s\n' "[错误] pending sha256 无效" >&2; return 1; }
  staged="$UPDATE_DIR/staged/$artifact"
  [ -f "$staged" ] || { printf '%s\n' "[错误] 暂存 JAR 不存在" >&2; return 1; }
  actual="$(sha256_file "$staged")" || { printf '%s\n' "[错误] 缺少 sha256sum/shasum" >&2; return 1; }
  [ "$actual" = "$expected" ] || { printf '%s\n' "[错误] 暂存 JAR 校验失败" >&2; return 1; }
  mkdir -p "$UPDATE_DIR/backups"
  backup="$UPDATE_DIR/backups/orryx-editor-$VERSION.jar"
  cp -f -- "$JAR" "$backup"
  mv -f -- "$staged" "$JAR"
  rm -f -- "$manifest" "$UPDATE_DIR/pending-update.json"
  APPLIED=1; APPLIED_BACKUP="$backup"; TARGET_VERSION="$version"
  printf '%s\n' "已应用 Orryx Editor $version，等待健康检查。"
}

export PORT ADMIN_KEY DATA_DIR DEPLOYMENT_MODE ORRYX_LAUNCHER_MANAGED=true
CURRENT_PID=""
trap 'if [ -n "$CURRENT_PID" ]; then kill "$CURRENT_PID" 2>/dev/null || true; fi' INT TERM

while true; do
  apply_pending_update
  printf '%s\n' "=== Orryx Editor ===" "  JAR: $JAR" "  端口: $PORT" "  数据: $DATA_DIR" "===================="
  "$JAVA" -jar "$JAR" & CURRENT_PID=$!

  if [ "$APPLIED" -eq 1 ]; then
    healthy=0
    if command -v curl >/dev/null 2>&1; then
      for _ in {1..30}; do
        kill -0 "$CURRENT_PID" 2>/dev/null || break
        body="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health/ready" 2>/dev/null || true)"
        if [[ "$body" == *'"status":"UP"'* && "$body" == *"\"version\":\"$TARGET_VERSION\""* ]]; then healthy=1; break; fi
        sleep 2
      done
    fi
    if [ "$healthy" -ne 1 ]; then
      printf '%s\n' "[错误] 新版本健康检查失败，正在回滚。" >&2
      kill "$CURRENT_PID" 2>/dev/null || true
      wait "$CURRENT_PID" 2>/dev/null || true
      mv -f -- "$APPLIED_BACKUP" "$JAR"
      APPLIED=0
      "$JAVA" -jar "$JAR" & CURRENT_PID=$!
    fi
  fi

  set +e
  wait "$CURRENT_PID"
  code=$?
  set -e
  CURRENT_PID=""
  [ "$code" -eq 42 ] && continue
  exit "$code"
done
