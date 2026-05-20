"""譜面生成・評価で共有する骨格・拍・メトリクス処理。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import librosa
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import PoseLandmark

JOINT_NAMES: tuple[str, ...] = (
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
)

KEY_JOINTS: tuple[str, ...] = (
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_hip",
    "right_hip",
)

BONES: tuple[tuple[str, str], ...] = (
    ("left_shoulder", "right_shoulder"),
    ("left_hip", "right_hip"),
    ("left_shoulder", "left_hip"),
    ("right_shoulder", "right_hip"),
    ("left_shoulder", "left_elbow"),
    ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"),
    ("right_elbow", "right_wrist"),
    ("left_hip", "left_knee"),
    ("left_knee", "left_ankle"),
    ("right_hip", "right_knee"),
    ("right_knee", "right_ankle"),
    ("nose", "left_shoulder"),
    ("nose", "right_shoulder"),
)

POSE_LANDMARKS = {name: PoseLandmark[name.upper()] for name in JOINT_NAMES}

MODEL_DIR = Path(__file__).resolve().parent.parent / "data" / "models"
POSE_MODEL_PATH = MODEL_DIR / "pose_landmarker_lite.task"
POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)


def ensure_pose_model() -> Path:
    if POSE_MODEL_PATH.exists():
        return POSE_MODEL_PATH
    raise FileNotFoundError(
        f"Pose モデルがありません: {POSE_MODEL_PATH}\n"
        "  bash scripts/download_models.sh を実行してください"
    )

MIN_VISIBILITY = 0.3
PICKER_MIN_VISIBILITY = 0.15
CORE_JOINTS_FOR_DETECT = ("nose", "left_hip", "right_hip")
MAX_POSES = 4
PICKER_FRAME_RADIUS = 10
PICKER_MERGE_DIST = 0.09
# メインダンサー・ロックオン（初回に固定した1人以外は無視）
LOCK_ANCHOR_RADIUS = 0.22
LOCK_MAX_FRAME_JUMP = 0.2
# 手前の人物（カメラマン等）を避け、奥のダンサーを選ぶ閾値
FOREGROUND_BOTTOM_Y = 0.68
FOREGROUND_MIN_AREA = 0.12
COUNTS_PER_PHRASE = 16  # 1節 = 16カウント（2エイト分 · 1& 2& …）


def load_score(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "counts" not in data or not data["counts"]:
        raise ValueError("譜面 JSON に counts[] がありません")
    return data


def joint_visibility(pose: dict | None, name: str) -> float | None:
    if not pose:
        return None
    raw = pose.get(name)
    if not raw or len(raw) < 2:
        return None
    if len(raw) >= 3:
        return float(raw[2])
    return 1.0


def pose_is_detected(pose: dict | None, min_visibility: float = MIN_VISIBILITY) -> bool:
    if not pose:
        return False
    for name in CORE_JOINTS_FOR_DETECT:
        vis = joint_visibility(pose, name)
        if vis is None or vis < min_visibility:
            return False
    return True


def pose_is_usable_for_picker(pose: dict | None) -> bool:
    """人物選択 UI 用（検出条件を緩める）。"""
    if not pose:
        return False
    visible = sum(
        1
        for name in JOINT_NAMES
        if (v := joint_visibility(pose, name)) is not None and v >= PICKER_MIN_VISIBILITY
    )
    if visible >= 4:
        return True
    nose = joint_visibility(pose, "nose")
    ls = joint_visibility(pose, "left_shoulder")
    rs = joint_visibility(pose, "right_shoulder")
    return (
        nose is not None
        and nose >= PICKER_MIN_VISIBILITY
        and ((ls is not None and ls >= PICKER_MIN_VISIBILITY) or (rs is not None and rs >= PICKER_MIN_VISIBILITY))
    )


def mean_pose_visibility(pose: dict | None) -> float | None:
    if not pose:
        return None
    values = [v for name in JOINT_NAMES if (v := joint_visibility(pose, name)) is not None]
    return float(np.mean(values)) if values else None


def person_to_pose(person: Any) -> dict[str, list[float] | None]:
    landmarks: dict[str, list[float] | None] = {}
    for name, idx in POSE_LANDMARKS.items():
        lm = person[int(idx)]
        vis = getattr(lm, "visibility", None)
        if vis is None:
            vis = getattr(lm, "presence", 1.0)
        landmarks[name] = [round(lm.x, 4), round(lm.y, 4), round(float(vis), 4)]
    return landmarks


def pose_bbox_stats(pose: dict[str, list[float] | None]) -> tuple[float, float, float]:
    """正規化座標での (面積, 中心x, 中心y)。y が大きいほど画面下（手前）。"""
    xs: list[float] = []
    ys: list[float] = []
    for name in JOINT_NAMES:
        raw = pose.get(name)
        if not raw or len(raw) < 2:
            continue
        if len(raw) >= 3 and float(raw[2]) < MIN_VISIBILITY:
            continue
        xs.append(float(raw[0]))
        ys.append(float(raw[1]))
    if not xs:
        return 0.0, 0.5, 0.5
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    return (xmax - xmin) * (ymax - ymin), (xmin + xmax) / 2, (ymin + ymax) / 2


def score_main_dancer_candidate(
    pose: dict[str, list[float] | None],
    prev_center: tuple[float, float] | None,
) -> float:
    """
    奥のメインダンサーほどスコアが高い。
    手前の人物は bbox が大きく画面下にいることが多い。
    """
    area, cx, cy = pose_bbox_stats(pose)
    if area < 0.008:
        return -1e9

    # 奥＝bbox 小さめ
    depth_score = (0.25 - min(area, 0.25)) * 8.0
    # 画面最下部にいる人物（カメラマン）を強く減点
    bottom_penalty = max(0.0, cy - FOREGROUND_BOTTOM_Y) * 12.0
    foreground_penalty = 3.5 if area >= FOREGROUND_MIN_AREA and cy >= FOREGROUND_BOTTOM_Y else 0.0
    # 中央〜やや上（ステージ上）をやや優遇
    vertical_score = (0.72 - cy) * 1.2 if cy < 0.72 else 0.0

    track_bonus = 0.0
    if prev_center is not None:
        dist = float(np.hypot(cx - prev_center[0], cy - prev_center[1]))
        track_bonus = max(0.0, 1.2 - dist * 2.5)

    return depth_score + vertical_score + track_bonus - bottom_penalty - foreground_penalty


def list_pose_candidates(people: list[Any], *, for_picker: bool = False) -> list[dict[str, Any]]:
    """検出された全員の骨格と位置情報。"""
    candidates: list[dict[str, Any]] = []
    for i, person in enumerate(people):
        pose = person_to_pose(person)
        ok = pose_is_usable_for_picker(pose) if for_picker else pose_is_detected(pose)
        if not ok:
            continue
        area, cx, cy = pose_bbox_stats(pose)
        candidates.append(
            {
                "id": i,
                "pose": pose,
                "center": [round(cx, 4), round(cy, 4)],
                "area": round(area, 4),
            }
        )
    return candidates


def select_pose_by_target(
    people: list[Any],
    target_center: tuple[float, float],
    prev_center: tuple[float, float] | None,
) -> tuple[dict[str, list[float] | None], tuple[float, float] | None]:
    """クリック位置に最も近い人物を選ぶ（以降はトラッキング）。"""
    candidates = list_pose_candidates(people)
    if not candidates:
        empty = {name: None for name in JOINT_NAMES}
        return empty, prev_center

    tx, ty = target_center
    best = min(
        candidates,
        key=lambda c: float(np.hypot(c["center"][0] - tx, c["center"][1] - ty)),
    )
    center = (float(best["center"][0]), float(best["center"][1]))
    return best["pose"], center


class MainDancerLock:
    """動画全体で1人だけをロック。他人物の骨格は採用しない。"""

    __slots__ = (
        "anchor",
        "track_center",
        "last_pose",
        "locked",
        "person_id",
        "locked_area",
    )

    def __init__(self) -> None:
        self.anchor: tuple[float, float] | None = None
        self.track_center: tuple[float, float] | None = None
        self.last_pose: dict[str, list[float] | None] | None = None
        self.locked = False
        self.person_id: int | None = None
        self.locked_area: float = 0.0

    def empty_pose(self) -> dict[str, list[float] | None]:
        return {name: None for name in JOINT_NAMES}


def _pick_initial_lock_candidate(
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """初回ロック: 骨格 bbox 面積が最大の人物（手前・中央のメインダンサー）。"""
    if not candidates:
        return None
    return max(candidates, key=lambda c: float(c["area"]))


def select_locked_main_dancer(
    people: list[Any],
    lock: MainDancerLock,
) -> tuple[dict[str, list[float] | None], tuple[float, float] | None]:
    """
    初回にメインダンサーをロックし、以降は anchor 近傍の同一人物のみ追跡。
    他者のデータは完全に無視（スルー）。
    """
    candidates = list_pose_candidates(people)
    empty = lock.empty_pose()

    if not lock.locked:
        best = _pick_initial_lock_candidate(candidates)
        if best is None:
            return lock.last_pose or empty, lock.track_center
        lock.anchor = (float(best["center"][0]), float(best["center"][1]))
        lock.track_center = lock.anchor
        lock.last_pose = best["pose"]
        lock.person_id = int(best["id"])
        lock.locked_area = float(best["area"])
        lock.locked = True
        return best["pose"], lock.track_center

    if not candidates:
        return lock.last_pose or empty, lock.track_center

    assert lock.anchor is not None
    ax, ay = lock.anchor
    in_zone = [
        c
        for c in candidates
        if float(np.hypot(c["center"][0] - ax, c["center"][1] - ay)) <= LOCK_ANCHOR_RADIUS
    ]
    if not in_zone:
        return lock.last_pose or empty, lock.track_center

    tcx, tcy = lock.track_center or lock.anchor
    best = min(
        in_zone,
        key=lambda c: float(np.hypot(c["center"][0] - tcx, c["center"][1] - tcy)),
    )
    jump = float(np.hypot(best["center"][0] - tcx, best["center"][1] - tcy))
    if jump > LOCK_MAX_FRAME_JUMP:
        return lock.last_pose or empty, lock.track_center

    lock.track_center = (float(best["center"][0]), float(best["center"][1]))
    lock.last_pose = best["pose"]
    lock.person_id = int(best["id"])
    return best["pose"], lock.track_center


def select_main_dancer_pose(
    people: list[Any],
    prev_center: tuple[float, float] | None,
    target_center: tuple[float, float] | None = None,
) -> tuple[dict[str, list[float] | None], tuple[float, float] | None]:
    if not people:
        empty = {name: None for name in JOINT_NAMES}
        return empty, prev_center

    if target_center is not None:
        return select_pose_by_target(people, target_center, prev_center)

    best_pose: dict[str, list[float] | None] | None = None
    best_score = -1e12
    best_center: tuple[float, float] | None = None

    for person in people:
        pose = person_to_pose(person)
        if not pose_is_detected(pose):
            continue
        _, cx, cy = pose_bbox_stats(pose)
        s = score_main_dancer_candidate(pose, prev_center)
        if s > best_score:
            best_score = s
            best_pose = pose
            best_center = (cx, cy)

    if best_pose is None:
        return {name: None for name in JOINT_NAMES}, prev_center
    return best_pose, best_center


def _merge_pose_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """近い中心の候補を統合（複数フレーム検出の重複除去）。"""
    merged: list[dict[str, Any]] = []
    for c in candidates:
        cx, cy = c["center"]
        found = False
        for m in merged:
            mx, my = m["center"]
            if float(np.hypot(cx - mx, cy - my)) < PICKER_MERGE_DIST:
                if c.get("score", 0) > m.get("score", 0):
                    m.update(c)
                found = True
                break
        if not found:
            merged.append(dict(c))
    return merged


def detect_poses_at_time(
    video_path: Path,
    time_sec: float,
    click: tuple[float, float] | None = None,
) -> list[dict[str, Any]]:
    """指定時刻付近の複数フレームで人物を検出（人物選択 UI 用）。"""
    model_path = ensure_pose_model()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"動画を開けません: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    center_idx = int(round(max(0.0, time_sec) * fps))
    offsets = [0]
    for d in range(1, PICKER_FRAME_RADIUS + 1):
        offsets.extend([-d, d])

    options = vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=MAX_POSES,
        min_pose_detection_confidence=0.35,
        min_pose_presence_confidence=0.35,
    )

    collected: list[dict[str, Any]] = []
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        for off in offsets:
            idx = center_idx + off
            if idx < 0 or (total > 0 and idx >= total):
                continue
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok:
                continue
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect(mp_image)
            weight = 1.0 / (1.0 + abs(off) * 0.15)
            for c in list_pose_candidates(result.pose_landmarks or [], for_picker=True):
                c = dict(c)
                c["score"] = weight
                if click is not None:
                    c["dist_click"] = float(
                        np.hypot(c["center"][0] - click[0], c["center"][1] - click[1])
                    )
                collected.append(c)

    cap.release()
    merged = _merge_pose_candidates(collected)
    if click is not None:
        merged.sort(key=lambda c: c.get("dist_click", 999.0))
    return merged


def _person_hint(center: list[float]) -> str:
    cx, cy = center[0], center[1]
    if cy < 0.5:
        return "画面上部（奥のダンサーになりやすい）"
    if cy > 0.72:
        return "画面下部（手前の人になりやすい）"
    if cx < 0.35:
        return "画面左寄り"
    if cx > 0.65:
        return "画面右寄り"
    return "画面中央付近"


def scan_people_in_video(video_path: Path, num_samples: int = 10) -> list[dict[str, Any]]:
    """動画をサンプリングし、登場人物候補を列挙（譜面生成前の選択用）。"""
    model_path = ensure_pose_model()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"動画を開けません: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total < 1:
        cap.release()
        return []

    sample_indices = sorted(
        {int(total * (i + 1) / (num_samples + 1)) for i in range(num_samples)}
    )

    options = vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=MAX_POSES,
        min_pose_detection_confidence=0.35,
        min_pose_presence_confidence=0.35,
    )

    collected: list[dict[str, Any]] = []
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        for idx in sample_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok:
                continue
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect(mp_image)
            t = round(idx / fps, 3)
            for c in list_pose_candidates(result.pose_landmarks or [], for_picker=True):
                c = dict(c)
                c["sample_time"] = t
                c["score"] = 1.0
                collected.append(c)

    cap.release()
    merged = _merge_pose_candidates(collected)
    merged.sort(key=lambda c: (c["center"][1], c["center"][0]))
    for i, person in enumerate(merged, start=1):
        person["person_id"] = i
        person["label"] = f"人物 {i}"
        person["hint"] = _person_hint(person["center"])
    return merged


def extract_poses(
    video_path: Path,
    target_center: tuple[float, float] | None = None,
    *,
    require_target: bool = True,
) -> tuple[list[dict], float]:
    if require_target and target_center is None:
        raise ValueError(
            "追跡する人物が未指定です。Web で人物を選ぶか、"
            "--target 0.45,0.35 を指定してください。"
        )
    model_path = ensure_pose_model()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"動画を開けません: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames: list[dict] = []
    lock = MainDancerLock()

    options = vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=MAX_POSES,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        frame_index = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = int(frame_index * 1000 / fps)
            result = landmarker.detect_for_video(mp_image, timestamp_ms)
            time_sec = frame_index / fps

            people = result.pose_landmarks or []
            landmarks, _ = select_locked_main_dancer(people, lock)

            frames.append({"frame": frame_index, "time_sec": round(time_sec, 4), "pose": landmarks})
            frame_index += 1

    cap.release()
    return frames, fps


def extract_beats(video_path: Path) -> tuple[float, list[float]]:
    y, sr = librosa.load(str(video_path), mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    return bpm, [round(float(t), 4) for t in beat_times]


def get_video_duration(video_path: Path) -> tuple[float, float]:
    """(fps, duration_sec)"""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"動画を開けません: {video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    duration = frames / fps if fps > 0 else 0.0
    return fps, duration


def count_interval_sec(bpm: float) -> float:
    """1カウント（8分音符）の秒数。"""
    if bpm <= 0:
        bpm = 120.0
    return 60.0 / bpm / 2.0


def build_uniform_count_times(duration_sec: float, bpm: float) -> list[float]:
    """
    動画長を BPM 基準の等間隔カウントで分割（16カウント楽譜用）。
    librosa の生 beat 列より、譜面ブロックとの同期が安定する。
    """
    if duration_sec <= 0:
        return []
    interval = count_interval_sec(bpm)
    times: list[float] = []
    t = 0.0
    while t < duration_sec - 1e-6:
        times.append(round(t, 4))
        t += interval
    return times


def nearest_frame(frames: list[dict], time_sec: float) -> dict:
    best = min(frames, key=lambda f: abs(f["time_sec"] - time_sec))
    return best["pose"]


def nearest_frame_entry(frames: list[dict], time_sec: float) -> dict:
    return min(frames, key=lambda f: abs(f["time_sec"] - time_sec))


def count_display_label(count_in_phrase: int) -> str:
    """16カウント内の表示名（1, 1&, 2, 2&, … 8&）。"""
    eight = (count_in_phrase + 1) // 2
    return f"{eight}&" if count_in_phrase % 2 == 0 else str(eight)


def dance_count_meta(beat_index: int) -> dict[str, int | str | None]:
    """拍 index（1始まり）→ 16カウント楽譜形式（1& 2& … · 2エイト分）。"""
    zero = beat_index - 1
    phrase_index = zero // COUNTS_PER_PHRASE + 1
    count_in_phrase = zero % COUNTS_PER_PHRASE + 1
    eight_block = (count_in_phrase - 1) // 8 + 1
    pos_in_eight = (count_in_phrase - 1) % 8 + 1
    display = count_display_label(count_in_phrase)

    role = None
    role_ja = ""
    if count_in_phrase == 1:
        role = "ichi"
        role_ja = "（1イ）"
    elif count_in_phrase == 3:
        role = "ni"
        role_ja = "（2ニ）"
    elif count_in_phrase == 9:
        role = "ichi"
        role_ja = "（2周目1イ）"
    elif count_in_phrase == 11:
        role = "ni"
        role_ja = "（2周目2ニ）"

    phrase_label = f"{phrase_index}×16"
    return {
        "phrase_index": phrase_index,
        "phrase_label": phrase_label,
        "count_in_phrase": count_in_phrase,
        "eight_block": eight_block,
        "pos_in_eight": pos_in_eight,
        "count_display": display,
        "section": phrase_index,
        "count_in_section": count_in_phrase,
        "count_label": display,
        "beat_role": role,
        "beat_role_ja": role_ja,
        "sheet_label": f"{phrase_label} · {display}{role_ja}",
    }


def build_phrases(counts: list[dict]) -> list[dict]:
    """16カウント（2エイト）ごとの楽譜ブロック。"""
    phrases: list[dict] = []
    for start in range(0, len(counts), COUNTS_PER_PHRASE):
        chunk = counts[start : start + COUNTS_PER_PHRASE]
        phrase_index = start // COUNTS_PER_PHRASE + 1
        phrases.append(
            {
                "phrase_index": phrase_index,
                "label": f"{phrase_index}×16",
                "label_ja": f"第 {phrase_index} 節 · 16カウント（{phrase_index}×16 · 2エイト）",
                "bpm_at_start": None,
                "counts": chunk,
            }
        )
    return phrases


def build_score(
    video_path: Path,
    frames: list[dict],
    fps: float,
    bpm: float,
    beat_times: list[float],
    target_center: tuple[float, float] | None = None,
    duration_sec: float | None = None,
) -> dict:
    if duration_sec is None or duration_sec <= 0:
        if frames:
            duration_sec = float(frames[-1]["time_sec"])
        else:
            _, duration_sec = get_video_duration(video_path)

    count_times = build_uniform_count_times(duration_sec, bpm)
    if not count_times:
        count_times = beat_times

    counts = []
    for i, t in enumerate(count_times, start=1):
        nearest = nearest_frame_entry(frames, t)
        meta = dance_count_meta(i)
        counts.append(
            {
                "index": i,
                "time_sec": t,
                "label": meta["count_label"],
                "pose": nearest["pose"],
                "frame_index": nearest["frame"],
                "frame_offset_ms": round(abs(nearest["time_sec"] - t) * 1000, 1),
                **meta,
            }
        )

    phrases = build_phrases(counts)
    for ph in phrases:
        if ph["counts"]:
            ph["bpm_at_start"] = round(bpm, 2)

    tracking: dict[str, Any] = {
        "mode": "locked",
        "init": "largest_area",
        "lock_radius": LOCK_ANCHOR_RADIUS,
    }
    if target_center is not None:
        tracking["target_center"] = [round(target_center[0], 4), round(target_center[1], 4)]

    return {
        "version": 3,
        "source": {
            "path": str(video_path.resolve()),
            "fps": round(fps, 2),
            "duration_sec": round(duration_sec, 3),
        },
        "tracking": tracking,
        "audio": {
            "bpm": round(bpm, 2),
            "beat_count": len(count_times),
            "counts_per_phrase": COUNTS_PER_PHRASE,
            "count_interval_sec": round(count_interval_sec(bpm), 4),
            "detected_beats": beat_times,
        },
        "counts": counts,
        "phrases": phrases,
        "frames": frames,
    }


def _pct(n: int, total: int) -> float:
    return round(100.0 * n / total, 1) if total else 0.0


def compute_pose_metrics(frames: list[dict]) -> dict[str, Any]:
    total = len(frames)
    detected = sum(1 for f in frames if pose_is_detected(f.get("pose")))
    visibilities: list[float] = []
    per_joint: dict[str, list[float]] = {name: [] for name in JOINT_NAMES}

    for frame in frames:
        pose = frame.get("pose")
        mv = mean_pose_visibility(pose)
        if mv is not None:
            visibilities.append(mv)
        for name in JOINT_NAMES:
            vis = joint_visibility(pose, name)
            if vis is not None:
                per_joint[name].append(vis)

    joint_means = {
        name: round(float(np.mean(vals)), 3) if vals else None for name, vals in per_joint.items()
    }
    low_joint_frames = sum(
        1
        for f in frames
        if mean_pose_visibility(f.get("pose")) is not None
        and mean_pose_visibility(f.get("pose")) < 0.5  # type: ignore[operator]
    )

    return {
        "frame_count": total,
        "pose_detected_frames_pct": _pct(detected, total),
        "mean_visibility": round(float(np.mean(visibilities)), 3) if visibilities else None,
        "low_visibility_frames_pct": _pct(low_joint_frames, total),
        "per_joint_mean_visibility": joint_means,
    }


def compute_beat_metrics(beat_times: list[float], bpm: float, fps: float) -> dict[str, Any]:
    if len(beat_times) < 2:
        return {
            "beat_count": len(beat_times),
            "bpm_estimated": round(bpm, 2),
            "beat_interval_std_ms": None,
            "beat_interval_vs_bpm_error_pct": None,
            "max_frame_quantization_ms": round(500 / fps, 1),
        }

    intervals = np.diff(beat_times)
    mean_interval = float(np.mean(intervals))
    expected_interval = 60.0 / bpm if bpm > 0 else None
    interval_error_pct = None
    if expected_interval and expected_interval > 0:
        interval_error_pct = round(abs(mean_interval - expected_interval) / expected_interval * 100, 1)

    return {
        "beat_count": len(beat_times),
        "bpm_estimated": round(bpm, 2),
        "beat_interval_std_ms": round(float(np.std(intervals)) * 1000, 1),
        "beat_interval_mean_ms": round(mean_interval * 1000, 1),
        "beat_interval_vs_bpm_error_pct": interval_error_pct,
        "max_frame_quantization_ms": round(500 / fps, 1),
    }


def compute_count_metrics(counts: list[dict], frames: list[dict] | None, fps: float) -> dict[str, Any]:
    total = len(counts)
    full_pose = sum(1 for c in counts if pose_is_detected(c.get("pose")))
    visibilities = [v for c in counts if (v := mean_pose_visibility(c.get("pose"))) is not None]

    offsets_ms: list[float] = []
    for count in counts:
        if "frame_offset_ms" in count:
            offsets_ms.append(float(count["frame_offset_ms"]))
        elif frames:
            nearest = nearest_frame_entry(frames, float(count["time_sec"]))
            offsets_ms.append(abs(nearest["time_sec"] - float(count["time_sec"])) * 1000)

    deltas: list[float] = []
    for prev, curr in zip(counts, counts[1:]):
        p1, p2 = prev.get("pose"), curr.get("pose")
        if not p1 or not p2:
            continue
        dists: list[float] = []
        for name in KEY_JOINTS:
            a, b = p1.get(name), p2.get(name)
            if not a or not b or len(a) < 2 or len(b) < 2:
                continue
            dists.append(float(np.hypot(a[0] - b[0], a[1] - b[1])))
        if dists:
            deltas.append(float(np.mean(dists)))

    return {
        "count_total": total,
        "counts_with_core_pose_pct": _pct(full_pose, total),
        "count_mean_visibility": round(float(np.mean(visibilities)), 3) if visibilities else None,
        "beat_to_frame_offset_mean_ms": round(float(np.mean(offsets_ms)), 1) if offsets_ms else None,
        "beat_to_frame_offset_max_ms": round(float(np.max(offsets_ms)), 1) if offsets_ms else None,
        "adjacent_count_pose_delta_mean": round(float(np.mean(deltas)), 4) if deltas else None,
        "note_frame_quantization": (
            f"fps {fps:.1f} のため、拍とフレームのずれは最大約 {500 / fps:.0f}ms まで生じ得る"
        ),
    }


def grade_metric(value: float | None, green: float, yellow: float, higher_is_better: bool = True) -> str:
    if value is None:
        return "unknown"
    if higher_is_better:
        if value >= green:
            return "good"
        if value >= yellow:
            return "fair"
        return "poor"
    if value <= green:
        return "good"
    if value <= yellow:
        return "fair"
    return "poor"


def build_quality_summary(pose_m: dict, beat_m: dict, count_m: dict) -> dict[str, Any]:
    grades = {
        "pose_detection": grade_metric(pose_m.get("pose_detected_frames_pct"), 90, 70),
        "pose_visibility": grade_metric(pose_m.get("mean_visibility"), 0.75, 0.55),
        "beat_stability": grade_metric(beat_m.get("beat_interval_std_ms"), 40, 80, higher_is_better=False),
        "beat_bpm_fit": grade_metric(
            beat_m.get("beat_interval_vs_bpm_error_pct"), 5, 15, higher_is_better=False
        ),
        "count_pose_coverage": grade_metric(count_m.get("counts_with_core_pose_pct"), 90, 70),
        "beat_frame_alignment": grade_metric(
            count_m.get("beat_to_frame_offset_max_ms"),
            beat_m.get("max_frame_quantization_ms", 50),
            (beat_m.get("max_frame_quantization_ms") or 50) * 1.5,
            higher_is_better=False,
        ),
    }

    poor = [k for k, v in grades.items() if v == "poor"]
    fair = [k for k, v in grades.items() if v == "fair"]
    if poor:
        overall = "needs_work"
        headline = "現状は練習用としては不十分な可能性が高いです。骨格・拍のどちらか（または両方）の改善が必要です。"
    elif fair:
        overall = "experimental"
        headline = "目視確認しながら使えるレベルですが、音ハメ・形の信頼性は動画ごとにばらつきます。"
    else:
        overall = "usable"
        headline = "この動画では譜面として試用できる可能性があります。オーバーレイ動画で最終確認してください。"

    return {
        "overall": overall,
        "headline": headline,
        "grades": grades,
        "weak_points": poor + fair,
    }


def evaluate_score(score: dict, frames: list[dict] | None = None) -> dict[str, Any]:
    frames = frames if frames is not None else score.get("frames")
    fps = float(score.get("source", {}).get("fps", 30))
    bpm = float(score.get("audio", {}).get("bpm", 0))
    beat_times = [float(c["time_sec"]) for c in score["counts"]]

    pose_m: dict[str, Any]
    if frames:
        pose_m = compute_pose_metrics(frames)
    else:
        pose_m = {
            "frame_count": 0,
            "pose_detected_frames_pct": None,
            "mean_visibility": None,
            "note": "全フレーム未保存のため骨格メトリクスはスキップ（--reextract-pose で再計算可）",
        }

    beat_m = compute_beat_metrics(beat_times, bpm, fps)
    count_m = compute_count_metrics(score["counts"], frames, fps)
    summary = build_quality_summary(pose_m, beat_m, count_m)

    return {
        "version": 1,
        "score_version": score.get("version"),
        "source": score.get("source"),
        "audio": score.get("audio"),
        "pose": pose_m,
        "beat": beat_m,
        "counts": count_m,
        "summary": summary,
    }


def joint_pixel(pose: dict, name: str, width: int, height: int) -> tuple[int, int] | None:
    raw = pose.get(name)
    if not raw or len(raw) < 2:
        return None
    if len(raw) >= 3 and float(raw[2]) < MIN_VISIBILITY:
        return None
    return int(float(raw[0]) * width), int(float(raw[1]) * height)


def draw_pose_on_frame(
    frame: np.ndarray,
    pose: dict | None,
    *,
    bone_color: tuple[int, int, int] = (80, 220, 120),
    joint_color: tuple[int, int, int] = (255, 200, 80),
    thickness: int = 2,
) -> None:
    if not pose:
        return
    h, w = frame.shape[:2]
    for a, b in BONES:
        pa = joint_pixel(pose, a, w, h)
        pb = joint_pixel(pose, b, w, h)
        if pa and pb:
            cv2.line(frame, pa, pb, bone_color, thickness, cv2.LINE_AA)
    for name in JOINT_NAMES:
        p = joint_pixel(pose, name, w, h)
        if p:
            cv2.circle(frame, p, 4, joint_color, -1, cv2.LINE_AA)


def render_overlay_video(
    video_path: Path,
    score: dict,
    output_path: Path,
    *,
    frames: list[dict] | None = None,
    beat_window_sec: float = 0.08,
) -> None:
    frames = frames if frames is not None else score.get("frames")
    if not frames:
        raise ValueError("オーバーレイには frames[] が必要です（--reextract-pose で生成）")

    frame_by_index = {int(f["frame"]): f for f in frames}
    beat_times = [
        (
            float(c["time_sec"]),
            c.get("sheet_label") or c.get("phrase_label", str(c.get("index", ""))),
        )
        for c in score["counts"]
    ]

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"動画を開けません: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    writer = cv2.VideoWriter(
        str(output_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )

    frame_index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        time_sec = frame_index / fps
        entry = frame_by_index.get(frame_index)
        if entry:
            draw_pose_on_frame(frame, entry.get("pose"))

        active_beat = None
        for beat_t, label in beat_times:
            if abs(time_sec - beat_t) <= beat_window_sec:
                active_beat = label
                break

        bar_y = height - 28
        cv2.rectangle(frame, (0, bar_y - 6), (width, height), (20, 20, 20), -1)
        duration = max((beat_times[-1][0] if beat_times else 1.0), 0.001)
        for beat_t, label in beat_times:
            x = int(beat_t / duration * (width - 40)) + 20
            color = (0, 220, 255) if active_beat == label else (120, 120, 120)
            cv2.line(frame, (x, bar_y), (x, bar_y + 12), color, 2)

        hud = f"frame {frame_index}  t={time_sec:.2f}s"
        if active_beat:
            hud += f"  {active_beat[:40]}"
            cv2.rectangle(frame, (8, 8), (min(width - 8, 520), 48), (0, 140, 255), -1)
            cv2.putText(
                frame,
                active_beat[:36],
                (16, 34),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
        cv2.putText(frame, hud, (12, height - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)

        writer.write(frame)
        frame_index += 1

    cap.release()
    writer.release()
