# ローカル開発（Phase 0）

公開・クラウドは後回し。**自分の PC だけ**で譜面生成を試す手順です。

## 1. 環境準備

```bash
cd "dance app"
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
bash scripts/download_models.sh   # MediaPipe Pose モデル（初回のみ）
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

## 4. ブラウザで譜面を確認

```bash
python scripts/serve_preview.py --open
```

- **元動画**（`data/videos/*.mp4`）を再生。`*_overlay.mp4` は使わない
- **16カウント楽譜** … 各マスに緑の骨格（score.json の pose）
- マスをクリック → 動画がその拍にジャンプ

精度評価は別コマンド: `python scripts/evaluate_score.py`（[ACCURACY.md](./ACCURACY.md)）

## 5. 棒人間プレビュー（デスクトップ・カウント送り）

動画がまだない場合はデモ譜面で試せます:

```bash
python scripts/preview_score.py scripts/fixtures/demo_score.json
```

本番の譜面 JSON:

```bash
python scripts/preview_score.py data/output/sample_score.json
```

- **→ / Space / n** … 次のカウント
- **← / p** … 前のカウント
- **q / Esc** … 終了

拍ごとのポーズが意図どおりか、目視で確認します。

## 6. 精度を測る（開発時はここが重要）

譜面が「どの程度使えるか」を数値と動画で確認します。詳細は [ACCURACY.md](./ACCURACY.md)。

```bash
# レポート（JSON + ターミナル要約）
python scripts/evaluate_score.py \
  data/videos/sample.mp4 \
  data/output/sample_score.json

# 元動画に骨格と拍マーカーを重ねた確認用動画
python scripts/evaluate_score.py \
  data/videos/sample.mp4 \
  data/output/sample_score.json \
  --overlay
```

**ポイント:** 精度評価には `generate_score.py` を **`--no-frames` なし**で実行してください（全フレームの骨格が必要）。

## 7. JSON の中身を確認

- `counts[]` … 各拍の `time_sec` と `pose`（棒人間の元データ）
- `audio.bpm` … 推定 BPM
- `frame_offset_ms` … 拍時刻と最近傍フレームのずれ（ms）

## 注意

- 拍の推定は自動のため、ずれがある場合は後から手動調整する想定
- 動画ファイル・生成 JSON のうち大きいものは **コミットしない**（`.gitignore` 済み）
