/**
 * カウント（タイムライン）の管理 — ポーズ・方向・メモを各拍に保存
 */
import { clonePose, defaultDirection, STAND_POSE } from "./skeleton.js";

export function createCount(index) {
  return {
    id: index,
    label: String(index),
    pose: clonePose(STAND_POSE),
    direction: defaultDirection(),
    memo: "",
    motionTag: "",
  };
}

export function createSequence(length = 4) {
  return {
    counts: Array.from({ length }, (_, i) => createCount(i + 1)),
  };
}

export function addCount(seq) {
  const n = seq.counts.length + 1;
  seq.counts.push(createCount(n));
  return n;
}

export function removeCount(seq) {
  if (seq.counts.length <= 1) return false;
  seq.counts.pop();
  return true;
}
