# Issue × ブランチ × AI 開発フロー

1 Issue = 1 ブランチ = 1 PR で、擬似的にチーム開発を再現する手順です。

---

## 全体の流れ

| # | やること |
|---|----------|
| 1 | ブランチを作成して切り替える |
| 2 | GitHub の Issue 本文をコピーし、Cursor に貼る |
| 3 | `@README.md`（要件定義）をコンテキストに追加 |
| 4 | AI に「このタスクを実行して」と依頼 |
| 5 | 問題なければコミット＆プッシュ |
| 6 | GitHub でプルリクエスト（PR）を作成 |
| 7 | PR を確認して `main` にマージ |
| 8 | Issue をクローズし、次の Issue へ（1 に戻る） |

---

## 1. ブランチを作成して切り替える

Issue 番号が **#3** で Phase 0 プレビューなら、例:

```bash
cd "/Users/ayana/cursor"
git checkout main
git pull origin main
git checkout -b feature/issue-3-score-preview
```

### ブランチ名のルール

```
feature/issue-{番号}-{短い英語名}
```

| Issue 題材（例） | ブランチ名（例） |
|----------------|------------------|
| 要件定義 | `feature/issue-1-requirements` |
| Phase 0 譜面生成 | `feature/issue-2-phase-0-generate-score` |
| Phase 0 プレビュー | `feature/issue-3-phase-0-preview` |
| Phase 1 練習 UI | `feature/issue-4-phase-1-practice-ui` |

※ GitHub で Issue を作ったら、**実際の Issue 番号** に合わせて `{番号}` を置き換える。

---

## 2. GitHub から Issue の内容をコピー

1. https://github.com/A-dance/cursor/issues を開く
2. 対象の Issue を開く
3. 本文を **編集モード** で表示（鉛筆アイコン → 編集）
4. 全文をコピー

またはリポジトリ内の下書きを使う:

- `dance app/issues/01-requirements.md` など

---

## 3. Cursor に渡すコンテキスト

チャットまたは Composer で:

1. Issue 本文を **ペースト**
2. `@README.md` を追加（`dance app/README.md`）
3. 必要なら `@LOCAL.md` や関連スクリプトも追加

```
@README.md

（ここに Issue 本文を貼り付け）
```

---

## 4. AI へのプロンプト例

### 基本

```
この Issue のタスクを実行してください。
要件は README に従ってください。変更はこの Issue のスコープだけに留めてください。
```

### Phase 0 の例

```
@README.md @LOCAL.md

この Issue のタスクを実行してください。
動画から譜面 JSON を生成する処理は既に scripts/generate_score.py にあります。
今回は譜面 JSON を棒人間でカウント送り表示するプレビュー（HTML または Python）を追加してください。
```

---

## 5. コミット＆プッシュ

```bash
git status
git add "dance app/..."   # 変更ファイルだけ
git commit -m "feat: Issue #3 譜面プレビューを追加"
git push -u origin feature/issue-3-score-preview
```

コミットメッセージに `Issue #3` を入れると、GitHub で Issue と PR がリンクしやすい。

---

## 6. プルリクエストを作成

### ブラウザ

1. push 後、GitHub に「Compare & pull request」が出たらクリック
2. **base: `main`** ← **compare: 自分のブランチ**
3. タイトル例: `[Issue #3] 譜面 JSON の棒人間プレビュー`
4. 本文に `Closes #3` と書く（マージ時に Issue が自動クローズ）

### 本文テンプレート

```markdown
## 概要
Issue #3 の対応。譜面 JSON をカウント送りで棒人間表示する。

## 変更内容
- scripts/preview_score.py を追加
- LOCAL.md に手順を追記

## 確認方法
1. `python scripts/generate_score.py data/videos/sample.mp4`
2. `python scripts/preview_score.py data/output/sample_score.json`

Closes #3
```

---

## 7. main にマージ

1. PR の **Files changed** で差分を確認
2. 問題なければ **Merge pull request**
3. ローカルで次の作業前に:

```bash
git checkout main
git pull origin main
```

---

## 8. Issue をクローズして次へ

- PR に `Closes #3` があればマージで自動クローズ
- 使い終わったブランチを削除（任意）:

```bash
git branch -d feature/issue-3-score-preview
git push origin --delete feature/issue-3-score-preview
```

**次の Issue** 用に、また **手順 1** から新しいブランチを切る。

---

## 推奨 Issue とブランチの対応表

GitHub で Issue を作ったら、番号をメモしてブランチ名を合わせる。

| 順番 | Issue タイトル（案） | ブランチ名（案） | 状態 |
|------|---------------------|------------------|------|
| 1 | [要件定義] 動きの譜面 | `feature/issue-1-requirements` | ドキュメント済み → PR で main へ |
| 2 | [Phase 0] 動画→譜面 JSON | `feature/issue-2-phase-0-generate-score` | スクリプト一部済み |
| 3 | [Phase 0] 譜面プレビュー | `feature/issue-3-phase-0-preview` | 未着手 |
| 4 | [Phase 1] 譜面再生・比較 | `feature/issue-4-phase-1-practice-ui` | 未着手 |

---

## いまのリポジトリについて

- 作業ブランチ: `feature/practice-sandbox`（要件定義 + Phase 0 土台が入っている）
- これを **main にマージする PR** を先に作るか、
- 今後は **Issue ごとに新ブランチ** を `main` から切る運用に切り替える

おすすめ: いまの内容を **Issue #1 用 PR** として main にマージし、以降は Issue #2 以降を `main` からブランチを切る。

---

## 関連ファイル

- [GITHUB_ISSUES.md](./GITHUB_ISSUES.md) — Issue 本文のコピー用
- [README.md](./README.md) — 要件定義書
- [LOCAL.md](./LOCAL.md) — ローカル実行手順
