#!/usr/bin/env bash
# GitHub にログイン（初回のみ）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-$SCRIPT_DIR/../.config/gh}"
mkdir -p "$GH_CONFIG_DIR"
GH="$SCRIPT_DIR/../.tools/gh/bin/gh"
if [[ ! -x "$GH" ]]; then
  echo "gh がありません。README の WORKFLOW.md を参照してください。"
  exit 1
fi
echo "ブラウザが開きます。表示されたコードを https://github.com/login/device に入力してください。"
"$GH" auth login -h github.com -p https -w
echo ""
"$GH" auth status
echo ""
echo "ログインできたら:"
echo '  bash "dance app/scripts/create_github_issues.sh"'
