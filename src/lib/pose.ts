import type { Pose, Vec3, Count, Phrase, Work } from "./types";

// ─── デフォルトポーズ（肩〜手のひら / 腰〜足先まで） ─────────
export const STAND_POSE: Pose = {
  head:   [  0,    1.75,  0    ],
  neck:   [  0,    1.50,  0    ],
  shldrL: [ -0.46, 1.40,  0    ],
  shldrR: [  0.46, 1.40,  0    ],
  elbowL: [ -0.54, 0.90,  0    ],
  elbowR: [  0.54, 0.90,  0    ],
  wristL: [ -0.54, 0.40,  0    ],
  wristR: [  0.54, 0.40,  0    ],
  handL:  [ -0.54, 0.22,  0    ],
  handR:  [  0.54, 0.22,  0    ],
  hip:    [  0,    0.84,  0    ],
  hipL:   [ -0.22, 0.72,  0    ],
  hipR:   [  0.22, 0.72,  0    ],
  kneeL:  [ -0.22, 0.00,  0    ],
  kneeR:  [  0.22, 0.00,  0    ],
  ankleL: [ -0.22, -0.95, 0    ],
  ankleR: [  0.22, -0.95, 0    ],
  footL:  [ -0.22, -1.12, 0.07 ],
  footR:  [  0.22, -1.12, 0.07 ],
};

export function clonePose(p: Pose): Pose {
  const r: Pose = {};
  for (const [k, v] of Object.entries(p)) r[k] = [...v] as Vec3;
  return r;
}

// ─── ファクトリ ───────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

export function phraseLabel(idx: number): string {
  const ch = String.fromCharCode(65 + (idx % 26));
  const n  = Math.floor(idx / 26);
  return n === 0 ? ch : `${ch}${n + 1}`;
}

export function makeCount(n: number): Count {
  return { n, pose: clonePose(STAND_POSE), items: [], bodyYaw: 0, headYaw: 0 };
}

export function makePhrase(idx: number): Phrase {
  return {
    id:     uid(),
    label:  phraseLabel(idx),
    counts: Array.from({ length: 16 }, (_, i) => makeCount(i + 1)),
  };
}

export function makeWork(name = ""): Work {
  return { id: uid(), name, phrases: [makePhrase(0)] };
}

// ─── 変更検知 ─────────────────────────────────────────────
export function hasContent(c: Count): boolean {
  if (c.items.length > 0) return true;
  if (Math.abs(c.bodyYaw) > 1 || Math.abs(c.headYaw) > 1) return true;
  for (const id of Object.keys(STAND_POSE)) {
    const p = c.pose[id]; const s = STAND_POSE[id];
    if (!p || !s) continue;
    if (Math.abs(p[0]-s[0]) > 0.03 || Math.abs(p[1]-s[1]) > 0.03) return true;
  }
  return false;
}

// ═══ IK 純粋数学ヘルパー ═══════════════════════════════════

function vSub(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function vAdd(a: Vec3, b: Vec3): Vec3 { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function vScale(a: Vec3, s: number): Vec3 { return [a[0]*s, a[1]*s, a[2]*s]; }
function vLen(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function vNorm(a: Vec3): Vec3 { const l=vLen(a)||1; return [a[0]/l, a[1]/l, a[2]/l]; }
function vDot(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function vDist(a: Vec3, b: Vec3): number { return vLen(vSub(b,a)); }

/**
 * 2関節 IK（分析法 / ポールベクター方式）
 *
 * @param root     固定点（肩 / 股関節）
 * @param target   目標点（手首 / 足首）
 * @param L1       上部ボーン長（上腕 / 大腿）
 * @param L2       下部ボーン長（前腕 / 下腿）
 * @param poleVec  肘 / 膝が向くべきポールベクター（現在の中間関節位置から計算）
 * @returns        中間関節（肘 / 膝）の新しい位置
 */
function solve2BoneIK(root: Vec3, target: Vec3, L1: number, L2: number, poleVec: Vec3): Vec3 {
  const toTarget = vSub(target, root);
  const d = vLen(toTarget);
  if (d < 0.001) return root;

  const dirT = vNorm(toTarget);
  const effD = Math.max(Math.abs(L1-L2)+0.001, Math.min(L1+L2-0.001, d));

  // 余弦定理でルート角度を計算
  const cosA  = (L1*L1 + effD*effD - L2*L2) / (2*L1*effD);
  const sinA  = Math.sqrt(Math.max(0, 1-cosA*cosA));

  // ポールベクターを arm 方向に直交化してperp軸を得る
  const dotPT = vDot(poleVec, dirT);
  let perp    = vSub(poleVec, vScale(dirT, dotPT));
  if (vLen(perp) < 0.05) {
    const fallback: Vec3 = Math.abs(dirT[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const dotF = vDot(fallback, dirT);
    perp = vSub(fallback, vScale(dirT, dotF));
  }
  perp = vNorm(perp);

  return [
    root[0] + L1*(cosA*dirT[0] + sinA*perp[0]),
    root[1] + L1*(cosA*dirT[1] + sinA*perp[1]),
    root[2] + L1*(cosA*dirT[2] + sinA*perp[2]),
  ];
}

// デフォルトポールベクター（腕：肘が後ろ方向、足：膝が前方向）
const DEFAULT_POLES: Record<string, Vec3> = {
  shldrR: [0, -0.3, -1], shldrL: [0, -0.3, -1],
  hipR:   [0, -0.2,  1], hipL:   [0, -0.2,  1],
};

/**
 * チェーン IK — 任意の関節をドラッグしたとき親チェーンを自動調整する
 *
 * 対応チェーン:
 *   肩 → 肘 → 手首 → 手のひら  （右腕 / 左腕）
 *   股関節 → 膝 → 足首 → 足先  （右足 / 左足）
 *
 * - ルート（肩/股）をドラッグ → チェーン全体を平行移動
 * - 中間（肘/膝）をドラッグ → 直接移動、末端チェーンも追従
 * - 末端（手首/足首）をドラッグ → 2ボーン IK でポーズ解決
 * - 終端（手のひら/足先）をドラッグ → 2ボーン IK + 終端を延伸
 * - 非チェーン関節（頭・腰など）→ 直接移動
 */
export function applyChainIK(pose: Pose, draggedId: string, newPos: Vec3): Pose {
  const p = { ...pose };
  p[draggedId] = newPos;

  type Chain = [string, string, string, string]; // [root, mid, tip, end]
  const CHAINS: Chain[] = [
    ["shldrR","elbowR","wristR","handR"],
    ["shldrL","elbowL","wristL","handL"],
    ["hipR",  "kneeR", "ankleR","footR"],
    ["hipL",  "kneeL", "ankleL","footL"],
  ];

  for (const ch of CHAINS) {
    const idx = ch.indexOf(draggedId);
    if (idx < 0) continue;

    const [root, mid, tip, end] = ch;
    const rootPos = pose[root] as Vec3;

    // 現在のボーン長（ユーザーが伸縮させた値を維持）
    const L1 = vDist(pose[root] as Vec3, pose[mid] as Vec3);
    const L2 = vDist(pose[mid]  as Vec3, pose[tip] as Vec3);
    const L3 = vDist(pose[tip]  as Vec3, pose[end] as Vec3);

    if (idx === 0) {
      // ルート移動 → チェーン全体平行移動
      const d = vSub(newPos, pose[root] as Vec3);
      p[mid]  = vAdd(pose[mid]  as Vec3, d);
      p[tip]  = vAdd(pose[tip]  as Vec3, d);
      p[end]  = vAdd(pose[end]  as Vec3, d);
      break;
    }

    if (idx === 1) {
      // 中間（肘/膝）直接移動 → 下段チェーンも追従
      const d = vSub(newPos, pose[mid] as Vec3);
      p[tip]  = vAdd(pose[tip] as Vec3, d);
      p[end]  = vAdd(pose[end] as Vec3, d);
      break;
    }

    // 末端 or 終端: 2ボーン IK
    // ---- IK の目標点を決める ----
    let ikTarget: Vec3;
    if (idx === 2) {
      ikTarget = newPos;          // 手首/足首ドラッグ
    } else {
      // 終端（手のひら/足先）ドラッグ: 手首/足首の目標を比例で求める
      const totalLen = L1 + L2 + L3;
      const ratio    = totalLen > 0.001 ? (L1+L2) / totalLen : 1;
      ikTarget = vAdd(rootPos, vScale(vSub(newPos, rootPos), ratio));
      // 腕の届く範囲にクランプ
      const dist2Root = vDist(rootPos, ikTarget);
      if (dist2Root > L1+L2-0.01) {
        ikTarget = vAdd(rootPos, vScale(vNorm(vSub(ikTarget, rootPos)), L1+L2-0.01));
      }
    }

    // ---- ポールベクター: 現在の肘/膝位置から生成 ----
    const curMid    = pose[mid] as Vec3;
    const toTarget  = vNorm(vSub(ikTarget, rootPos));
    const dotCM     = vDot(vSub(curMid, rootPos), toTarget);
    const projCM    = vAdd(rootPos, vScale(toTarget, dotCM));
    let poleVec     = vSub(curMid, projCM);  // perpendicular component
    if (vLen(poleVec) < 0.04) {
      poleVec = DEFAULT_POLES[root] ?? [0, 1, 0];
    }

    // ---- 2ボーン IK で肘/膝位置を解く ----
    const newMid = solve2BoneIK(rootPos, ikTarget, L1, L2, poleVec);
    p[mid] = newMid;
    p[tip] = ikTarget;

    // 終端を延伸
    if (idx === 3) {
      p[end] = newPos;
    } else {
      // 手首ドラッグ時は手のひらを前腕方向に延伸
      const armDir = vNorm(vSub(ikTarget, newMid));
      p[end] = vAdd(ikTarget, vScale(armDir, L3));
    }
    break;
  }

  return p;
}

// ─── localStorage ─────────────────────────────────────────
const LS_KEY = "dance-studio-v6";

export function saveWork(work: Work) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(work)); } catch { /* ignore */ }
}

export function loadWork(): Work | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      // 旧バージョンデータの移行を試みる
      const legacy = localStorage.getItem("dance-studio-v5") ?? localStorage.getItem("dance-studio-v4");
      if (!legacy) return null;
      const w = JSON.parse(legacy) as Work;
      if (!w?.phrases?.length) return null;
      migrateWork(w);
      return w;
    }
    const w = JSON.parse(raw) as Work;
    if (!w?.phrases?.length) return null;
    migrateWork(w);
    return w;
  } catch { return null; }
}

function migrateWork(w: Work) {
  for (const phrase of w.phrases) {
    for (const c of phrase.counts) {
      c.pose    = { ...clonePose(STAND_POSE), ...c.pose };
      c.items   = c.items   ?? [];
      c.headYaw = c.headYaw ?? 0;
      c.bodyYaw = c.bodyYaw ?? 0;
    }
  }
}
