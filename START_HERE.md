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

ブラウザ: http://127.0.0.1:8765/web/

## 要件・設計の正本

[README.md](./README.md) の「要件一覧」表

## 旧フォルダについて

`cursor/dance app` には [MOVED.md](https://github.com/A-dance/cursor/blob/main/dance%20app/MOVED.md)（モノレポ側）を置いてあります。**新規のコミット・push はこちら（motion-studio）だけ**にしてください。
