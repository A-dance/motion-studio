#!/usr/bin/env bash
# GitHub Issues を一括作成する（要: gh auth login 済み）
#
# 使い方:
#   brew install gh          # 未インストールの場合
#   gh auth login
#   cd "/Users/ayana/cursor"
#   bash "dance app/scripts/create_github_issues.sh"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ISSUES_DIR="$REPO_ROOT/dance app/issues"

if ! command -v gh >/dev/null 2>&1; then
  echo "エラー: gh（GitHub CLI）がありません。"
  echo "  brew install gh"
  echo "  gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "エラー: GitHub にログインしてください: gh auth login"
  exit 1
fi

cd "$REPO_ROOT"

echo "=== Issue 1: 要件定義 ==="
gh issue create \
  --title "[要件定義] ダンス独学プラットフォーム — 動きの譜面" \
  --label "documentation" \
  --label "dance-app" \
  --body-file "$ISSUES_DIR/01-requirements.md"

echo "=== Issue 2: Phase 0 譜面生成 ==="
gh issue create \
  --title "[Phase 0] ローカルで動画→ダンス譜面 JSON を生成する" \
  --label "enhancement" \
  --label "dance-app" \
  --label "phase-0" \
  --body-file "$ISSUES_DIR/02-phase-0-generate-score.md"

echo "=== Issue 3: Phase 0 プレビュー ==="
gh issue create \
  --title "[Phase 0] 譜面 JSON の棒人間プレビュー" \
  --label "enhancement" \
  --label "dance-app" \
  --label "phase-0" \
  --body-file "$ISSUES_DIR/03-phase-0-preview.md"

echo ""
echo "完了。一覧:"
gh issue list --label "dance-app"
