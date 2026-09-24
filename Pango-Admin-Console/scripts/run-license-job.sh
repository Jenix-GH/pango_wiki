#!/bin/sh
# Invoke every hour from cron; determine Beijing time independently of the host timezone.
set -eu
ADMIN_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(TZ=Asia/Shanghai date +%H)" in
  09) mode=digest ;;
  22) mode=nightly ;;
  *) exit 0 ;;
esac
cd "$ADMIN_ROOT"
exec "${LICENSE_NODE_BIN:-node}" scripts/license-worker.mjs "$mode" --config "${LICENSE_CONFIG_FILE:-config/database.env}"
