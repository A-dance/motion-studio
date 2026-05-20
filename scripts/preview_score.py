#!/usr/bin/env python3
"""
Phase 0: 譜面 JSON をカウント送りで棒人間プレビューする。

使い方:
  python scripts/preview_score.py data/output/sample_score.json

操作:
  → / n / Space … 次のカウント
  ← / p         … 前のカウント
  q / Esc       … 終了
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from score_lib import BONES, JOINT_NAMES, MIN_VISIBILITY, load_score  # noqa: E402

CANVAS_W = 640
CANVAS_H = 720


def joint_xy(pose: dict, name: str) -> tuple[int, int] | None:
    raw = pose.get(name)
    if not raw or len(raw) < 2:
        return None
    if len(raw) >= 3 and float(raw[2]) < MIN_VISIBILITY:
        return None
    px = int(float(raw[0]) * CANVAS_W)
    py = int(float(raw[1]) * CANVAS_H)
    return px, py


def draw_stick_figure(pose: dict) -> np.ndarray:
    img = np.full((CANVAS_H, CANVAS_W, 3), 32, dtype=np.uint8)

    for a, b in BONES:
        pa = joint_xy(pose, a)
        pb = joint_xy(pose, b)
        if pa and pb:
            cv2.line(img, pa, pb, (80, 200, 255), 3, cv2.LINE_AA)

    for name in JOINT_NAMES:
        p = joint_xy(pose, name)
        if p:
            cv2.circle(img, p, 6, (255, 220, 120), -1, cv2.LINE_AA)

    return img


def draw_hud(img: np.ndarray, score: dict, index: int) -> None:
    count = score["counts"][index]
    bpm = score.get("audio", {}).get("bpm", "?")
    total = len(score["counts"])
    label = count.get("label", str(count.get("index", index + 1)))
    time_sec = count.get("time_sec", 0)
    offset = count.get("frame_offset_ms")

    lines = [
        f"Count {index + 1} / {total}  (label: {label})",
        f"time: {time_sec}s   BPM: {bpm}",
    ]
    if offset is not None:
        lines.append(f"frame offset: {offset} ms")
    lines.append("-> / Space: next   <- / p: prev   q: quit")

    y = 28
    for line in lines:
        cv2.putText(
            img,
            line,
            (16, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (240, 240, 240),
            1,
            cv2.LINE_AA,
        )
        y += 26


def run_preview(score_path: Path) -> int:
    score = load_score(score_path)
    counts = score["counts"]
    index = 0
    window = "Dance Score Preview"

    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window, CANVAS_W, CANVAS_H + 40)

    while True:
        pose = counts[index].get("pose") or {}
        frame = draw_stick_figure(pose)
        draw_hud(frame, score, index)
        cv2.imshow(window, frame)

        key = cv2.waitKey(0) & 0xFF
        if key in (ord("q"), 27):
            break
        if key in (ord("n"), ord(" "), 83, 3):
            index = min(index + 1, len(counts) - 1)
        elif key in (ord("p"), 81, 2):
            index = max(index - 1, 0)

    cv2.destroyAllWindows()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="譜面 JSON を棒人間でカウント送り表示")
    parser.add_argument("score", type=Path, help="譜面 JSON（例: data/output/sample_score.json）")
    args = parser.parse_args()

    if not args.score.exists():
        print(f"エラー: ファイルがありません: {args.score}", file=sys.stderr)
        print("先に譜面を生成してください:", file=sys.stderr)
        print("  python scripts/generate_score.py data/videos/sample.mp4", file=sys.stderr)
        return 1

    try:
        return run_preview(args.score)
    except ValueError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
