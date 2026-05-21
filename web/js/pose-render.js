/** 棒人間描画 — 補間アニメ・軌道・動いている部位の強調 */
import { BONES, HAND_EXTEND_RATIO, MIN_VISIBILITY } from "./constants.js";

const JOINT_NAMES = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hand",
  "right_hand",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];

const MOTION_JOINTS = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_hand",
  "right_hand",
  "left_wrist",
  "right_wrist",
  "left_elbow",
  "right_elbow",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];
const EXTREMITY_DOTS = ["left_hand", "right_hand", "left_ankle", "right_ankle"];
const HEAD_DOT = "nose";
const MOTION_THRESH = 0.004;
/** 関節間を長さ方向に何分割するか（上限）。「太さ」ではなく骨の長さに沿った本数 */
const BONE_LENGTH_SLICES_MAX = 28;
/** 各切片に並べる横方向の細線本数（腕の「幅」方向の束） */
const BONE_CROSS_STRANDS = 4;
/** 動き矢印は混線防止のため上位だけ描画 */
const MOTION_ARROW_MAX_JOINTS = 7;
/** 過去側オニオンスキンの枚数（古いほど薄い） */
export const ONION_PAST_LAYERS = 4;
/** 未来側（任意・より薄く） */
export const ONION_FUTURE_LAYERS = 2;
const ONION_ALPHA_MIN = 0.05;
const ONION_ALPHA_MAX = 0.26;
const ONION_FUTURE_ALPHA_MAX = 0.14;

const TRAIL_JOINTS = [
  { name: "left_hand", color: "#66ddff", label: "L hand" },
  { name: "right_hand", color: "#00ccff", label: "R hand" },
  { name: "left_ankle", color: "#ffaa22", label: "L foot" },
  { name: "right_ankle", color: "#ff8844", label: "R foot" },
];

const LIMB_STROKE = {
  left_shoulder: "#00ff88",
  right_shoulder: "#00ff88",
  left_elbow: "#00ccff",
  right_elbow: "#00ccff",
  left_wrist: "#66ddff",
  right_wrist: "#66ddff",
  left_hand: "#99eeff",
  right_hand: "#33ddff",
  left_hip: "#00ff88",
  right_hip: "#00ff88",
  left_knee: "#ffcc44",
  right_knee: "#ffcc44",
  left_ankle: "#ffaa22",
  right_ankle: "#ffaa22",
  nose: "#00ff88",
};

function isJointVisible(raw) {
  if (!raw || raw.length < 2) return false;
  if (raw.length >= 3 && raw[2] < MIN_VISIBILITY) return false;
  return true;
}

/** 手先（人差し指）を補完。旧譜面は手首から前腕方向に延長 */
export function enrichPoseHands(pose) {
  if (!pose) return pose;
  const out = { ...pose };
  for (const side of ["left", "right"]) {
    const key = `${side}_hand`;
    if (isJointVisible(out[key])) continue;
    const wrist = out[`${side}_wrist`];
    const elbow = out[`${side}_elbow`];
    if (!isJointVisible(wrist) || !isJointVisible(elbow)) continue;
    const fx = wrist[0] - elbow[0];
    const fy = wrist[1] - elbow[1];
    const forearm = Math.hypot(fx, fy);
    if (forearm < 1e-5) continue;
    const ext = HAND_EXTEND_RATIO * forearm;
    const vis = Math.min(wrist[2] ?? 1, elbow[2] ?? 1) * 0.85;
    out[key] = [wrist[0] + (fx / forearm) * ext, wrist[1] + (fy / forearm) * ext, vis];
  }
  return out;
}

function visibleJointPoints(pose) {
  const pts = [];
  for (const name of JOINT_NAMES) {
    const raw = pose?.[name];
    if (isJointVisible(raw)) pts.push([raw[0], raw[1]]);
  }
  return pts;
}

function hipCenter(pose) {
  const lh = pose?.left_hip;
  const rh = pose?.right_hip;
  const okL = isJointVisible(lh);
  const okR = isJointVisible(rh);
  if (okL && okR) return [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2];
  if (okL) return [lh[0], lh[1]];
  if (okR) return [rh[0], rh[1]];
  const pts = visibleJointPoints(pose);
  if (!pts.length) return null;
  return [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
}

export function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/** 2ポーズ間を補間（カウント間の「動き」を可視化する核心） */
export function lerpPose(a, b, t) {
  if (!a) return enrichPoseHands(b);
  if (!b) return enrichPoseHands(a);
  const out = {};
  for (const name of JOINT_NAMES) {
    const ra = a[name];
    const rb = b[name];
    const okA = isJointVisible(ra);
    const okB = isJointVisible(rb);
    if (okA && okB) {
      const vis = Math.min(ra[2] ?? 1, rb[2] ?? 1);
      const row = [
        ra[0] + (rb[0] - ra[0]) * t,
        ra[1] + (rb[1] - ra[1]) * t,
        vis,
      ];
      if (ra.length > 3 && rb.length > 3) row.push(ra[3] + (rb[3] - ra[3]) * t);
      else if (ra.length > 3) row.push(ra[3]);
      else if (rb.length > 3) row.push(rb[3]);
      out[name] = row;
    } else if (okA) {
      out[name] = [...ra];
    } else if (okB) {
      out[name] = [...rb];
    }
  }
  return enrichPoseHands(out);
}

function jointMotion(prev, curr, name) {
  if (!prev || !curr) return 0;
  const a = prev[name];
  const b = curr[name];
  if (!isJointVisible(a) || !isJointVisible(b)) return 0;
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function boneMotion(prev, curr, jointA, jointB) {
  return (jointMotion(prev, curr, jointA) + jointMotion(prev, curr, jointB)) / 2;
}

/** 譜面全体で共通の腰基準ビュー */
export function buildTimelineView(poses, padding = 0.1) {
  const valid = (poses || []).filter((p) => visibleJointPoints(p).length);
  if (!valid.length) return null;

  let maxSpan = 0;
  for (const pose of valid) {
    const hip = hipCenter(pose);
    if (!hip) continue;
    for (const name of JOINT_NAMES) {
      const raw = pose[name];
      if (!isJointVisible(raw)) continue;
      maxSpan = Math.max(maxSpan, Math.abs(raw[0] - hip[0]), Math.abs(raw[1] - hip[1]));
    }
  }
  maxSpan = Math.max(maxSpan, 0.05);
  const scale = (1 - padding * 2) / (2 * maxSpan);

  return (pose, x, y) => {
    const hip = hipCenter(pose);
    if (!hip) return [0.5, 0.5];
    return [0.5 + (x - hip[0]) * scale, 0.5 + (y - hip[1]) * scale];
  };
}

function fitSinglePoseMapper(pose, padding = 0.08) {
  const pts = visibleJointPoints(pose);
  if (!pts.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const spanX = Math.max(maxX - minX, 0.08);
  const spanY = Math.max(maxY - minY, 0.12);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const inner = 1 - padding * 2;
  const scale = Math.min(inner / spanX, inner / spanY);
  return (x, y) => [(x - cx) * scale + 0.5, (y - cy) * scale + 0.5];
}

function jointXY(pose, name, w, h, mapFn = null) {
  const raw = pose?.[name];
  if (!isJointVisible(raw)) return null;
  const nx = mapFn ? mapFn(pose, raw[0], raw[1])[0] : raw[0];
  const ny = mapFn ? mapFn(pose, raw[0], raw[1])[1] : raw[1];
  return [nx * w, ny * h];
}

function boneColor(jointName) {
  return LIMB_STROKE[jointName] || "rgba(0, 255, 136, 0.95)";
}

/** 肩ラインの角度（画面座標、ラジアン） */
function shoulderLineAngle(pose, mapFn, w, h) {
  const ls = jointXY(pose, "left_shoulder", w, h, mapFn);
  const rs = jointXY(pose, "right_shoulder", w, h, mapFn);
  if (!ls || !rs) return null;
  return Math.atan2(rs[1] - ls[1], rs[0] - ls[0]);
}

/** 肩線の回転（捻り）を弧で表示 — 立体の「ひねり」方向の目安（大きめ） */
function drawTorsoRotationCue(ctx, prevPose, pose, w, h, mapFn) {
  if (!prevPose || !pose) return;
  const a0 = shoulderLineAngle(prevPose, mapFn, w, h);
  const a1 = shoulderLineAngle(pose, mapFn, w, h);
  if (a0 == null || a1 == null) return;
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  if (Math.abs(delta) < 0.028) return;

  const ls = jointXY(pose, "left_shoulder", w, h, mapFn);
  const rs = jointXY(pose, "right_shoulder", w, h, mapFn);
  if (!ls || !rs) return;
  const mx = (ls[0] + rs[0]) / 2;
  const my = (ls[1] + rs[1]) / 2;
  const ref = Math.min(w, h);
  const r = ref * 0.11;
  const col = delta > 0 ? "rgba(255, 140, 210, 0.95)" : "rgba(120, 220, 255, 0.95)";
  const sweep = delta * 0.92;
  const start = a1 - Math.PI / 2;

  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = ref * 0.006 + 1.4;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(mx, my, r + ref * 0.018, start, start - sweep, delta > 0);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = ref * 0.005 + 1.2;
  ctx.beginPath();
  ctx.arc(mx, my, r, start, start - sweep, delta > 0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * 関節間の短い区間を、横方向に並んだ極細線で描く（長さ方向の「切片」の 1 枚）
 */
function drawBoneRibbon(ctx, pa, pb, stroke, lineAlpha, strandCount, wRef) {
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.45) return;

  const px = -dy / len;
  const py = dx / len;

  const strands = Math.max(2, Math.min(6, strandCount));
  const halfSpan = Math.min(len * 0.22, wRef * 0.018, 5.5);
  const step = strands > 1 ? (2 * halfSpan) / (strands - 1) : 0;

  const strandW = Math.max(0.16, wRef / 720);

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.shadowBlur = 0;
  ctx.lineCap = "round";

  for (let k = 0; k < strands; k += 1) {
    const off = strands === 1 ? 0 : -halfSpan + k * step;
    const e = halfSpan > 0.01 ? Math.abs(off) / halfSpan : 0;
    const edgeFade = 0.35 + 0.65 * (1 - e * e);
    ctx.globalAlpha = lineAlpha * edgeFade;
    ctx.lineWidth = strandW;
    ctx.beginPath();
    ctx.moveTo(pa[0] + px * off, pa[1] + py * off);
    ctx.lineTo(pb[0] + px * off, pb[1] + py * off);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 関節 A→B を「長さ方向に複数本」に分割して描く（1 本の対角線ではなく骨の伸びが読める）
 */
function drawBoneLengthFibers(ctx, pa, pb, stroke, lineAlpha, wRef, opts = {}) {
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const len = Math.hypot(dx, dy);
  if (len < 2) return;

  const sliceMinPx = opts.sliceMinPx ?? 7;
  const sliceMax = opts.sliceMax ?? BONE_LENGTH_SLICES_MAX;
  const cross = opts.crossStrands ?? BONE_CROSS_STRANDS;
  const slices = Math.min(sliceMax, Math.max(5, Math.round(len / sliceMinPx)));

  for (let i = 0; i < slices; i += 1) {
    const t0 = i / slices;
    const t1 = (i + 1) / slices;
    const qa = [pa[0] + dx * t0, pa[1] + dy * t0];
    const qb = [pa[0] + dx * t1, pa[1] + dy * t1];
    drawBoneRibbon(ctx, qa, qb, stroke, lineAlpha, cross, wRef);
  }
}

function motionStrength(m) {
  return Math.min(1, m / MOTION_THRESH);
}

function drawMotionArrow(ctx, from, to, color, width = 2, scale = 1) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 3) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();

  const head = Math.min(22 * scale, len * 0.48);
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - head * Math.cos(angle - 0.42), to[1] - head * Math.sin(angle - 0.42));
  ctx.lineTo(to[0] - head * Math.cos(angle + 0.42), to[1] - head * Math.sin(angle + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * オニオンスキン — poses は古い順。alpha を段階的に上げて重ねる。
 */
export function drawOnionSkinLayers(ctx, poses, w, h, options = {}) {
  const {
    mapFn = null,
    alphaMin = ONION_ALPHA_MIN,
    alphaMax = ONION_ALPHA_MAX,
    colorLimbs = false,
    lengthSlicesMax = 11,
    lengthSliceMinPx = 12,
    lineScaleMin = 0.78,
    lineScaleMax = 0.9,
  } = options;
  const list = (poses || []).filter((p) => p && visibleJointPoints(p).length);
  const n = list.length;
  for (let i = 0; i < n; i += 1) {
    const alpha = n <= 1 ? alphaMax : alphaMin + ((alphaMax - alphaMin) * (i + 1)) / n;
    const lineScale =
      n <= 1 ? lineScaleMax : lineScaleMin + ((lineScaleMax - lineScaleMin) * (i + 1)) / n;
    drawPoseSkeleton(ctx, list[i], w, h, {
      mapFn,
      alpha,
      lineScale,
      showDots: "none",
      showShadow: false,
      colorLimbs,
      lengthSlicesMax,
      lengthSliceMinPx,
    });
  }
}

/** A→B 補間上の過去側ゴースト（モーションプレビュー用） */
export function buildMorphOnionPast(poseA, poseB, t, steps = ONION_PAST_LAYERS) {
  if (!poseA || !poseB) return [];
  const out = [];
  for (let i = steps; i >= 1; i -= 1) {
    const tt = Math.max(0, t - (i / steps) * 0.38);
    out.push(lerpPose(poseA, poseB, easeInOutSine(tt)));
  }
  return out;
}

function drawMotionArrows(ctx, prevPose, pose, w, h, mapFn) {
  if (!prevPose || !pose) return;
  const ref = Math.min(w, h);
  const scale = Math.max(0.85, Math.min(1.65, ref / 380));

  const scored = [];
  for (const name of MOTION_JOINTS) {
    const m = jointMotion(prevPose, pose, name);
    if (m < MOTION_THRESH * 0.42) continue;
    scored.push({ name, m });
  }
  scored.sort((a, b) => b.m - a.m);
  const picked = scored.slice(0, MOTION_ARROW_MAX_JOINTS);

  for (const { name, m } of picked) {
    const a = jointXY(prevPose, name, w, h, mapFn);
    const b = jointXY(pose, name, w, h, mapFn);
    if (a && b) {
      const wArrow = 1.15 + motionStrength(m) * 2.1;
      drawMotionArrow(ctx, a, b, "rgba(255, 210, 95, 0.94)", wArrow, scale);
    }
  }
  drawTorsoRotationCue(ctx, prevPose, pose, w, h, mapFn);
}

function drawPoseSkeleton(ctx, pose, w, h, options = {}) {
  const {
    mapFn = null,
    alpha = 1,
    lineScale = 1,
    showDots = "extremities",
    showShadow = true,
    colorLimbs = false,
    refPose = null,
    motionAware = false,
    useRibbon = true,
    lengthSlicesMax: lengthSlicesMaxOpt = null,
    lengthSliceMinPx: lengthSliceMinPxOpt = null,
    crossStrands: crossStrandsOpt = null,
  } = options;
  if (!pose) return;
  pose = enrichPoseHands(pose);
  const ref = refPose ? enrichPoseHands(refPose) : null;

  const wRef = w * lineScale;
  const lengthSlicesMax =
    lengthSlicesMaxOpt ?? (w >= 200 ? 28 : w >= 140 ? 20 : w >= 100 ? 14 : 10);
  const sliceMinPx =
    lengthSliceMinPxOpt ?? (w >= 200 ? 6.5 : w >= 120 ? 8.5 : 10.5);
  const crossStrands = crossStrandsOpt ?? BONE_CROSS_STRANDS;

  ctx.save();
  ctx.globalAlpha = alpha;

  for (const [a, b] of BONES) {
    const pa = jointXY(pose, a, w, h, mapFn);
    const pb = jointXY(pose, b, w, h, mapFn);
    if (!pa || !pb) continue;

    let stroke = colorLimbs ? boneColor(a) : "rgba(0, 255, 136, 0.95)";
    let boneAlpha = 1;

    if (motionAware && ref) {
      const m = boneMotion(ref, pose, a, b);
      const s = motionStrength(m);
      boneAlpha = 0.18 + s * 0.82;
      if (s > 0.35) stroke = boneColor(a);
    }

    const lineA = alpha * boneAlpha;

    if (useRibbon) {
      drawBoneLengthFibers(ctx, pa, pb, stroke, lineA, wRef, {
        sliceMax: lengthSlicesMax,
        sliceMinPx,
        crossStrands,
      });
      if (showShadow && boneAlpha > 0.45) {
        ctx.save();
        ctx.globalAlpha = lineA * 0.2;
        ctx.strokeStyle = "rgba(0, 255, 136, 0.45)";
        ctx.lineWidth = Math.max(1, wRef / 220);
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(0, 255, 136, 0.35)";
        ctx.shadowBlur = Math.max(2, w / 280);
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      const baseLw = Math.max(0.6, (w / 320) * lineScale);
      ctx.globalAlpha = lineA;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = baseLw;
      ctx.lineCap = "round";
      if (showShadow && boneAlpha > 0.45) {
        ctx.shadowColor = "rgba(0, 255, 136, 0.35)";
        ctx.shadowBlur = Math.max(1, w / 280);
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = alpha;

  if (showDots === "none") {
    ctx.restore();
    return;
  }

  const dotR = Math.max(1.5, w / 100);
  const extR = Math.max(2.2, w / 72);

  if (showDots === "extremities" || showDots === "all") {
    const head = jointXY(pose, HEAD_DOT, w, h, mapFn);
    if (head) {
      ctx.fillStyle = "#00ff88";
      ctx.beginPath();
      ctx.arc(head[0], head[1], dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (showDots === "extremities") {
    for (const name of EXTREMITY_DOTS) {
      const p = jointXY(pose, name, w, h, mapFn);
      if (!p) continue;
      const m = ref ? jointMotion(ref, pose, name) : MOTION_THRESH;
      const s = motionAware ? motionStrength(m) : 1;
      ctx.fillStyle = s > 0.3 ? "#ffcc44" : "rgba(255, 204, 68, 0.35)";
      ctx.beginPath();
      ctx.arc(p[0], p[1], extR * (0.75 + s * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/** 動画オーバーレイ — オニオン（薄→濃）→ 本体 → 矢印 */
export function drawPose(ctx, pose, w, h, prevPose = null, refForMotion = null, onionOpts = {}) {
  const onionPast = onionOpts.onionPast ?? [];
  const onionFuture = onionOpts.onionFuture ?? [];
  const past =
    onionPast.length > 0
      ? onionPast
      : prevPose && prevPose !== pose
        ? [prevPose]
        : [];
  const ref =
    refForMotion ??
    (past.length ? past[past.length - 1] : null) ??
    prevPose;

  drawOnionSkinLayers(ctx, past, w, h);
  if (onionFuture.length) {
    drawOnionSkinLayers(ctx, onionFuture, w, h, {
      alphaMin: 0.03,
      alphaMax: ONION_FUTURE_ALPHA_MAX,
      lineScaleMin: 0.76,
      lineScaleMax: 0.86,
    });
  }
  drawPoseSkeleton(ctx, pose, w, h, {
    showDots: "extremities",
    showShadow: true,
    colorLimbs: true,
    refPose: ref,
    motionAware: !!ref,
  });
  if (ref && ref !== pose) {
    drawMotionArrows(ctx, ref, pose, w, h, null);
  }
}

/** サイドパネル: カウント間の補間アニメ */
export function drawMotionPreview(ctx, w, h, poseA, poseB, t, timelineView) {
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, w, h);

  if (!poseA || !poseB || !timelineView) return;

  const mid = lerpPose(poseA, poseB, easeInOutSine(t));
  const onionPast = buildMorphOnionPast(poseA, poseB, t);
  const onionFuture = [];
  for (let i = 1; i <= ONION_FUTURE_LAYERS; i += 1) {
    const tt = Math.min(1, t + (i / ONION_FUTURE_LAYERS) * 0.28);
    onionFuture.push(lerpPose(poseA, poseB, easeInOutSine(tt)));
  }

  drawOnionSkinLayers(ctx, onionPast, w, h, {
    mapFn: timelineView,
    alphaMin: 0.04,
    alphaMax: 0.22,
    lengthSlicesMax: 9,
    lengthSliceMinPx: 12,
  });
  if (onionFuture.length) {
    drawOnionSkinLayers(ctx, onionFuture, w, h, {
      mapFn: timelineView,
      alphaMin: 0.03,
      alphaMax: ONION_FUTURE_ALPHA_MAX,
      lengthSlicesMax: 8,
      lengthSliceMinPx: 13,
    });
  }

  drawPoseSkeleton(ctx, mid, w, h, {
    mapFn: timelineView,
    showDots: "extremities",
    showShadow: false,
    colorLimbs: true,
    refPose: poseA,
    motionAware: true,
    lengthSlicesMax: 22,
    lengthSliceMinPx: 7.5,
  });

  drawMotionArrows(ctx, poseA, mid, w, h, timelineView);
}

/** 16カウントの手足軌道（時間軸 = 横、動き = 縦） */
export function drawPhraseTrajectories(canvas, poses, timelineView, selectedLocalI = -1) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!timelineView || !poses?.length) return;

  const n = poses.length;
  const colW = w / n;

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1;
  for (let i = 1; i < n; i += 1) {
    const x = i * colW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (const { name, color } of TRAIL_JOINTS) {
    const pts = [];
    poses.forEach((pose, i) => {
      const raw = pose?.[name];
      if (!isJointVisible(raw)) return;
      const [nx, ny] = timelineView(pose, raw[0], raw[1]);
      pts.push([colW * (i + 0.5), ny * (h - 8) + 4]);
    });
    if (pts.length < 2) continue;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();

    for (const [x, y] of pts) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (selectedLocalI >= 0 && selectedLocalI < n) {
    const x = colW * (selectedLocalI + 0.5);
    ctx.strokeStyle = "rgba(0, 255, 136, 0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function drawPoseOnCanvas(canvas, pose) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, w, h);
  const mapper = fitSinglePoseMapper(pose);
  if (!mapper) return;
  const mapFn = (_pose, x, y) => mapper(x, y);
  drawPoseSkeleton(ctx, pose, w, h, { mapFn, showDots: "extremities", colorLimbs: true });
}

export function drawCountPoseOnCanvas(canvas, pose, timelineView, onionPast = []) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, w, h);
  if (!pose || !timelineView) return;

  const past = (onionPast || []).filter(Boolean);
  const ref = past.length ? past[past.length - 1] : null;

  drawOnionSkinLayers(ctx, past, w, h, {
    mapFn: timelineView,
    alphaMin: 0.05,
    alphaMax: 0.2,
    lengthSlicesMax: 9,
    lengthSliceMinPx: 12,
  });

  drawPoseSkeleton(ctx, pose, w, h, {
    mapFn: timelineView,
    showDots: "extremities",
    showShadow: false,
    colorLimbs: true,
    refPose: ref,
    motionAware: !!ref,
    lengthSlicesMax: 22,
    lengthSliceMinPx: 7.5,
  });

  if (ref) drawMotionArrows(ctx, ref, pose, w, h, timelineView);
}
