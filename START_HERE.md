# Motion Studio — ここが本番

**ダンス譜面アプリ（Motion Studio）の開発は、このフォルダだけを使ってください。**

| | 正（ここ） | 旧（使わない） |
|--|-----------|----------------|
| **ローカル** | `/Users/ayana/motion-studio` | `/Users/ayana/cursor/dance app` |
| **GitHub** | https://github.com/A-dance/motion-studio | `A-dance/cursor` 内の `dance app/` |
| **Git のルート** | このフォルダ = リポジトリ直下 | 親の `cursor` モノレポ |

## Cursor の開き方

**File → Open Folder** → `/Users/ayana/motion-studio`

`cursor/dance app` を開いたままだと、todo-app など別プロジェクトと **同じ Git** に見えて混乱します。

## よく使うコマンド

```bash
cd /Users/ayana/motion-studio
source .venv/bin/activate   # 未作成なら: python3 -m venv .venv && pip install -r requirements.txt
python scripts/serve_preview.py
```

ブラウザ: http://127.0.0.1:8765/web/ （`https://` ではなく `http://`）

最初の一歩: http://127.0.0.1:8765/web/ で **Dance Sequence Note** の土台を確認。開発手順は [docs/DANCE_NOTE_STEPS.md](./docs/DANCE_NOTE_STEPS.md)。

**`ERR_CONNECTION_REFUSED` のとき**

1. ターミナルに `譜面プレビュー: http://127.0.0.1:8765/web/` が出てからブラウザを開く
2. サーバー未起動なら上の `python scripts/serve_preview.py` を実行
3. ポート競合 → `lsof -i :8765` で古い PID を `kill` するか `--port 8766` で起動

Three.js を更新するとき:

```bash
npm install three
cp node_modules/three/build/three.module.js web/vendor/three/
cp node_modules/three/examples/jsm/controls/OrbitControls.js web/vendor/three/examples/jsm/controls/
```

## 要件・設計の正本

[README.md](./README.md) の「要件一覧」表

## 旧フォルダについて

`cursor/dance app` には [MOVED.md](https://github.com/A-dance/cursor/blob/main/dance%20app/MOVED.md)（モノレポ側）を置いてあります。**新規のコミット・push はこちら（motion-studio）だけ**にしてください。
