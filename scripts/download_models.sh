#!/usr/bin/env bash
# MediaPipe Pose モデル（lite）を data/models/ に取得
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/data/models/pose_landmarker_lite.task"
mkdir -p "$ROOT/data/models"
URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"

if [[ -f "$DEST" ]]; then
  echo "既にあります: $DEST"
  exit 0
fi

echo "ダウンロード中: $URL"
curl -fsSL -o "$DEST" "$URL"
echo "保存しました: $DEST"
