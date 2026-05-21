/**
 * 2D 骨組み — 人間に近い等身・首/胸/腰の分離
 * 座標は 0〜1（横, 縦）。矢印・文字は canvas-items.js で自由配置。
 */
import { drawAllItems } from "./canvas-items.js";

/** 関節一覧（表示名つき） */
export const JOINTS = [
  { id: "head", label: "頭", group: "首" },
  { id: "neck", label: "首", group: "首" },
  { id: "chest", label: "胸", group: "胴" },
  { id: "spine", label: "背中", group: "胴" },
  { id: "pelvis", label: "腰", group: "胴" },
  { id: "shoulderL", label: "左肩", group: "腕" },
  { id: "elbowL", label: "左肘", group: "腕" },
  { id: "wristL", label: "左手首", group: "腕" },
  { id: "handL", label: "左手", group: "腕" },
  { id: "shoulderR", label: "右肩", group: "腕" },
  { id: "elbowR", label: "右肘", group: "腕" },
  { id: "wristR", label: "右手首", group: "腕" },
  { id: "handR", label: "右手", group: "腕" },
  { id: "hipL", label: "左股", group: "脚" },
  { id: "kneeL", label: "左膝", group: "脚" },
  { id: "ankleL", label: "左足首", group: "脚" },
  { id: "footL", label: "左つま先", group: "脚" },
  { id: "hipR", label: "右股", group: "脚" },
  { id: "kneeR", label: "右膝", group: "脚" },
  { id: "ankleR", label: "右足首", group: "脚" },
  { id: "footR", label: "右つま先", group: "脚" },
];

export const JOINT_IDS = JOINTS.map((j) => j.id);

/** 人間に近い立ちポーズ（頭身 ≈ 7.5） */
export const STAND_POSE = {
  head: [0.5, 0.06],
  neck: [0.5, 0.12],
  chest: [0.5, 0.2],
  spine: [0.5, 0.32],
  pelvis: [0.5, 0.44],
  shoulderL: [0.38, 0.21],
  shoulderR: [0.62, 0.21],
  elbowL: [0.3, 0.34],
  elbowR: [0.7, 0.34],
  wristL: [0.26, 0.48],
  wristR: [0.74, 0.48],
  handL: [0.24, 0.54],
  handR: [0.76, 0.54],
  hipL: [0.43, 0.46],
  hipR: [0.57, 0.46],
  kneeL: [0.41, 0.64],
  kneeR: [0.59, 0.64],
  ankleL: [0.4, 0.8],
  ankleR: [0.6, 0.8],
  footL: [0.39, 0.88],
  footR: [0.61, 0.88],
};

/** 骨のつながり（太さは draw 時に group で変える） */
export const BONES = [
  ["head", "neck"],
  ["neck", "chest"],
  ["chest", "spine"],
  ["spine", "pelvis"],
  ["chest", "shoulderL"],
  ["shoulderL", "elbowL"],
  ["elbowL", "wristL"],
  ["wristL", "handL"],
  ["chest", "shoulderR"],
  ["shoulderR", "elbowR"],
  ["elbowR", "wristR"],
  ["wristR", "handR"],
  ["pelvis", "hipL"],
  ["hipL", "kneeL"],
  ["kneeL", "ankleL"],
  ["ankleL", "footL"],
  ["pelvis", "hipR"],
  ["hipR", "kneeR"],
  ["kneeR", "ankleR"],
  ["ankleR", "footR"],
  ["shoulderL", "shoulderR"],
  ["hipL", "hipR"],
];

const BONE_WIDTH = {
  spine: 6,
  arm: 4.5,
  leg: 5,
  other: 4,
};

function boneStyle(a, b) {
  const spine = ["head", "neck", "chest", "spine", "pelvis"];
  if (spine.includes(a) && spine.includes(b)) return BONE_WIDTH.spine;
  if (["shoulderL", "shoulderR", "elbowL", "elbowR", "wristL", "wristR", "handL", "handR"].includes(a)) {
    return BONE_WIDTH.arm;
  }
  if (["hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "footL", "footR"].includes(a)) {
    return BONE_WIDTH.leg;
  }
  return BONE_WIDTH.other;
}

export function clonePose(pose) {
  const out = {};
  for (const id of JOINT_IDS) {
    const p = pose[id] || STAND_POSE[id];
    out[id] = [p[0], p[1]];
  }
  return out;
}

function shift(pose, id, dx, dy) {
  if (!pose[id]) return;
  pose[id][0] = clamp(pose[id][0] + dx, 0.05, 0.95);
  pose[id][1] = clamp(pose[id][1] + dy, 0.03, 0.96);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** 腰を中心に全体を回転（ターン用） */
export function rotatePose(pose, degrees) {
  const c = pose.pelvis || [0.5, 0.44];
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out = clonePose(pose);
  for (const id of JOINT_IDS) {
    const dx = out[id][0] - c[0];
    const dy = out[id][1] - c[1];
    out[id][0] = c[0] + dx * cos - dy * sin;
    out[id][1] = c[1] + dx * sin + dy * cos;
  }
  return out;
}

/** 動きのクイックプリセット */
export function applyMotionPreset(pose, preset) {
  const p = clonePose(pose);
  switch (preset) {
    case "jump":
      for (const id of JOINT_IDS) shift(p, id, 0, -0.1);
      shift(p, "kneeL", 0.02, -0.04);
      shift(p, "kneeR", -0.02, -0.04);
      shift(p, "ankleL", 0, -0.08);
      shift(p, "ankleR", 0, -0.08);
      shift(p, "footL", 0, -0.1);
      shift(p, "footR", 0, -0.1);
      break;
    case "hop":
      for (const id of ["pelvis", "hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "footL", "footR"]) {
        shift(p, id, 0, -0.05);
      }
      break;
    case "turnL":
      return rotatePose(p, -22);
    case "turnR":
      return rotatePose(p, 22);
    case "neck":
      shift(p, "head", 0.04, 0);
      shift(p, "neck", 0.02, 0);
      break;
    case "chest":
      shift(p, "chest", 0, -0.03);
      shift(p, "shoulderL", -0.02, -0.02);
      shift(p, "shoulderR", 0.02, -0.02);
      break;
    case "hip":
      shift(p, "pelvis", 0.05, 0);
      shift(p, "hipL", 0.04, 0);
      shift(p, "hipR", 0.04, 0);
      break;
    case "reset":
      return clonePose(STAND_POSE);
    default:
      break;
  }
  return p;
}

// ─── 2D 透視変換ヘルパー ──────────────────────────────────────

/** yaw(°) → X方向の圧縮率（正面=1.0、横=0.1 程度） */
function yawToXScale(yaw) {
  return Math.max(0.1, Math.abs(Math.cos((yaw * Math.PI) / 180)));
}

/**
 * 関節のスクリーン座標（yaw による X 圧縮を反映）
 * normX が 0.5 = 画面中央、yaw=0 なら通常、yaw=90 なら横向きで薄くなる
 */
export function jointScreen(pose, id, w, h, yaw = 0) {
  const p = pose[id] || STAND_POSE[id] || [0.5, 0.5];
  const xs = yawToXScale(yaw);
  return {
    x: w / 2 + (p[0] - 0.5) * w * xs,
    y: p[1] * h,
  };
}

/**
 * 2D 人物を canvas に描画
 *  - 骨（ライン）→ 関節（丸）の順で描く
 *  - 選択中の関節はピンクのリング
 *  - headYaw ≠ 0 のとき鼻ドットで頭の向きを示す
 */
export function drawFigure(ctx, w, h, pose, yaw = 0, selectedJoint = null, headYaw = 0) {
  ctx.save();
  ctx.lineCap = "round";

  // 骨
  for (const [a, b] of BONES) {
    const pa = jointScreen(pose, a, w, h, yaw);
    const pb = jointScreen(pose, b, w, h, yaw);
    ctx.strokeStyle = "#d4aab8";
    ctx.lineWidth = boneStyle(a, b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  // 関節
  for (const { id } of JOINTS) {
    const { x, y } = jointScreen(pose, id, w, h, yaw);
    const sel = id === selectedJoint;
    ctx.beginPath();
    ctx.arc(x, y, sel ? 9 : 5.5, 0, Math.PI * 2);
    if (sel) {
      // ピンクのリング（選択中）
      ctx.fillStyle = "#fff0f6";
      ctx.fill();
      ctx.strokeStyle = "#ff6eb4";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#e8a0b4";
      ctx.fill();
    }
  }

  // 頭の向き（headYaw）: 鼻の位置に小さなドットを描く
  if (Math.abs(headYaw) > 2) {
    const { x: hx, y: hy } = jointScreen(pose, "head", w, h, yaw);
    const xs = yawToXScale(yaw);
    // 鼻ドット: 横方向は headYaw で、縦は少し上（鼻は目より下だが頭の輪郭上方）
    const noseDx = Math.sin((headYaw * Math.PI) / 180) * 7 * xs;
    const noseDy = -2;
    ctx.fillStyle = "#c06080";
    ctx.beginPath();
    ctx.arc(hx + noseDx, hy + noseDy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * キャンバス全体を描画（背景 + 人物 + アイテム）
 * drawOverlay の上位互換。app.js から呼ぶのはこれだけでOK。
 */
export function drawScene(canvas, opts = {}) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const w = Math.max(parent?.clientWidth ?? 320, 320);
  const h = Math.max(parent?.clientHeight ?? 400, 400);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  // 背景
  ctx.fillStyle = "#f6f3ee";
  ctx.fillRect(0, 0, w, h);

  // 床ライン（点線）
  ctx.save();
  ctx.strokeStyle = "#ddd8ce";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(w * 0.1, h * 0.92);
  ctx.lineTo(w * 0.9, h * 0.92);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 人物（headYaw も渡す）
  drawFigure(ctx, w, h, opts.pose || STAND_POSE, opts.yaw ?? 0, opts.selectedJoint ?? null, opts.headYaw ?? 0);

  // アイテム（矢印・文字）
  drawAllItems(ctx, w, h, opts.items || [], opts.selectedItemId ?? null);

  // アイテムがまだない場合の案内
  if ((opts.items || []).length === 0) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(42,38,34,0.28)";
    ctx.font = "13px DM Sans, Noto Sans JP, sans-serif";
    ctx.fillText("右のボタンで「矢印」「文字」を追加できます", w / 2, h * 0.97);
    ctx.restore();
  }
}

/** 進行方向（角度° 0=右, 90=下, power 0〜1） */
export function defaultDirection() {
  return { angle: 90, power: 0.45 };
}

/** 矢印の付け根 — 常にポーズの足元/腰から計算（ポーズが動けば矢印も追従） */
export function getArrowOrigin(pose) {
  const fl = pose.footL;
  const fr = pose.footR;
  if (fl && fr) {
    return [(fl[0] + fr[0]) / 2, (fl[1] + fr[1]) / 2 + 0.015];
  }
  const pelvis = pose.pelvis;
  if (pelvis) return [pelvis[0], pelvis[1] + 0.05];
  return [0.5, 0.9];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {{ angle: number, power: number }} dir
 * @param {[number, number]} fromNorm
 */
export function drawDirectionArrow(ctx, w, h, dir, fromNorm) {
  if (!dir || dir.power <= 0) return;
  const cx = fromNorm[0] * w;
  const cy = fromNorm[1] * h;
  const rad = (dir.angle * Math.PI) / 180;
  const len = dir.power * Math.min(w, h) * 0.35;
  const ex = cx + Math.cos(rad) * len;
  const ey = cy + Math.sin(rad) * len;

  ctx.save();
  ctx.strokeStyle = "#c9a962";
  ctx.fillStyle = "#c9a962";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  const head = 10;
  const a1 = rad + Math.PI * 0.82;
  const a2 = rad - Math.PI * 0.82;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex + Math.cos(a1) * head, ey + Math.sin(a1) * head);
  ctx.lineTo(ex + Math.cos(a2) * head, ey + Math.sin(a2) * head);
  ctx.closePath();
  ctx.fill();

  ctx.font = "11px DM Sans, sans-serif";
  ctx.fillStyle = "rgba(42, 38, 34, 0.55)";
  ctx.fillText("進む方向", ex + 6, ey - 4);
  ctx.restore();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {Record<string, [number, number]>} opts.pose
 * @param {object[]} [opts.items]
 * @param {string|null} [opts.selectedJoint]
 * @param {string|null} [opts.selectedItemId]
 */
/** 3D の上に重ねる透明レイヤー（矢印・文字のみ） */
function overlaySize(canvas) {
  const stack = canvas?.parentElement;
  const rect = stack?.getBoundingClientRect();
  const w = Math.max(
    stack?.clientWidth ?? 0,
    rect?.width ?? 0,
    canvas?.clientWidth ?? 0,
    320,
  );
  const h = Math.max(
    stack?.clientHeight ?? 0,
    rect?.height ?? 0,
    canvas?.clientHeight ?? 0,
    400,
  );
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return {
    w: Math.max(1, Math.floor(w * dpr)),
    h: Math.max(1, Math.floor(h * dpr)),
  };
}

export function drawOverlay(canvas, opts = {}) {
  if (!canvas) return;
  const items = opts.items || [];
  const selectedItemId = opts.selectedItemId ?? null;

  const { w: bw, h: bh } = overlaySize(canvas);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawAllItems(ctx, w, h, items, selectedItemId);

  if (items.length === 0 && opts.showEmptyHint !== false) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(42, 38, 34, 0.35)";
    ctx.font = "500 14px DM Sans, Noto Sans JP, sans-serif";
    ctx.fillText("右のボタンから「進む矢印」「回転」「文字」を追加", w / 2, h * 0.42);
    ctx.font = "400 12px DM Sans, Noto Sans JP, sans-serif";
    ctx.fillStyle = "rgba(42, 38, 34, 0.28)";
    ctx.fillText("追加したあと、ドラッグで位置を変えられます", w / 2, h * 0.48);
    ctx.restore();
  }
}

export function fitAndDraw(canvas, opts = {}) {
  drawOverlay(canvas, opts);
}

/** @deprecated drawOverlay を使う */
export const drawSkeleton = drawOverlay;

/**
 * クリック位置に近い関節を返す（ドラッグ用）
 * yaw による X 圧縮を考慮した当たり判定
 */
export function hitTestJoint(pose, normX, normY, canvas, yaw = 0) {
  const w = canvas.width;
  const h = canvas.height;
  const mx = normX * w;
  const my = normY * h;
  let best = null;
  let bestD = 26; // ヒット半径 px

  for (const { id } of JOINTS) {
    const { x, y } = jointScreen(pose, id, w, h, yaw);
    const d = Math.hypot(x - mx, y - my);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** 矢印の先端付近か（角度調整用） */
export function hitTestArrow(pose, direction, normX, normY, canvas) {
  if (!direction?.power) return false;
  const w = canvas.width;
  const h = canvas.height;
  const base = getArrowOrigin(pose);
  const cx = base[0] * w;
  const cy = base[1] * h;
  const rad = (direction.angle * Math.PI) / 180;
  const len = direction.power * Math.min(w, h) * 0.35;
  const ex = cx + Math.cos(rad) * len;
  const ey = cy + Math.sin(rad) * len;
  return Math.hypot(ex - normX * w, ey - normY * h) < 24;
}

/** ドラッグで矢印の角度を更新 */
export function directionFromDrag(pose, normX, normY, canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const base = getArrowOrigin(pose);
  const cx = base[0] * w;
  const cy = base[1] * h;
  const dx = normX * w - cx;
  const dy = normY * h - cy;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  const len = Math.hypot(dx, dy);
  const power = clamp(len / (Math.min(w, h) * 0.35), 0.15, 1);
  return { angle, power };
}
