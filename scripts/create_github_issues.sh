#!/usr/bin/env bash
# GitHub Issues を一括作成する（要: gh auth login 済み）
#
# 使い方:
#   brew install gh          # 未インストールの場合
#   gh auth login
#   cd "/Users/ayana/cursor"
#   bash "dance app/scripts/create_github_issues.sh"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ISSUES_DIR="$REPO_ROOT/dance app/issues"

# ~/.config/gh が書き込めない環境向け（プロジェクト内に設定を保存）
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-$SCRIPT_DIR/../.config/gh}"
mkdir -p "$GH_CONFIG_DIR"

LOCAL_GH="$SCRIPT_DIR/../.tools/gh/bin/gh"
if [[ -x "$LOCAL_GH" ]]; then
  GH="$LOCAL_GH"
elif command -v gh >/dev/null 2>&1; then
  GH="gh"
else
  echo "エラー: gh（GitHub CLI）がありません。"
  echo "  brew install gh"
  echo "  または Cursor のターミナルで gh auth login を実行"
  exit 1
fi

if ! "$GH" auth status >/dev/null 2>&1; then
  echo "エラー: GitHub にログインしてください:"
  echo "  $GH auth login -h github.com -p ssh -w"
  exit 1
fi

cd "$REPO_ROOT"

echo "=== Issue 1: 要件定義 ==="
"$GH" issue create \
  --title "[要件定義] ダンス独学プラットフォーム — 動きの譜面" \
  --label "documentation" \
  --label "dance-app" \
  --body-file "$ISSUES_DIR/01-requirements.md"

echo "=== Issue 2: Phase 0 譜面生成 ==="
"$GH" issue create \
  --title "[Phase 0] ローカルで動画→ダンス譜面 JSON を生成する" \
  --label "enhancement" \
  --label "dance-app" \
  --label "phase-0" \
  --body-file "$ISSUES_DIR/02-phase-0-generate-score.md"

echo "=== Issue 3: Phase 0 プレビュー ==="
"$GH" issue create \
  --title "[Phase 0] 譜面 JSON の棒人間プレビュー" \
  --label "enhancement" \
  --label "dance-app" \
  --label "phase-0" \
  --body-file "$ISSUES_DIR/03-phase-0-preview.md"

echo ""
echo "完了。一覧:"
"$GH" issue list --label "dance-app"
