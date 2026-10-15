#!/usr/bin/env bash
set -euo pipefail
umask 077
target=${1:?target directory required}
process_name=${2:?PM2 name required}
release_id=${3:?release ID required}
[[ "$target" =~ ^/[A-Za-z0-9._/-]+$ && "$target" != *'/../'* && "$target" != */.. ]]
[[ "$process_name" =~ ^[A-Za-z0-9._-]+$ && "$release_id" =~ ^[A-Za-z0-9-]+$ ]]
parent=$(dirname "$target")
stage="$parent/.pango-admin-stage-$release_id"
backup="$parent/.pango-admin-backup-$release_id"
failed="$parent/.pango-admin-failed-$release_id"
db_backup="$parent/.pango-admin-database-backup-$release_id"
archive="/tmp/pango-admin-$release_id.tar.gz"
switched=0
had_process=0

cleanup() {
  rm -f "$archive" "/tmp/pango-admin-$release_id.sh"
  if [ -d "$stage" ]; then rm -rf "$stage"; fi
}
rollback() {
  status=$?
  trap - ERR
  if [ "$switched" = 1 ]; then
    echo 'Deployment failed; restoring the previous code and configuration.' >&2
    cd "$parent"
    if [ -d "$target" ]; then mv "$target" "$failed"; fi
    if [ -d "$backup" ]; then mv "$backup" "$target"; fi
    if [ "$had_process" = 1 ]; then
      pm2 restart "$process_name" --update-env || true
    else
      pm2 delete "$process_name" >/dev/null 2>&1 || true
    fi
    pm2 save || true
    echo 'Database additions and backup files were retained. No database restore was attempted.' >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap rollback ERR

test -f "$target/config/database.env"
for command in node npm pm2 flock; do command -v "$command" >/dev/null; done
exec 9>"$parent/.$(basename "$target").deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
test ! -e "$stage"
test ! -e "$backup"
mkdir "$stage"
tar -xzf "$archive" -C "$stage"
cd "$stage"
npm ci --include=dev
node --check server.mjs
node --check conversationExport.mjs
node --check src/main.js
npm run build
node scripts/check-admin-deploy.mjs preflight "$process_name" "$target"
if pm2 describe "$process_name" >/dev/null 2>&1; then had_process=1; fi
cp -a "$target/config" "$stage/config"
# The helper backs up the database before adding missing tables and never enables sending.
node scripts/prepare-license-deploy.mjs --config "$stage/config/database.env" --backup-dir "$db_backup"
npm prune --omit=dev
cd "$parent"
mv "$target" "$backup"
switched=1
mv "$stage" "$target"
cd "$target"
if [ "$had_process" = 1 ]; then
  pm2 restart "$process_name" --update-env
else
  pm2 start npm --name "$process_name" --cwd "$target" -- start
fi
node scripts/check-admin-deploy.mjs health "$process_name" "$target"
pm2 save
switched=0
echo 'Admin console deployed in preparation mode. Email sending remains disabled.'
echo "Previous code and config retained: $backup"
echo 'Do not restore an old database dump or restart old mail jobs without reconciling sent messages.'
