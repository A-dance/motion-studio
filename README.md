# Dance Sequence Note

> **リポジトリ:** [`A-dance/motion-studio`](https://github.com/A-dance/motion-studio)  
> **ローカル:** `/Users/ayana/motion-studio`  
> **コンセプト詳細:** [CONCEPT.md](./CONCEPT.md)

**振り付けを自分用の譜面メモとして残す** 自習ノート。  
アバターをドラッグしてポーズを作り、フレーズ・カウント単位でメモを保存する。

---

## 要件一覧

| 項目 | 内容 |
|------|------|
| **コンセプト** | 振り付けのカウント・ポーズ・メモを譜面 JSON に残す自習ノート。「動画の解釈は人間」。アプリは 3D アバター操作・カウント管理・アノテーション記録を担う |
| **ターゲット** | 開発者本人の非公開検証。将来: 動画独学ダンサー（20–40代・初〜中級） |
| **解決する課題** | 動画だけでは「今の拍でどう形を作るか」が残らない → 譜面 JSON + 3D ポーズで記録 |
| **利用シーン** | 動画を横で見ながら、3D アバターでポーズを作りカウントに保存。後で再生して練習 |
| **技術スタック** | Next.js 15 (App Router) · React 19 · Three.js · TypeScript · localStorage |
| **最低限機能（現在完成）** | フレーズ／カウントタイムライン · 3D アバター IK ドラッグポーズ · 矢印／回転／テキストアノテーション · bodyYaw 向き設定 · localStorage 保存 |
| **あったら良い機能** | 区間ループ再生 · 譜面 JSON エクスポート · 左右反転 · キーフレーム補間プレビュー |
| **キル（やらない）** | 一般公開 PF · 3 AI コーチ · SNS · 動画再配信 · 実写級モーキャプ · AR/VR · カメラリアルタイム比較 |
| **動画自動** | 任意の下書き助手のみ（MediaPipe Python スクリプトは補助ツール扱い） |
| **後で決めること** | 一般公開の有無 · アバター素材 · 音源連携 · BPM/カウント自動同期 |

---

## 現在の画面構成

```
┌──────────────────────────────┬──────────────┐
│  3D ステージ（最大化）        │  右パネル    │
│  ・関節ドラッグ → IK ポーズ  │  フレーズ    │
│  ・🔴鼻クリック → 頭向き     │  タイムライン│
│  ・背景ドラッグ → 視点回転   │  ────────── │
│  ・矢印/回転/テキスト重ね描き│  ポーズ管理  │
│                               │  向きプリセット│
└──────────────────────────────┴──────────────┘
```

- **左**: Three.js 3D ビュー + 2D アノテーション Canvas（重ね）
- **右**: フレーズタイムライン（A～…・各16カウント）・ポーズ操作・追加ツールバー

---

## ローカル起動

```bash
# 初回
npm install

# 開発サーバー（ファイル上限を上げてから起動）
ulimit -n 65536
npm run dev   # → http://127.0.0.1:3000
```

> **注意**: macOS のデフォルトのファイルディスクリプタ上限が低いと 404 が出る。  
> `echo 'ulimit -n 65536' >> ~/.zshrc` で恒久対応できる。

---

## データ構造

譜面 JSON（localStorage `dance-studio-v6`）:

```
Work
 └── Phrase[] (A, B, C …)
      └── Count[] (1 〜 16)
           ├── pose: { head, neck, shldrL/R, elbowL/R, wristL/R, handL/R,
           │           hip, hipL/R, kneeL/R, ankleL/R, footL/R }  ← Vec3[]
           ├── items: AnnotItem[]  ← 矢印・回転・テキスト
           ├── bodyYaw: number     ← アバター向き (°)
           └── headYaw: number     ← 頭向き (°)
```

---

## ファイル構成

```
src/
  app/
    page.tsx          ← ルートページ（StudioLoader 経由でSSRスキップ）
    StudioLoader.tsx  ← dynamic + ssr:false ラッパー
    layout.tsx / globals.css
  components/
    StudioApp.tsx         ← メインUI・状態管理・ポインターイベント
    StudioApp.module.css
  lib/
    types.ts   ← Pose / Count / Work / StageAPI など型定義
    pose.ts    ← STAND_POSE・makeWork・applyChainIK (IK実装)
    stage.ts   ← Three.js ステージ（フラット描画・関節ヒットテスト）
    items.ts   ← 矢印・回転・テキストの描画・ドラッグ

scripts/         ← Python 補助ツール（MediaPipe 下書き生成。任意）
web/             ← 旧静的プレビュー（参照のみ）
```

---

## 関連ドキュメント

- [CONCEPT.md](./CONCEPT.md) — コンセプト・キル一覧・ロードマップ
- [AGENTS.md](./AGENTS.md) — AI・開発者向け要約
- [ACCURACY.md](./ACCURACY.md) — 譜面生成精度の検証メモ
- [docs/UI_MOCKUP.md](./docs/UI_MOCKUP.md) — 画面モック
- [.cursor/rules/dance-app-context.mdc](./.cursor/rules/dance-app-context.mdc) — Cursor ルール
