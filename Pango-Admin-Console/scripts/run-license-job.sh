#!/bin/sh
# Invoke every hour from cron; determine Beijing time independently of the host timezone.
set -eu
ADMIN_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(TZ=Asia/Shanghai date +%H)" in
  09) mode=digest ;;
  20) mode=nightly ;;
  *) exit 0 ;;
esac
cd "$ADMIN_ROOT"
printf '[%s] scheduler_start mode=%s pid=%s\n' "$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S +08:00')" "$mode" "$$"
if "${LICENSE_NODE_BIN:-node}" scripts/license-worker.mjs "$mode" --config "${LICENSE_CONFIG_FILE:-config/database.env}"; then
  result=0
else
  result=$?
fi
printf '[%s] scheduler_end mode=%s pid=%s exit_code=%s\n' "$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S +08:00')" "$mode" "$$" "$result"
exit "$result"
