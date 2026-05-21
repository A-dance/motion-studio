/**
 * 譜面ポーズ名 ↔ Three.js（MediaPipe 風）名の変換
 */
import { DEFAULT_POSE, JOINT_NAMES } from "./pose-math.js";

/** skeleton 形式 → Three.js 用 */
const TO_THREE = [
  ["nose", ["head", "nose"]],
  ["left_shoulder", ["shoulderL", "left_shoulder"]],
  ["right_shoulder", ["shoulderR", "right_shoulder"]],
  ["left_elbow", ["elbowL", "left_elbow"]],
  ["right_elbow", ["elbowR", "right_elbow"]],
  ["left_wrist", ["wristL", "left_wrist"]],
  ["right_wrist", ["wristR", "right_wrist"]],
  ["left_hand", ["handL", "left_hand"]],
  ["right_hand", ["handR", "right_hand"]],
  ["left_hip", ["hipL", "left_hip"]],
  ["right_hip", ["hipR", "right_hip"]],
  ["left_knee", ["kneeL", "left_knee"]],
  ["right_knee", ["kneeR", "right_knee"]],
  ["left_ankle", ["ankleL", "left_ankle"]],
  ["right_ankle", ["ankleR", "right_ankle"]],
];

export function normalizePoseForThree(pose) {
  if (!pose) return { ...DEFAULT_POSE };
  if (pose.left_shoulder || pose.left_hip) {
    const out = {};
    for (const id of JOINT_NAMES) {
      if (pose[id]) out[id] = [...pose[id]];
    }
    return out;
  }

  const out = { ...DEFAULT_POSE };
  for (const [canonical, aliases] of TO_THREE) {
    for (const key of aliases) {
      if (pose[key]?.length >= 2) {
        out[canonical] = [...pose[key]];
        if (out[canonical].length === 2) out[canonical].push(0.99, 0);
        break;
      }
    }
  }
  return out;
}
