# 譜面生成の精度検証（Phase 0）

README の「譜面の精度をどこまで求めるか」は後で決める項目ですが、**開発中は数値と目視の両方で把握する**必要があります。このドキュメントはその手順と暫定基準です。

## 何を測っているか

譜面は次の2段階の合成です。

| 段階 | 処理 | 主な誤差の原因 |
|------|------|----------------|
| 骨格 | MediaPipe Pose（フレームごと） | 隠れた関節、複数人、横顔、暗所、全身が入っていない |
| 拍 | librosa の beat_track | 強拍以外を拾う、BPM倍/半、無音区間、編集されたMV |

各拍の `pose` は「その拍の時刻に最も近いフレーム」の骨格です。fps によって **最大約半フレーム分** の時間ずれが必ず入ります。

## 手順（推奨）

```bash
cd "dance app"
source .venv/bin/activate

# 1. 譜面生成（評価用は frames を残す = --no-frames を付けない）
python scripts/generate_score.py data/videos/あなたの動画.mp4

# 2. 精度レポート
python scripts/evaluate_score.py \
  data/videos/あなたの動画.mp4 \
  data/output/あなたの動画_score.json

# 3. 目視用オーバーレイ動画（骨格 + 拍マーカー）
python scripts/evaluate_score.py \
  data/videos/あなたの動画.mp4 \
  data/output/あなたの動画_score.json \
  --overlay

# 4. カウント送りで形だけ確認
python scripts/preview_score.py data/output/あなたの動画_score.json
```

`--no-frames` で生成した譜面は骨格メトリクスが出ません。次のいずれかで対応します。

- 譜面を **frames 付きで再生成**
- `evaluate_score.py ... --reextract-pose`（動画から骨格だけ再抽出）

## レポートの見方

出力: `data/output/<名前>_report.json` とターミナル要約。

### 骨格（pose）

| 指標 | 意味 | 暫定「良好」 |
|------|------|----------------|
| `pose_detected_frames_pct` | 鼻・両腰が検出できたフレームの割合 | ≥ 90% |
| `mean_visibility` | 全関節の visibility 平均 | ≥ 0.75 |
| `low_visibility_frames_pct` | 平均 visibility &lt; 0.5 のフレーム | 低いほどよい |

### 拍（beat）

| 指標 | 意味 | 暫定「良好」 |
|------|------|----------------|
| `beat_interval_std_ms` | 拍間隔のばらつき | ≤ 40ms |
| `beat_interval_vs_bpm_error_pct` | 推定BPMと拍間隔の不一致 | ≤ 5% |

librosa は「音楽的な拍」を取るため、ダンスの「動きの区切り」と一致しないことがあります。**オーバーレイ動画で必ず確認**してください。

### カウント割当（counts）

| 指標 | 意味 | 暫定「良好」 |
|------|------|----------------|
| `counts_with_core_pose_pct` | 各拍でコア関節が取れた割合 | ≥ 90% |
| `beat_to_frame_offset_max_ms` | 拍時刻と最近傍フレームのずれ | ≤ 半フレーム程度 |
| `adjacent_count_pose_delta_mean` | 隣接カウント間の形の変化量 | 参考値（曲・振付による） |

### 総合（summary.overall）

| 値 | 意味 |
|----|------|
| `usable` | この動画では試用の価値あり（要オーバーレイ確認） |
| `experimental` | 目視しながら使う。ずれ・欠損あり |
| `needs_work` | 骨格か拍のどちらかが大きく怪しい |

## 現実的な期待値（2025時点の自動処理）

README の Phase 0 前提どおり、**完全自動の音ハメ譜面は期待しすぎない**のが安全です。

- **骨格**: 全身・正面・明るい1人動画なら「形の大まかな追従」は可能。手先・足先・回転は崩れやすい。
- **拍**: 4/on-floor 系は比較的合いやすいが、編集MV・無音・複雑リズムはずれやすい。
- **譜面として使う**: まず「8カウント単位で大きな形が合っているか」をオーバーレイで確認し、ずれは手動補正する想定。

## 精度を上げるときの優先順位

1. **入力動画の質**（全身、正面、1人、解像度、明るさ）
2. **拍の手動アンカー**（後続: `time_sec` 編集 or クリック同期UI）
3. MediaPipe の `model_complexity` や confidence 閾値
4. 拍検出を onset + 手動 BPM に変更

## 関連ファイル

- `scripts/evaluate_score.py` — レポート生成
- `scripts/score_lib.py` — メトリクス定義
- `scripts/generate_score.py` — 譜面生成
- `LOCAL.md` — ローカル実行手順
