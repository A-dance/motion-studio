# Agent context

**正本**: [README.md](./README.md) · [CONCEPT.md](./CONCEPT.md)（v2: 振り付けメモ）

## コンセプト（1行）

**振り付けの自習用メモ** — 動画の解釈は人間、拍・カウント・メモ・アレンジはアプリ、再生は 3D お手本。

## 最優先

1. 譜面 JSON（拍・カウント枠）の保存
2. **譜面エディタ**（メモ・ポーズ登録・コピー/反転）
3. 3D アバター + カウント練習 UI

## 格下げ

- 動画→骨格の **自動**（下書き助手のみ。精度は約束しない）
- Generate score を唯一の入口にしない

## キル

公開 PF、3 AI、SNS、実写モーキャプ約束、動画再配信、2D棒を製品中心

## Web（新規）

`web/index.html` · `web/js/main.js` · `studio.js` · `score.js` · `pose-3d.js`

旧 `app.js` / `practice.js` / `score.css` は削除済み。

## 心臓部

譜面 JSON スキーマ · Python `score_lib`（下書き生成のみ任意）
