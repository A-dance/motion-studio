#!/usr/bin/env python3
"""
Phase 0: ローカルでダンス動画 → ダンス譜面（JSON）を生成する。

使い方:
  python scripts/generate_score.py path/to/video.mp4
  python scripts/generate_score.py path/to/video.mp4 -o data/output/my_score.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import librosa
import mediapipe as mp
import numpy as np

# MediaPipe Pose のランドマーク（主要関節のみ保存）
POSE_LANDMARKS = {
    "nose": mp.solutions.pose.PoseLandmark.NOSE,
    "left_shoulder": mp.solutions.pose.PoseLandmark.LEFT_SHOULDER,
    "right_shoulder": mp.solutions.pose.PoseLandmark.RIGHT_SHOULDER,
    "left_elbow": mp.solutions.pose.PoseLandmark.LEFT_ELBOW,
    "right_elbow": mp.solutions.pose.PoseLandmark.RIGHT_ELBOW,
    "left_wrist": mp.solutions.pose.PoseLandmark.LEFT_WRIST,
    "right_wrist": mp.solutions.pose.PoseLandmark.RIGHT_WRIST,
    "left_hip": mp.solutions.pose.PoseLandmark.LEFT_HIP,
    "right_hip": mp.solutions.pose.PoseLandmark.RIGHT_HIP,
    "left_knee": mp.solutions.pose.PoseLandmark.LEFT_KNEE,
    "right_knee": mp.solutions.pose.PoseLandmark.RIGHT_KNEE,
    "left_ankle": mp.solutions.pose.PoseLandmark.LEFT_ANKLE,
    "right_ankle": mp.solutions.pose.PoseLandmark.RIGHT_ANKLE,
}


def extract_poses(video_path: Path) -> tuple[list[dict], float]:
    """フレームごとの骨格を抽出する。"""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"動画を開けません: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames: list[dict] = []

    with mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:
        frame_index = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = pose.process(rgb)
            time_sec = frame_index / fps

            landmarks: dict[str, list[float] | None] = {}
            if result.pose_landmarks:
                for name, idx in POSE_LANDMARKS.items():
                    lm = result.pose_landmarks.landmark[idx]
                    landmarks[name] = [round(lm.x, 4), round(lm.y, 4), round(lm.visibility, 4)]
            else:
                landmarks = {name: None for name in POSE_LANDMARKS}

            frames.append({"frame": frame_index, "time_sec": round(time_sec, 4), "pose": landmarks})
            frame_index += 1

    cap.release()
    return frames, fps


def extract_beats(video_path: Path) -> tuple[float, list[float]]:
    """音轨から BPM と拍の時刻（秒）を推定する。"""
    y, sr = librosa.load(str(video_path), mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    return bpm, [round(float(t), 4) for t in beat_times]


def nearest_frame(frames: list[dict], time_sec: float) -> dict:
    """指定時刻に最も近いフレームの骨格を返す。"""
    best = min(frames, key=lambda f: abs(f["time_sec"] - time_sec))
    return best["pose"]


def build_score(
    video_path: Path,
    frames: list[dict],
    fps: float,
    bpm: float,
    beat_times: list[float],
) -> dict:
    """拍ごとに1ポーズを割り当てた譜面を組み立てる。"""
    counts = []
    for i, t in enumerate(beat_times, start=1):
        counts.append(
            {
                "index": i,
                "time_sec": t,
                "label": str(i),
                "pose": nearest_frame(frames, t),
            }
        )

    return {
        "version": 1,
        "source": {"path": str(video_path.resolve()), "fps": round(fps, 2)},
        "audio": {"bpm": round(bpm, 2), "beat_count": len(beat_times)},
        "counts": counts,
        "frames": frames,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="ダンス動画から譜面 JSON を生成（ローカル）")
    parser.add_argument("video", type=Path, help="入力動画（mp4 等）")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="出力 JSON（省略時は data/output/<動画名>_score.json）",
    )
    parser.add_argument(
        "--no-frames",
        action="store_true",
        help="全フレームデータを JSON に含めない（ファイルサイズ削減）",
    )
    args = parser.parse_args()

    if not args.video.exists():
        print(f"エラー: ファイルがありません: {args.video}", file=sys.stderr)
        return 1

    out = args.output or Path("data/output") / f"{args.video.stem}_score.json"
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"骨格抽出中: {args.video}")
    frames, fps = extract_poses(args.video)
    print(f"  → {len(frames)} フレーム @ {fps:.1f} fps")

    print("拍解析中...")
    bpm, beat_times = extract_beats(args.video)
    print(f"  → BPM {bpm:.1f}, {len(beat_times)} 拍")

    score = build_score(args.video, frames, fps, bpm, beat_times)
    if args.no_frames:
        del score["frames"]

    out.write_text(json.dumps(score, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"譜面を保存しました: {out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
