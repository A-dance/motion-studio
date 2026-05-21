# Dance Sequence Note — 開発ステップ

動画・JSON 自動解析は使わない。ファイルは少なく、1ステップずつ足す。

## ファイル構成（Step 1 時点）

```
web/
  index.html      … 画面の骨組み（HTML だけ）
  css/studio.css  … 見た目（色・レイアウト）
  js/app.js       … 画面をつなぐ（短い）
  js/skeleton.js  … アバターを描く（ここが中心）
```

起動: `python scripts/serve_preview.py` → http://127.0.0.1:8765/web/

---

## Step 1–3 — 骨組み・操作・カウント ✅

- **21 関節**（頭・首・胸・背中・腰・腕・脚先まで）人間に近い立ち姿
- **ドラッグ**で関節を動かす
- **プリセット**: ジャンプ / ホップ / ターン / 首・胸・腰ドクり
- **進行矢印**（金色）— 8方向ボタン・ドラッグ・長さスライダー
- **カウント +/−** とメモ欄（各拍に `pose` + `direction` を保持）

**触るファイル**: `skeleton.js`, `sequence.js`, `app.js`, `index.html`

---

## Step 4 — 複数作品

**触るファイル**: `app.js` + 新規 `js/works.js`

1. `localStorage` に `{ works: [ { id, title, counts } ] }` を保存
2. 作品 `<select>` の変更でデータを切り替え

---

## 旧コードについて

`web/js/pose-3d.js` などは以前の Motion Studio 用です。  
Dance Sequence Note では **触らなくて大丈夫** です。
