# ローカル開発（Phase 0）

公開・クラウドは後回し。**自分の PC だけ**で譜面生成を試す手順です。

## 1. 環境準備

```bash
cd "dance app"
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 2. 動画を置く

- 練習したい動画を `data/videos/` に置く（このフォルダは git に含めない）
- YouTube から取得する場合も **ローカルに一度保存** してから使う

## 3. 譜面を生成

```bash
python scripts/generate_score.py data/videos/sample.mp4
```

出力例: `data/output/sample_score.json`

軽くする場合（全フレームを JSON に含めない）:

```bash
python scripts/generate_score.py data/videos/sample.mp4 --no-frames
```

## 4. 中身の確認

- `counts[]` … 各拍の `time_sec` と `pose`（棒人間の元データ）
- `audio.bpm` … 推定 BPM

## 注意

- 拍の推定は自動のため、ずれがある場合は後から手動調整する想定
- 動画ファイル・生成 JSON のうち大きいものは **コミットしない**（`.gitignore` 済み）
