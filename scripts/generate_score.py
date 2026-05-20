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

sys.path.insert(0, str(Path(__file__).resolve().parent))

from score_lib import build_score, extract_beats, extract_poses, get_video_duration  # noqa: E402


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
        help="全フレームデータを JSON に含めない（ファイルサイズ削減・精度評価には不向き）",
    )
    parser.add_argument(
        "--target",
        type=str,
        default="",
        help="追跡する人の位置（正規化 0〜1）例: 0.45,0.35 = 画面のその地点に近い人",
    )
    args = parser.parse_args()

    if not args.video.exists():
        print(f"エラー: ファイルがありません: {args.video}", file=sys.stderr)
        return 1

    out = args.output or Path("data/output") / f"{args.video.stem}_score.json"
    out.parent.mkdir(parents=True, exist_ok=True)

    if not args.target.strip():
        print(
            "エラー: 追跡する人物を指定してください。\n"
            "  Web: 動画を読み込み → 人物を選ぶ → 譜面を生成\n"
            "  CLI: --target 0.45,0.35（画面座標 0〜1）",
            file=sys.stderr,
        )
        return 1
    parts = args.target.replace(" ", "").split(",")
    if len(parts) != 2:
        print("エラー: --target は x,y 形式（例: 0.45,0.35）", file=sys.stderr)
        return 1
    target_center = (float(parts[0]), float(parts[1]))
    print(f"追跡ターゲット: ({target_center[0]:.2f}, {target_center[1]:.2f})")

    print(f"骨格抽出中: {args.video}")
    frames, fps = extract_poses(args.video, target_center=target_center)
    print(f"  → {len(frames)} フレーム @ {fps:.1f} fps")

    print("拍解析中...")
    bpm, beat_times = extract_beats(args.video)
    _, duration_sec = get_video_duration(args.video)
    print(f"  → BPM {bpm:.1f}, 動画 {duration_sec:.1f}s, librosa 拍 {len(beat_times)}")

    score = build_score(
        args.video,
        frames,
        fps,
        bpm,
        beat_times,
        target_center=target_center,
        duration_sec=duration_sec,
    )
    if args.no_frames:
        del score["frames"]
        print("  → frames[] は省略（精度評価する場合は --no-frames を付けない）", file=sys.stderr)

    out.write_text(json.dumps(score, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"譜面を保存しました: {out.resolve()}")
    print("精度確認: python scripts/evaluate_score.py", args.video, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
