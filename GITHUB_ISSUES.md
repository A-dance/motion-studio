# GitHub Issues 登録用

リポジトリ: https://github.com/A-dance/cursor  
**Issues** → **New issue** から、下の Issue をコピー＆ペーストして作成してください。

---

## Issue 1（必須）要件定義書

**Title:**
```
[要件定義] ダンス独学プラットフォーム — 動きの譜面
```

**Labels（任意）:** `documentation`, `dance-app`

**Body（以下をそのまま貼り付け）:**

```markdown
## 要件定義書

自律型ダンス練習プラットフォーム。詳細はリポジトリ内 `dance app/README.md` を参照。

### コンセプト

ダンス動画から「動きの譜面」（カウント×棒人間）を自動生成し、音に合わせて追うことで、スタジオ・動画配信なしでも独学できるプラットフォーム。最優先は譜面生成技術（Phase 0）。

### ターゲット

ダンスを独学したい社会人（20〜40代）。時間・費用・他人の目がネックな初心者〜中級。初期は開発者本人の非公開検証。

### 解決したい課題とその解決策

**課題:** 反復しづらい／動画だけでは形・音ハメが分からない／動画配信は著作権リスク／MVは教材として途切れる

**解決策:** 譜面JSONで各カウントの目標形を保存／拍と同期／2D骨格で比較／個人検証はローカル処理のみ／（後段）AI3体が計画・区間整理・相談

### 利用シーン

自宅のカウント練習、スタジオの区間ループ、移動中のイメトレ

### 利用の流れ

1. 動画登録 → 2. 譜面生成 → 3. 譜面で練習 → 4. AI相談・計画調整 → 5. マスター  
（Phase 0 は「動画→譜面JSON→プレビュー」まで）

### 類似既存アプリで表現

楽譜・メトロノームアプリ + MediaPipe + 継続型練習アプリの融合

### なぜあなたがこれを行うのか

24年の経験から独学の反復が上達の本質。動画だけでは不十分。動きを譜面化し、AIで計画・伴走を補いたい。

### 最低限機能

動画から譜面を自動生成（骨格抽出・拍解析・JSON・プレビュー）し、音とカウントで譜面を再生・2Dで形を比較・区間ループして練習し、振付アナリスト・練習プランナー・自主練コーチの3 AIが計画と相談を支援する

### あったら良い機能

推しメンバー譜面、見えない拍の補完ナビ、ツインルック録画、練習日記自動生成、進捗ダッシュボード、譜面の反転

### やらないこと・入れない機能

3D／AR／VR、第三者動画の再配信設計、SNS・進捗競争、過度なゲーミフィケーション、先生マッチング、個人情報の第三者販売

### 後で決めること

公開時の動画入力方法、対応ジャンル、AIモデル・口調、譜面の精度基準、音源の扱い、クラウド化・価格・公開時期

---

### 関連ファイル

- `dance app/README.md`
- `dance app/REQUIREMENTS_BRIEF.md`
```

---

## Issue 2 — Phase 0 譜面生成

**Title:** `[Phase 0] ローカルで動画→ダンス譜面 JSON を生成する`  
**ブランチ例:** `feature/issue-2-phase-0-generate-score`  
**Body:** `dance app/issues/02-phase-0-generate-score.md` をコピー

---

## Issue 3 — Phase 0 プレビュー

**Title:** `[Phase 0] 譜面 JSON の棒人間プレビュー`  
**ブランチ例:** `feature/issue-3-phase-0-preview`  
**Body:** `dance app/issues/03-phase-0-preview.md` をコピー

---

## Issue 4（任意）Phase 1

**Title:** `[Phase 1] 譜面再生・自己比較・区間ループ`  
**ブランチ例:** `feature/issue-4-phase-1-practice-ui`

Phase 0 完了後。譜面再生 UI、2D 比較、区間ループ。

---

## 開発フロー（Issue → ブランチ → PR）

詳細は [WORKFLOW.md](./WORKFLOW.md) を参照。

---

## 登録手順（ブラウザ）

### 方法 A — テンプレート（おすすめ）

1. https://github.com/A-dance/cursor/issues/new/choose を開く
2. **「ダンスアプリ — 要件定義」** を選ぶ（表示されない場合は push 後に再読み込み）
3. 内容を確認して **Submit new issue**

### 方法 B — 手動コピー

1. https://github.com/A-dance/cursor/issues を開く
2. **New issue** → 上記 **Issue 1** の Title と Body を貼り付け
3. または `dance app/issues/01-requirements.md` の全文を Body に貼る
4. **Submit new issue**
5. Phase 分けが必要なら Issue 2・3 も同様に作成

**注意:** Issue テンプレートはリポジトリ直下 `.github/ISSUE_TEMPLATE/` に置く必要があります（push 後に反映）。

## CLI で作る場合（`gh` インストール後）

```bash
brew install gh
gh auth login
cd "/Users/ayana/cursor"
gh issue create --title "[要件定義] ダンス独学プラットフォーム — 動きの譜面" --body-file "dance app/GITHUB_ISSUES.md"
```

※ `--body-file` は Issue 1 の body 部分だけのファイルにすると確実です。手動貼り付けが確実です。
