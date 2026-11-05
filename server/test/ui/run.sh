#!/usr/bin/env bash
# Browser (Playwright) tests of the screens. Each test sets up its own business through the API on a fresh database,
# then clicks through the screens and saves screenshots to $OUT/shots.
#
#   TZ=UTC bash server/test/ui/run.sh 7 8 9          # run ui7, ui8, ui9 in one fresh database
#
# Needs: Node 20, `npm i -D playwright` (or a global Playwright with Chromium), and a local MySQL/MariaDB user
# erp / erp123 that may create databases (the same user the smoke test uses). Port 8069 must be free.
# Groups that share one database (later tests build on earlier ones): "7 8 9", "10", "11 12", "13", "14",
# "15 16 17 18 19 20 21 22", "23", "24 25 26 27 28".
set -e
cd "$(dirname "$0")/../../.."
OUT="${OUT:-$(mktemp -d)}"
mkdir -p "$OUT/shots"
mysql -uerp -perp123 -e "DROP DATABASE IF EXISTS maluti_ui"
rm -f "$OUT/ui.json"
MALUTI_CONFIG="$OUT/ui.json" node server/standalone.js > "$OUT/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 2
for n in "$@"; do
  echo "== ui$n"
  timeout 170 node "server/test/ui/ui$n.js" "$OUT" 2>&1 | tail -6
done
echo "Screenshots and server log: $OUT"
