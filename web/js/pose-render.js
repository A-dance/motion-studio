/** 棒人間（緑骨格）描画 */
import { BONES, MIN_VISIBILITY } from "./constants.js";

function jointXY(pose, name, w, h) {
  const raw = pose?.[name];
  if (!raw || raw.length < 2) return null;
  if (raw.length >= 3 && raw[2] < MIN_VISIBILITY) return null;
  return [raw[0] * w, raw[1] * h];
}

export function drawPose(ctx, pose, w, h) {
  if (!pose) return;
  ctx.strokeStyle = "rgba(0, 255, 136, 0.95)";
  ctx.lineWidth = Math.max(1.5, w / 160);
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(0, 255, 136, 0.6)";
  ctx.shadowBlur = Math.max(2, w / 120);
  for (const [a, b] of BONES) {
    const pa = jointXY(pose, a, w, h);
    const pb = jointXY(pose, b, w, h);
    if (pa && pb) {
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#00ff88";
  const r = Math.max(2, w / 90);
  for (const name of [
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_ankle",
    "right_ankle",
  ]) {
    const p = jointXY(pose, name, w, h);
    if (p) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawPoseOnCanvas(canvas, pose) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, w, h);
  drawPose(ctx, pose, w, h);
}
