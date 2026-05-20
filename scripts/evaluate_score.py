#!/usr/bin/env python3
"""
譜面生成の精度を数値化し、レポート JSON と（任意で）オーバーレイ動画を出力する。

使い方:
  python scripts/evaluate_score.py data/videos/sample.mp4 data/output/sample_score.json
  python scripts/evaluate_score.py data/videos/sample.mp4 data/output/sample_score.json --overlay
  python scripts/evaluate_score.py data/videos/sample.mp4 data/output/sample_score.json --reextract-pose
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# scripts/ を import パスに追加
sys.path.insert(0, str(Path(__file__).resolve().parent))

from score_lib import (  # noqa: E402
    evaluate_score,
    extract_poses,
    load_score,
    render_overlay_video,
)

GRADE_LABEL = {"good": "良好", "fair": "要確認", "poor": "要改善", "unknown": "—"}
OVERALL_LABEL = {
    "usable": "試用可",
    "experimental": "実験的",
    "needs_work": "要改善",
}


def print_report(report: dict) -> None:
    summary = report["summary"]
    print()
    print("=" * 60)
    print("譜面精度レポート")
    print("=" * 60)
    print(f"総合: {OVERALL_LABEL.get(summary['overall'], summary['overall'])} — {summary['headline']}")
    print()

    sections = [
        ("骨格検出（フレーム単位）", report.get("pose", {})),
        ("拍・BPM", report.get("beat", {})),
        ("カウント割当", report.get("counts", {})),
    ]
    for title, data in sections:
        print(f"## {title}")
        for key, val in data.items():
            if key.startswith("note") or key == "per_joint_mean_visibility":
                continue
            print(f"  {key}: {val}")
        print()

    print("## 判定（暫定基準）")
    for name, grade in summary["grades"].items():
        print(f"  {name}: {GRADE_LABEL.get(grade, grade)}")
    if summary.get("weak_points"):
        print(f"  要確認項目: {', '.join(summary['weak_points'])}")
    print()
    print("次: オーバーレイ動画で拍と骨格が動画と一致するか目視確認してください。")
    print("詳細: ACCURACY.md")
    print("=" * 60)


def main() -> int:
    parser = argparse.ArgumentParser(description="譜面 JSON の精度を評価")
    parser.add_argument("video", type=Path, help="元動画（mp4 等）")
    parser.add_argument("score", type=Path, help="譜面 JSON")
    parser.add_argument(
        "-o",
        "--report",
        type=Path,
        help="レポート JSON（省略時は <譜面名>_report.json）",
    )
    parser.add_argument(
        "--overlay",
        nargs="?",
        const="",
        default=None,
        metavar="PATH",
        help="骨格+拍マーカー付き動画を出力（パス省略時は <譜面名>_overlay.mp4）",
    )
    parser.add_argument(
        "--reextract-pose",
        action="store_true",
        help="譜面に frames[] が無い場合、動画から骨格を再抽出して評価",
    )
    args = parser.parse_args()

    if not args.video.exists():
        print(f"エラー: 動画がありません: {args.video}", file=sys.stderr)
        return 1
    if not args.score.exists():
        print(f"エラー: 譜面 JSON がありません: {args.score}", file=sys.stderr)
        return 1

    score = load_score(args.score)
    frames = score.get("frames")

    if not frames and args.reextract_pose:
        print("骨格を再抽出中（評価用）...")
        tc = score.get("tracking", {}).get("target_center")
        target = (float(tc[0]), float(tc[1])) if tc and len(tc) == 2 else None
        frames, _ = extract_poses(args.video, target_center=target, require_target=False)
    elif not frames:
        print("注意: 譜面に frames[] がありません。骨格メトリクスは限定的です。", file=sys.stderr)
        print("  完全評価: generate_score.py を --no-frames なしで再実行", file=sys.stderr)
        print("  または: evaluate_score.py ... --reextract-pose", file=sys.stderr)

    report = evaluate_score(score, frames)
    report["inputs"] = {
        "video": str(args.video.resolve()),
        "score": str(args.score.resolve()),
    }

    report_path = args.report or args.score.with_name(f"{args.score.stem}_report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print_report(report)
    print(f"レポート保存: {report_path.resolve()}")

    if args.overlay is not None:
        if not frames:
            print("エラー: オーバーレイには frames[] が必要です（--reextract-pose）", file=sys.stderr)
            return 1
        overlay_path = (
            Path(args.overlay)
            if args.overlay
            else args.score.with_name(f"{args.score.stem}_overlay.mp4")
        )
        print(f"オーバーレイ動画を書き出し中: {overlay_path}")
        render_overlay_video(args.video, score, overlay_path, frames=frames)
        print(f"保存しました: {overlay_path.resolve()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
