/**
 * 譜面ポーズ ↔ 3D 座標（体幹フレーム）
 */
import { BONES, HAND_EXTEND_RATIO, MIN_VISIBILITY } from "./constants.js";

export const JOINT_NAMES = [...new Set(BONES.flatMap(([a, b]) => [a, b]))];
/** @deprecated JOINT_NAMES を使う */
export const JOINT_IDS = JOINT_NAMES;

export const JOINT_LABELS = {
  nose: "頭",
  left_shoulder: "左肩",
  right_shoulder: "右肩",
  left_elbow: "左肘",
  right_elbow: "右肘",
  left_wrist: "左手首",
  right_wrist: "右手首",
  left_hand: "左手",
  right_hand: "右手",
  left_hip: "左腰",
  right_hip: "右腰",
  left_knee: "左膝",
  right_knee: "右膝",
  left_ankle: "左足首",
  right_ankle: "右足首",
};

/** 編集開始用の立ちポーズ（正規化 0–1） */
export const DEFAULT_POSE = {
  nose: [0.5, 0.2, 0.99, 0],
  left_shoulder: [0.42, 0.32, 0.99, 0],
  right_shoulder: [0.58, 0.32, 0.99, 0],
  left_elbow: [0.35, 0.45, 0.99, 0],
  right_elbow: [0.65, 0.45, 0.99, 0],
  left_wrist: [0.3, 0.58, 0.99, 0],
  right_wrist: [0.7, 0.58, 0.99, 0],
  left_hand: [0.28, 0.62, 0.99, 0],
  right_hand: [0.72, 0.62, 0.99, 0],
  left_hip: [0.44, 0.55, 0.99, 0],
  right_hip: [0.56, 0.55, 0.99, 0],
  left_knee: [0.43, 0.72, 0.99, 0],
  right_knee: [0.57, 0.72, 0.99, 0],
  left_ankle: [0.42, 0.9, 0.99, 0],
  right_ankle: [0.58, 0.9, 0.99, 0],
};

function isJointVisible(raw) {
  if (!raw || raw.length < 2) return false;
  if (raw.length >= 3 && raw[2] < MIN_VISIBILITY) return false;
  return true;
}

function jointVis(raw) {
  return raw.length >= 3 ? raw[2] : 1;
}

function jointMpZ(raw) {
  return raw.length > 3 ? raw[3] : null;
}

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
    const vis = Math.min(jointVis(wrist), jointVis(elbow)) * 0.85;
    const wz = jointMpZ(wrist);
    const ez = jointMpZ(elbow);
    const row = [
      wrist[0] + (fx / forearm) * ext,
      wrist[1] + (fy / forearm) * ext,
      vis,
    ];
    if (wz != null) row.push(wz + ((wz - (ez ?? wz)) * ext) / forearm);
    out[key] = row;
  }
  return out;
}

export function buildTorsoFrame(pose) {
  const p = enrichPoseHands(pose);
  const ls = p?.left_shoulder;
  const rs = p?.right_shoulder;
  const lh = p?.left_hip;
  const rh = p?.right_hip;
  if (!isJointVisible(ls) || !isJointVisible(rs) || !isJointVisible(lh) || !isJointVisible(rh)) {
    return null;
  }

  const hipMid = {
    x: (lh[0] + rh[0]) / 2,
    y: (lh[1] + rh[1]) / 2,
    z: ((jointMpZ(lh) ?? 0) + (jointMpZ(rh) ?? 0)) / 2,
  };
  const shoulderMid = {
    x: (ls[0] + rs[0]) / 2,
    y: (ls[1] + rs[1]) / 2,
    z: ((jointMpZ(ls) ?? 0) + (jointMpZ(rs) ?? 0)) / 2,
  };

  const up = { x: shoulderMid.x - hipMid.x, y: -(shoulderMid.y - hipMid.y), z: shoulderMid.z - hipMid.z };
  const right = {
    x: rs[0] - ls[0],
    y: -(rs[1] - ls[1]),
    z: (jointMpZ(rs) ?? 0) - (jointMpZ(ls) ?? 0),
  };

  const len3 = (v) => Math.hypot(v.x, v.y, v.z);
  const norm = (v) => {
    const l = len3(v);
    if (l < 1e-8) return null;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };

  const upN = norm(up);
  const rightN = norm(right);
  if (!upN || !rightN) return null;

  const forward = {
    x: rightN.y * upN.z - rightN.z * upN.y,
    y: rightN.z * upN.x - rightN.x * upN.z,
    z: rightN.x * upN.y - rightN.y * upN.x,
  };
  const forwardN = norm(forward);
  if (!forwardN) return null;

  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const rightFinal = norm(cross(upN, forwardN));
  if (!rightFinal) return null;

  const torsoH = Math.abs(shoulderMid.y - hipMid.y);
  const scale = Math.max(1.6, Math.min(2.8, torsoH * 8.5));

  return { hipMid, up: upN, right: rightFinal, forward: forwardN, scale };
}

export function jointToWorld(pose, name, frame) {
  const raw = enrichPoseHands(pose)?.[name];
  if (!isJointVisible(raw) || !frame) return null;

  const { hipMid, up, right, forward, scale } = frame;
  const dx = raw[0] - hipMid.x;
  const dy = hipMid.y - raw[1];
  const mpz = jointMpZ(raw);

  return {
    x: right.x * dx * scale + up.x * dy * scale + (mpz != null ? forward.x * -mpz * scale * 1.15 : 0),
    y: right.y * dx * scale + up.y * dy * scale + (mpz != null ? forward.y * -mpz * scale * 1.15 : 0),
    z: right.z * dx * scale + up.z * dy * scale + (mpz != null ? forward.z * -mpz * scale * 1.15 : 0),
  };
}

export function worldToJoint(world, pose, jointName) {
  const frame = buildTorsoFrame(pose);
  if (!frame || !world) return null;

  const { hipMid, up, right, forward, scale } = frame;
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

  const dx = dot(world, right) / scale;
  const dy = dot(world, up) / scale;
  const mpz = dot(world, forward) / (-scale * 1.15);

  const prev = pose?.[jointName];
  const vis = prev?.length >= 3 ? prev[2] : 0.99;

  return [hipMid.x + dx, hipMid.y - dy, vis, Number.isFinite(mpz) ? mpz : 0];
}

export function clonePose(pose) {
  const out = {};
  for (const [k, v] of Object.entries(pose || {})) {
    if (Array.isArray(v)) out[k] = [...v];
  }
  return out;
}

export function setJoint(pose, name, x, y, z = null) {
  const prev = pose[name] || [0.5, 0.5, 0.99];
  const row = [x, y, prev[2] ?? 0.99];
  if (z != null) row.push(z);
  else if (prev.length > 3) row.push(prev[3]);
  pose[name] = row;
  return enrichPoseHands(pose);
}

export function nudgeJoint(pose, name, dx, dy, dz = 0) {
  const prev = pose[name];
  if (!prev) return pose;
  const x = Math.max(0.05, Math.min(0.95, prev[0] + dx));
  const y = Math.max(0.05, Math.min(0.95, prev[1] + dy));
  const z = (prev[3] ?? 0) + dz;
  return setJoint(pose, name, x, y, z);
}
