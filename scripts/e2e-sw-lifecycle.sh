#!/usr/bin/env bash
# SW のライフサイクル E2E（O-9 / O-10）を、ビルドを切り替えながら実行する。
# 通常ビルド → 更新ビルド → kill switch 段階 1 → 段階 2 の順に、4 回ビルドして
# 同じブラウザプロファイルのコピーを使って確認する。時間がかかるため、通常の E2E とは別に実行する。
#
#   npm run test:e2e:sw-lifecycle
set -euo pipefail

cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

run_stage() {
  local stage="$1" profile="$2"
  shift 2
  env "$@" E2E_OFFLINE=true SW_STAGE="$stage" SW_PROFILE="$profile" \
    npx playwright test --project=offline sw-lifecycle --reporter=line
}

echo "== v1: 通常ビルドで SW を登録する =="
npm run build
run_stage prime "$WORK/base"

for name in update kill1 kill2; do
  cp -R "$WORK/base" "$WORK/$name"
done

echo "== v2: 更新ビルド（O-9）=="
npm run build
run_stage update "$WORK/update"

echo "== kill switch 段階 1（O-10）=="
NEXT_PUBLIC_SW_ENABLED=false npm run build
run_stage kill-disabled "$WORK/kill1"

echo "== kill switch 段階 2（O-10）=="
SW_KILL_SWITCH=true npm run build
run_stage kill-switch "$WORK/kill2"

echo "OK"
