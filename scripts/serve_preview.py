#!/usr/bin/env python3
"""
譜面の作成・確認用ローカル Web サーバー。

  python scripts/serve_preview.py --open

http://127.0.0.1:8765/web/
※ 必ず data/videos/ の元動画を使う（overlay.mp4 はブラウザ非対応）
"""

from __future__ import annotations

import argparse
import errno
import json
import os
import re
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
ROOT_RESOLVED = ROOT.resolve()
DEFAULT_PORT = 8765
DEFAULT_VIDEO = "data/videos/PXL_20260228_101825443.mp4"
DEFAULT_SCORE = "data/output/PXL_20260228_101825443_score.json"

_score_lib = None


def get_score_lib():
    """MediaPipe 等の重い依存は API 初回時だけ読み込む（静的配信は即起動）。"""
    global _score_lib
    if _score_lib is None:
        sys.path.insert(0, str(ROOT / "scripts"))
        import score_lib as _score_lib  # noqa: E402

    return _score_lib


def resolve_under_root(rel_path: str) -> Path | None:
    rel = rel_path.lstrip("/")
    if not rel:
        return None
    full = (ROOT / rel).resolve()
    if not str(full).startswith(str(ROOT_RESOLVED)):
        return None
    return full


class RangeHTTPRequestHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **getattr(SimpleHTTPRequestHandler, "extensions_map", {}),
        ".mp4": "video/mp4",
        ".json": "application/json",
        ".js": "text/javascript",
        ".css": "text/css",
    }

    def translate_path(self, path: str) -> str:
        """プロジェクトルート基準で静的ファイルを配信。"""
        path = path.split("?", 1)[0]
        path = unquote(path)
        rel = path.lstrip("/")
        if not rel:
            return str(ROOT)
        full = resolve_under_root(rel)
        if full is not None:
            return str(full)
        return str(ROOT / rel)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/poses-at-time":
            self.handle_poses_at_time(parse_qs(parsed.query))
            return
        if parsed.path == "/api/scan-people":
            self.handle_scan_people(parse_qs(parsed.query))
            return
        if parsed.path == "/api/generate-score":
            self.handle_generate_score(parse_qs(parsed.query))
            return
        if parsed.path.startswith("/api/"):
            self.send_json(404, {"error": f"API がありません: {parsed.path}"})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/generate-score":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self.send_json(400, {"error": "JSON が不正です"})
                return
            query = {k: [str(v)] for k, v in payload.items()}
            self.handle_generate_score(query)
            return
        self.send_error(404)

    def handle_poses_at_time(self, query: dict[str, list[str]]) -> None:
        video_rel = (query.get("video") or [""])[0]
        t_raw = (query.get("t") or ["0"])[0]
        try:
            time_sec = float(t_raw)
        except ValueError:
            self.send_json(400, {"error": "t は秒数（数値）で指定してください"})
            return

        click: tuple[float, float] | None = None
        x_raw = (query.get("x") or [""])[0]
        y_raw = (query.get("y") or [""])[0]
        if x_raw and y_raw:
            try:
                click = (float(x_raw), float(y_raw))
            except ValueError:
                self.send_json(400, {"error": "x,y は 0〜1 の数値で指定してください"})
                return

        video_path = resolve_under_root(unquote(video_rel))
        if video_path is None or not video_path.is_file():
            self.send_json(404, {"error": f"動画が見つかりません: {video_rel}"})
            return

        try:
            sl = get_score_lib()
            candidates = sl.detect_poses_at_time(video_path, time_sec, click=click)
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"error": str(exc)})
            return

        self.send_json(
            200,
            {
                "time_sec": time_sec,
                "video": video_rel,
                "candidates": candidates,
                "click": list(click) if click else None,
            },
        )

    def handle_scan_people(self, query: dict[str, list[str]]) -> None:
        video_rel = (query.get("video") or [""])[0]
        video_path = resolve_under_root(unquote(video_rel))
        if video_path is None or not video_path.is_file():
            self.send_json(404, {"error": f"動画が見つかりません: {video_rel}"})
            return
        try:
            sl = get_score_lib()
            people = sl.scan_people_in_video(video_path)
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"error": str(exc)})
            return
        self.send_json(200, {"video": video_rel, "people": people})

    def handle_generate_score(self, query: dict[str, list[str]]) -> None:
        video_rel = (query.get("video") or [""])[0]
        target_raw = (query.get("target") or [""])[0]
        out_rel = (query.get("output") or [""])[0]

        if not target_raw.strip():
            self.send_json(400, {"error": "target が必要です（例: 0.45,0.35）"})
            return

        parts = target_raw.replace(" ", "").split(",")
        if len(parts) != 2:
            self.send_json(400, {"error": "target は x,y 形式で指定してください"})
            return
        try:
            target_center = (float(parts[0]), float(parts[1]))
        except ValueError:
            self.send_json(400, {"error": "target の x,y は数値で指定してください"})
            return

        video_path = resolve_under_root(unquote(video_rel))
        if video_path is None or not video_path.is_file():
            self.send_json(404, {"error": f"動画が見つかりません: {video_rel}"})
            return

        if out_rel.strip():
            out_path = resolve_under_root(unquote(out_rel))
            if out_path is None:
                self.send_json(400, {"error": "出力パスが不正です"})
                return
        else:
            out_path = ROOT / "data" / "output" / f"{video_path.stem}_score.json"

        try:
            sl = get_score_lib()
            frames, fps = sl.extract_poses(video_path, target_center=target_center)
            bpm, beat_times = sl.extract_beats(video_path)
            _, duration_sec = sl.get_video_duration(video_path)
            score = sl.build_score(
                video_path,
                frames,
                fps,
                bpm,
                beat_times,
                target_center=target_center,
                duration_sec=duration_sec,
            )
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(score, ensure_ascii=False, indent=2), encoding="utf-8")
            try:
                score_rel = str(out_path.resolve().relative_to(ROOT_RESOLVED))
            except ValueError:
                score_rel = str(out_path)
        except Exception as exc:  # noqa: BLE001
            self.send_json(500, {"error": str(exc)})
            return

        self.send_json(
            200,
            {
                "ok": True,
                "score_path": score_rel.replace("\\", "/"),
                "target": [round(target_center[0], 4), round(target_center[1], 4)],
                "frames": len(frames),
                "beats": len(beat_times),
            },
        )

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):  # noqa: ANN001
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        if not os.path.isfile(path):
            self.send_error(404, "File not found")
            return None

        ctype = self.guess_type(path)
        if path.endswith(".mp4"):
            ctype = "video/mp4"

        file_size = os.path.getsize(path)
        range_header = self.headers.get("Range")

        if range_header:
            match = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if match:
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else file_size - 1
                end = min(end, file_size - 1)
                if start <= end:
                    length = end - start + 1
                    self.send_response(206)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                    self.send_header("Content-Length", str(length))
                    self.send_header("Accept-Ranges", "bytes")
                    self.end_headers()
                    f = open(path, "rb")  # noqa: SIM115
                    f.seek(start)
                    self._range = (f, length)
                    return f

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return open(path, "rb")  # noqa: SIM115

    def copyfile(self, source, outputfile):  # noqa: ANN001
        if hasattr(self, "_range"):
            f, length = self._range
            outputfile.write(f.read(length))
            f.close()
            del self._range
            return
        super().copyfile(source, outputfile)


def main() -> int:
    parser = argparse.ArgumentParser(description="譜面作成・確認用プレビュー")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--open", action="store_true")
    parser.add_argument("--video", type=str, default=DEFAULT_VIDEO)
    parser.add_argument("--score", type=str, default=DEFAULT_SCORE)
    args = parser.parse_args()

    if "_overlay" in args.video:
        print("警告: overlay.mp4 は指定しないでください。元動画に切り替えます。", file=__import__("sys").stderr)
        args.video = DEFAULT_VIDEO

    os.chdir(ROOT)
    print("起動中…", flush=True)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), RangeHTTPRequestHandler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(f"ポート {args.port} はすでに使われています。", file=sys.stderr)
            print(f"  すでにサーバーが動いている場合 → http://127.0.0.1:{args.port}/web/ を開く", file=sys.stderr)
            print("  止めてから再起動 → lsof -i :{0} で PID を確認し kill".format(args.port), file=sys.stderr)
            print(f"  別ポートで起動 → python scripts/serve_preview.py --port {args.port + 1}", file=sys.stderr)
            return 1
        raise

    from urllib.parse import quote

    url = f"http://127.0.0.1:{args.port}/web/"
    print(f"譜面プレビュー: {url}", flush=True)
    print("終了: Ctrl+C", flush=True)
    print(f"ルート: {ROOT.resolve()}", flush=True)
    print("（動画→譜面 API は初回だけ数十秒かかることがあります）", flush=True)

    if args.open:
        webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
