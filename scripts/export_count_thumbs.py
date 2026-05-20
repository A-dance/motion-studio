#!/usr/bin/env python3
"""
各カウント時刻の「実際の姿勢」サムネイルを書き出す（Web プレビュー用）。

使い方:
  python scripts/export_count_thumbs.py data/videos/sample.mp4 data/output/sample_score.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))

from score_lib import count_display_label, dance_count_meta, draw_pose_on_frame, load_score  # noqa: E402

ROLE_JA = {"ichi": "1イ", "ni": "2ニ"}


def export_thumbs(video_path: Path, score_path: Path, out_dir: Path) -> int:
    score = load_score(score_path)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"動画を開けません: {video_path}")

    out_dir.mkdir(parents=True, exist_ok=True)
    n = len(score["counts"])

    for i, count in enumerate(score["counts"]):
        frame_idx = count.get("frame_index")
        if frame_idx is not None:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_idx))
        else:
            cap.set(cv2.CAP_PROP_POS_MSEC, float(count["time_sec"]) * 1000)

        ok, frame = cap.read()
        if not ok:
            continue

        draw_pose_on_frame(frame, count.get("pose"), bone_color=(80, 220, 120), thickness=3)

        meta = dance_count_meta(count.get("index", i + 1))
        display = count.get("count_display") or count_display_label(meta["count_in_phrase"])
        sheet = count.get("sheet_label") or meta.get("sheet_label", "")

        lines = [sheet or f"{meta['phrase_label']} · {display}"]
        if meta.get("beat_role_ja"):
            lines.append(meta["beat_role_ja"])

        y = 28
        for line in lines:
            cv2.putText(frame, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(frame, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (20, 40, 20), 1, cv2.LINE_AA)
            y += 26

        out = out_dir / f"{i + 1:03d}.jpg"
        cv2.imwrite(str(out), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88])

    cap.release()
    print(f"サムネイル {n} 枚 → {out_dir.resolve()}")
    return n


def main() -> int:
    parser = argparse.ArgumentParser(description="カウントごとの姿勢サムネイルを書き出し")
    parser.add_argument("video", type=Path)
    parser.add_argument("score", type=Path)
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="出力フォルダ（省略時は data/output/<score名>_thumbs/）",
    )
    args = parser.parse_args()

    if not args.video.exists() or not args.score.exists():
        print("エラー: 動画または譜面 JSON がありません", file=sys.stderr)
        return 1

    out = args.output or args.score.parent / f"{args.score.stem}_thumbs"
    export_thumbs(args.video, args.score, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
