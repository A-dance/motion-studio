/**
 * pose-3d.js — 粘土細工型 6DOF ダンサーステージ
 *
 * 各関節 = boneRot（回転）+ bonePos（位置オフセット）— 制限なし
 * ドラッグ = 画面上の動きに同期した「平行移動 + 回転」のハイブリッド
 *   肩を上げる → bonePos.y で肩すくめ / 下げる → 肩下制
 *   どの関節も掴んだ点だけが動く（FK・1関節更新）
 */
import * as THREE from "three";

// ─── ボーン定義 ─────────────────────────────────────────────
export const BONE_DEFS = [
  { id: "hip",    parent: null,     offset: [0,      0.84,   0    ], r: 0.095 },
  { id: "neck",   parent: "hip",    offset: [0,      0.66,   0    ], r: 0.055 },
  { id: "head",   parent: "neck",   offset: [0,      0.25,   0    ], r: 0.125 },
  { id: "shldrL", parent: "neck",   offset: [-0.46, -0.10,   0    ], r: 0.088 },
  { id: "elbowL", parent: "shldrL", offset: [-0.08, -0.50,   0    ], r: 0.065 },
  { id: "wristL", parent: "elbowL", offset: [0,     -0.50,   0    ], r: 0.058 },
  { id: "handL",  parent: "wristL", offset: [0,     -0.18,   0    ], r: 0.048 },
  { id: "shldrR", parent: "neck",   offset: [0.46,  -0.10,   0    ], r: 0.088 },
  { id: "elbowR", parent: "shldrR", offset: [0.08,  -0.50,   0    ], r: 0.065 },
  { id: "wristR", parent: "elbowR", offset: [0,     -0.50,   0    ], r: 0.058 },
  { id: "handR",  parent: "wristR", offset: [0,     -0.18,   0    ], r: 0.048 },
  { id: "hipL",   parent: "hip",    offset: [-0.22, -0.12,   0    ], r: 0.080 },
  { id: "kneeL",  parent: "hipL",   offset: [0,     -0.72,   0    ], r: 0.073 },
  { id: "ankleL", parent: "kneeL",  offset: [0,     -0.93,   0    ], r: 0.058 },
  { id: "footL",  parent: "ankleL", offset: [0,     -0.06,   0.13 ], r: 0.044 },
  { id: "hipR",   parent: "hip",    offset: [0.22,  -0.12,   0    ], r: 0.080 },
  { id: "kneeR",  parent: "hipR",   offset: [0,     -0.72,   0    ], r: 0.073 },
  { id: "ankleR", parent: "kneeR",  offset: [0,     -0.93,   0    ], r: 0.058 },
  { id: "footR",  parent: "ankleR", offset: [0,     -0.06,   0.13 ], r: 0.044 },
];

export const BONE_LABELS = {
  hip: "腰", neck: "首", head: "頭",
  shldrL: "左肩", elbowL: "左肘", wristL: "左手首", handL: "左手",
  shldrR: "右肩", elbowR: "右肘", wristR: "右手首", handR: "右手",
  hipL: "左股", kneeL: "左膝", ankleL: "左足首", footL: "左足",
  hipR: "右股", kneeR: "右膝", ankleR: "右足首", footR: "右足",
};

export const REST_POSE     = Object.fromEntries(BONE_DEFS.map(d => [d.id, [0, 0, 0]]));
export const REST_POSE_POS = Object.fromEntries(BONE_DEFS.map(d => [d.id, [0, 0, 0]]));

export function cloneBoneRot(br) {
  const r = {};
  for (const id of Object.keys(REST_POSE)) {
    const v = br?.[id];
    r[id] = (Array.isArray(v) && v.length >= 3)
      ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
      : [0, 0, 0];
  }
  return r;
}

/** 回転制限なし — NaN のみ除去 */
export function clampBoneRot(_boneId, rot) {
  return [
    Number.isFinite(+rot[0]) ? +rot[0] : 0,
    Number.isFinite(+rot[1]) ? +rot[1] : 0,
    Number.isFinite(+rot[2]) ? +rot[2] : 0,
  ];
}

export function cloneBonePos(bp) {
  const r = {};
  for (const id of Object.keys(REST_POSE_POS)) {
    const v = bp?.[id];
    r[id] = (Array.isArray(v) && v.length >= 3)
      ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
      : [0, 0, 0];
  }
  return r;
}

export function sanitizeBonePos(bp) {
  const r = cloneBonePos(REST_POSE_POS);
  if (!bp || typeof bp !== "object") return r;
  for (const id of Object.keys(REST_POSE_POS)) {
    const v = bp[id];
    if (Array.isArray(v) && v.length >= 3) {
      r[id] = clampBonePos(id, [
        Number.isFinite(+v[0]) ? +v[0] : 0,
        Number.isFinite(+v[1]) ? +v[1] : 0,
        Number.isFinite(+v[2]) ? +v[2] : 0,
      ]);
    }
  }
  return r;
}

/** 位置オフセットを許可する関節（肩すくめ・腰など） */
const POS_BONES = new Set([
  "shldrL", "shldrR", "neck", "hip", "hipL", "hipR",
]);

/** 位置オフセットの上限（伸びすぎ防止） */
export function clampBonePos(boneId, pos) {
  if (!POS_BONES.has(boneId)) return [0, 0, 0];
  const max = boneId.startsWith("shldr") ? 0.38
    : (boneId === "neck" || boneId === "hip") ? 0.28
    : 0.32;
  return [
    Math.max(-max, Math.min(max, pos[0])),
    Math.max(-max, Math.min(max, pos[1])),
    Math.max(-max, Math.min(max, pos[2])),
  ];
}

/** 不正な保存データを REST に近い形へ正規化 */
export function sanitizeBoneRot(br) {
  const r = cloneBoneRot(REST_POSE);
  if (!br || typeof br !== "object") return r;
  for (const id of Object.keys(REST_POSE)) {
    const v = br[id];
    if (Array.isArray(v) && v.length >= 3) {
      r[id] = clampBoneRot(id, [
        Number.isFinite(+v[0]) ? +v[0] : 0,
        Number.isFinite(+v[1]) ? +v[1] : 0,
        Number.isFinite(+v[2]) ? +v[2] : 0,
      ]);
    }
  }
  return r;
}

function finiteYaw(deg, fallback = 0) {
  const n = Number(deg);
  return Number.isFinite(n) ? n : fallback;
}

export function sanitizeBoneScale(scale) {
  const arm = Number(scale?.armScale);
  const leg = Number(scale?.legScale);
  return {
    armScale: Number.isFinite(arm) && arm > 0 ? Math.max(0.5, Math.min(2, arm)) : 1,
    legScale: Number.isFinite(leg) && leg > 0 ? Math.max(0.5, Math.min(2, leg)) : 1,
  };
}

// ─── ボーン定義マップ ─────────────────────────────────────────
const BONE_DEFS_MAP = Object.fromEntries(BONE_DEFS.map(d => [d.id, d]));
const BASE_OFFSETS  = Object.fromEntries(BONE_DEFS.map(d => [d.id, [...d.offset]]));

// ─── 手の向き補正クォータニオン ──────────────────────────────
// BoxGeometry の +Y 軸（指先方向）を worldQuat が identity のとき -Y（下向き）に向ける。
// setFromUnitVectors(+Y, -Y) → Three.js は +Z 周り 180° を選ぶ。
// これにより:  +Y local → -Y world（指が下）
//              +Z local → +Z world（手のひら面がカメラ方向）
//              +X local → -X world（幅が反転）
const HAND_CORR_Q = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
);

// 足の向き補正: ボーンオフセット [0, -0.06, 0.13] の正規化方向
const FOOT_REST_DIR = new THREE.Vector3(0, -0.06, 0.13).normalize();
const FOOT_CORR_Q   = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 1, 0), FOOT_REST_DIR,
);

// ─── FK: 全ボーンのワールド座標 + クォータニオンを計算 ──────────
function safeRot(rot) {
  if (!Array.isArray(rot) || rot.length < 3) return [0, 0, 0];
  return [
    Number.isFinite(+rot[0]) ? +rot[0] : 0,
    Number.isFinite(+rot[1]) ? +rot[1] : 0,
    Number.isFinite(+rot[2]) ? +rot[2] : 0,
  ];
}

function safePos(pos) {
  if (!Array.isArray(pos) || pos.length < 3) return [0, 0, 0];
  return [
    Number.isFinite(+pos[0]) ? +pos[0] : 0,
    Number.isFinite(+pos[1]) ? +pos[1] : 0,
    Number.isFinite(+pos[2]) ? +pos[2] : 0,
  ];
}

function boneLocalOffset(def, bonePos) {
  const p = safePos(bonePos?.[def.id]);
  return [
    def.offset[0] + p[0],
    def.offset[1] + p[1],
    def.offset[2] + p[2],
  ];
}

function computeFKFull(boneRot, bonePos, bodyYaw) {
  const DEG = Math.PI / 180;
  const wPos  = {};
  const wQuat = {};
  const yaw   = finiteYaw(bodyYaw, 0);
  const bodyQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw * DEG, 0));

  for (const def of BONE_DEFS) {
    const rot    = safeRot(boneRot[def.id]);
    const off    = boneLocalOffset(def, bonePos);
    const localQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, "XYZ"),
    );

    if (!def.parent) {
      wPos[def.id]  = new THREE.Vector3(...off).applyQuaternion(bodyQ);
      wQuat[def.id] = bodyQ.clone().multiply(localQ);
    } else {
      const pPos  = wPos[def.parent];
      const pQuat = wQuat[def.parent];
      wPos[def.id]  = new THREE.Vector3(...off).applyQuaternion(pQuat).add(pPos);
      wQuat[def.id] = pQuat.clone().multiply(localQ);
    }
  }
  return { worldPos: wPos, worldQuat: wQuat };
}

// ─── ステージ作成 ─────────────────────────────────────────────
export function createStage(container) {
  const W = container.clientWidth  || 440;
  const H = container.clientHeight || 560;

  // ── レンダラー ──────────────────────────────────────────
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    renderer = new THREE.WebGLRenderer({ antialias: false });
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setSize(W, H);
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;";
  container.appendChild(renderer.domElement);

  // ── シーン / カメラ / ライト ────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);
  scene.fog        = new THREE.Fog(0x0a0a0a, 10, 24);

  const camera   = new THREE.PerspectiveCamera(40, W / H, 0.1, 50);
  const CAM_LOOK = new THREE.Vector3(0, 0.75, 0);
  let   camTheta = 0;
  let   camPhi   = 0.10;
  const CAM_R    = 5.8;

  function posCamera() {
    camera.position.set(
      CAM_R * Math.sin(camTheta) * Math.cos(camPhi),
      CAM_LOOK.y + CAM_R * Math.sin(camPhi),
      CAM_R * Math.cos(camTheta) * Math.cos(camPhi),
    );
    camera.lookAt(CAM_LOOK);
  }
  posCamera();

  scene.add(new THREE.AmbientLight(0xfff8e8, 0.40));
  const keyLight = new THREE.DirectionalLight(0xfff8f0, 2.0);
  keyLight.position.set(2.5, 5, 3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -3; keyLight.shadow.camera.right  =  3;
  keyLight.shadow.camera.top  =  4; keyLight.shadow.camera.bottom = -2;
  keyLight.shadow.camera.near = 0.5; keyLight.shadow.camera.far   = 20;
  keyLight.shadow.bias = -0.003;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xd0e4ff, 0.40);
  fillLight.position.set(-3, 2, 1);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xffbf00, 0.50);
  rimLight.position.set(0.5, 0.5, -4);
  scene.add(rimLight);

  // ── フロア ──────────────────────────────────────────────
  const floorMesh = new THREE.Mesh(
    new THREE.CircleGeometry(4, 64),
    new THREE.MeshStandardMaterial({ color: 0x111009, roughness: 0.95, metalness: 0.05 }),
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -1.0;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  const grid = new THREE.GridHelper(6, 20, 0x2a2510, 0x1a160a);
  grid.position.y = -0.99;
  scene.add(grid);

  // ── 共通マテリアル ──────────────────────────────────────
  const mBase = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.50, metalness: 0.08 });
  const mSel  = new THREE.MeshStandardMaterial({
    color: 0xffbf00, emissive: new THREE.Color(0xffbf00), emissiveIntensity: 0.55,
    roughness: 0.25, metalness: 0.20,
  });
  const mBone = new THREE.MeshStandardMaterial({ color: 0x787060, roughness: 0.72, metalness: 0.05 });

  // ── 手のひらメッシュ用マテリアル ─────────────────────────
  // BoxGeometry 面インデックス: 0=+X, 1=-X, 2=+Y(指先), 3=-Y(手根), 4=+Z(手のひら), 5=-Z(手の甲)
  // HAND_CORR_Q（Rz 180°）適用後: +Z→+Z（カメラ向き）, +Y→-Y（下向き）, +X→-X
  const mHandSide = new THREE.MeshStandardMaterial({ color: 0xbcad9e, roughness: 0.52 });
  const mHandPalm = new THREE.MeshStandardMaterial({ color: 0xffd3b0, roughness: 0.70, metalness: 0.01 });
  const mHandBack = new THREE.MeshStandardMaterial({ color: 0x9a8c80, roughness: 0.48 });
  const mHandTip  = new THREE.MeshStandardMaterial({
    color: 0xffbf00, roughness: 0.45,
    emissive: new THREE.Color(0x332000), emissiveIntensity: 0.25,
  });
  const mHandRoot = new THREE.MeshStandardMaterial({ color: 0xafa090, roughness: 0.55 });
  // [+X側, -X側, +Y指先, -Y手根, +Z手のひら, -Z手の甲]
  const handMats = () => [mHandSide, mHandSide, mHandTip, mHandRoot, mHandPalm, mHandBack].map(m => m.clone());

  // ── 足メッシュ用マテリアル ───────────────────────────────
  // 足 BoxGeometry: setFromUnitVectors(UP, footDir) で向きを決める
  // +Z face（前方）= つま先, -Y face（下面）= 足の裏（ほぼ）
  const mFootSole = new THREE.MeshStandardMaterial({ color: 0xe0c8b0, roughness: 0.72 });
  const mFootTop  = new THREE.MeshStandardMaterial({ color: 0x9c8e82, roughness: 0.50 });
  const mFootSide = new THREE.MeshStandardMaterial({ color: 0xaaa090, roughness: 0.55 });
  // [+X, -X, +Y(上面=足の甲), -Y(下面=足の裏), +Z(つま先), -Z(かかと)]
  const footMats = () => [mFootSide, mFootSide, mFootTop, mFootSole, mFootSide, mFootSide].map(m => m.clone());

  // ── アバターグループ（原点基準で scene に追加） ──────────────
  const avatarGroup = new THREE.Group();
  scene.add(avatarGroup);

  // ── 関節球 ──────────────────────────────────────────────
  const jointMeshes = {};
  const UP = new THREE.Vector3(0, 1, 0);

  // 通常関節（球）— 視覚サイズは元のまま
  for (const def of BONE_DEFS) {
    if (def.id.startsWith("hand") || def.id.startsWith("foot")) continue;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.r, 16, 12), mBase.clone());
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.boneId = def.id;
    avatarGroup.add(mesh);
    jointMeshes[def.id] = mesh;
  }

  // ── ヒットゾーン（不可視・クリック判定専用） ──
  // 末端ほど小さく、重なりを減らして意図した関節だけ選ばせる
  const HIT_ZONE_SCALE = {
    shldrL: 1.7, shldrR: 1.7, hipL: 1.7, hipR: 1.7,
    elbowL: 1.55, elbowR: 1.55, kneeL: 1.55, kneeR: 1.55,
    wristL: 1.45, wristR: 1.45, ankleL: 1.45, ankleR: 1.45,
    handL: 1.35, handR: 1.35, footL: 1.35, footR: 1.35,
  };
  const hitZoneMeshes = {};
  for (const def of BONE_DEFS) {
    const scale = HIT_ZONE_SCALE[def.id] ?? 1.6;
    const hitR  = Math.max(def.r * scale, 0.10);
    const hm   = new THREE.Mesh(
      new THREE.SphereGeometry(hitR, 6, 4),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hm.userData.boneId = def.id;
    avatarGroup.add(hm);
    hitZoneMeshes[def.id] = hm;
  }

  // 手のひら（マルチマテリアル Box: W×L×Th, +Z = 手のひら）
  for (const id of ["handL", "handR"]) {
    const r    = BONE_DEFS_MAP[id].r;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(r * 3.2, r * 3.5, r * 1.0),
      handMats(),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.boneId = id;
    avatarGroup.add(mesh);
    jointMeshes[id] = mesh;
  }

  // 足（マルチマテリアル Box: W×H×L）
  for (const id of ["footL", "footR"]) {
    const r    = BONE_DEFS_MAP[id].r;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(r * 2.8, r * 0.75, r * 4.8),
      footMats(),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.boneId = id;
    avatarGroup.add(mesh);
    jointMeshes[id] = mesh;
  }

  // ── 親指メッシュ（手のひらの脇に突出する目印） ────────────
  // 手骨空間での親指オフセット:
  //   worldQuat = identity のとき、右手は +X 方向が体中心（内側）
  //   右手: thumbLocalX = +r*2.0（内側）、左手: -r*2.0（内側）
  //   HAND_CORR_Q は Rz(180°) で +X→-X に反転するため、
  //   mesh 上の配置では -X local ≡ 内側となるが、
  //   別 Mesh として world 空間に独立配置するので bone 空間で計算する。
  const thumbMeshes = {};
  for (const id of ["handL", "handR"]) {
    const r     = BONE_DEFS_MAP[id].r;
    const thumb = new THREE.Mesh(
      new THREE.CapsuleGeometry(r * 0.46, r * 0.82, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xc8aa8a, roughness: 0.60 }),
    );
    thumb.castShadow = true;
    avatarGroup.add(thumb);
    thumbMeshes[id] = thumb;
  }

  // ── 選択表示スフィア（すべての関節に対応） ──────────────
  const selRing = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffbf00, emissive: new THREE.Color(0xffbf00), emissiveIntensity: 1.2,
      transparent: true, opacity: 0.50, depthWrite: false,
    }),
  );
  selRing.visible = false;
  avatarGroup.add(selRing);

  // ── 鼻インジケーター ────────────────────────────────────
  const noseMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.034, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xffbf00, emissive: new THREE.Color(0xffbf00), emissiveIntensity: 0.45,
    }),
  );
  avatarGroup.add(noseMesh);

  // ── 骨シリンダー ────────────────────────────────────────
  const BONE_PAIRS = BONE_DEFS.filter(d => d.parent).map(d => [d.parent, d.id]);
  const boneMeshes = {};
  for (const [a, b] of BONE_PAIRS) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.030, 0.022, 1, 9),
      mBone.clone(),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    boneMeshes[`${a}__${b}`] = mesh;
    avatarGroup.add(mesh);
  }

  // ── ボーンスケール管理 ───────────────────────────────────
  let _armScale = 1, _legScale = 1;
  function applyBoneScale(armScale, legScale) {
    const safe = sanitizeBoneScale({ armScale, legScale });
    armScale = safe.armScale;
    legScale = safe.legScale;
    if (armScale === _armScale && legScale === _legScale) return;
    _armScale = armScale; _legScale = legScale;
    const armIds = ["elbowL","wristL","handL","elbowR","wristR","handR"];
    const legIds = ["kneeL","ankleL","footL","kneeR","ankleR","footR"];
    for (const id of armIds) {
      const b = BASE_OFFSETS[id];
      BONE_DEFS_MAP[id].offset = [b[0]*armScale, b[1]*armScale, b[2]*armScale];
    }
    for (const id of legIds) {
      const b = BASE_OFFSETS[id];
      BONE_DEFS_MAP[id].offset = [b[0]*legScale, b[1]*legScale, b[2]*legScale];
    }
  }

  // ── ビジュアル更新 ──────────────────────────────────────
  const tmpDir = new THREE.Vector3();
  const tmpMid = new THREE.Vector3();
  const tmpA   = new THREE.Vector3();
  const tmpB   = new THREE.Vector3();

  function updateVisuals(worldPos, worldQuat, selectedBoneId, headWorldQuat) {
    for (const def of BONE_DEFS) {
      const pos = worldPos[def.id];
      if (!pos || !Number.isFinite(pos.x)) continue;
      const mesh = jointMeshes[def.id];
      if (!mesh) continue;

      mesh.position.copy(pos);

      const isHand = def.id.startsWith("hand");
      const isFoot = def.id.startsWith("foot");

      if (isHand) {
        // worldQuat（wrist の外旋・屈曲を含む）+ 補正クォータニオン で向きを決める
        const wq = worldQuat[def.id];
        if (wq) mesh.quaternion.copy(wq).multiply(HAND_CORR_Q);
      } else if (isFoot) {
        // foot は ankle の Z 回転が offset 方向を変えるので setFromUnitVectors でも追従する
        const wq = worldQuat[def.id];
        if (wq) mesh.quaternion.copy(wq).multiply(FOOT_CORR_Q);
      }

      // 選択以外のマテリアルは通常 mBase（手/足は個別マテリアルなのでスキップ）
      if (!isHand && !isFoot) {
        mesh.material = def.id === selectedBoneId ? mSel : mBase;
      }
    }

    // 選択リング（全関節共通）
    if (selectedBoneId && worldPos[selectedBoneId]) {
      const r = BONE_DEFS_MAP[selectedBoneId]?.r ?? 0.065;
      selRing.scale.setScalar(r / 0.065);
      selRing.position.copy(worldPos[selectedBoneId]);
      selRing.visible = true;
    } else {
      selRing.visible = false;
    }

    // 親指メッシュ更新
    for (const id of ["handL", "handR"]) {
      const pos = worldPos[id];
      const wq  = worldQuat[id];
      if (!pos || !wq) { thumbMeshes[id].visible = false; continue; }
      thumbMeshes[id].visible = true;

      const side = id === "handR" ? "R" : "L";
      const r    = BONE_DEFS_MAP[id].r;

      // 骨ローカル空間での親指オフセット（worldQuat=identity のとき世界 X 軸と一致）
      // 右手の内側（体中心方向）= -X world（右腕は +X 側）
      // 左手の内側（体中心方向）= +X world（左腕は -X 側）
      const thumbX   = side === "R" ? -(r * 2.1) : (r * 2.1);
      const localOff = new THREE.Vector3(thumbX, -(r * 0.6), 0);
      localOff.applyQuaternion(wq);
      thumbMeshes[id].position.copy(pos).add(localOff);

      // 親指の向き: worldQuat に Z 方向傾き（左右対称）を追加
      const tiltEuler = new THREE.Euler(0, 0, side === "R" ? 0.55 : -0.55);
      thumbMeshes[id].quaternion.copy(wq)
        .multiply(HAND_CORR_Q)
        .multiply(new THREE.Quaternion().setFromEuler(tiltEuler));
    }

    // ヒットゾーン位置を視覚スフィアと同期
    for (const def of BONE_DEFS) {
      const pos = worldPos[def.id];
      const hm  = hitZoneMeshes[def.id];
      if (pos && hm && Number.isFinite(pos.x)) hm.position.copy(pos);
    }

    // 鼻インジケーター
    if (headWorldQuat && worldPos.head) {
      const fwd = new THREE.Vector3(0, 0, 0.135).applyQuaternion(headWorldQuat);
      noseMesh.position.copy(worldPos.head).add(fwd);
      noseMesh.visible = true;
    } else {
      noseMesh.visible = false;
    }

    // 骨シリンダー
    for (const [a, b] of BONE_PAIRS) {
      const pa = worldPos[a]; const pb = worldPos[b];
      if (!pa || !pb) continue;
      tmpA.copy(pa); tmpB.copy(pb);
      tmpDir.subVectors(tmpB, tmpA);
      const len  = tmpDir.length();
      const mesh = boneMeshes[`${a}__${b}`];
      if (!mesh) continue;
      if (len < 0.005) { mesh.visible = false; continue; }
      mesh.visible = true;
      tmpMid.addVectors(tmpA, tmpB).multiplyScalar(0.5);
      mesh.position.copy(tmpMid);
      mesh.scale.y = len;
      mesh.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
    }
  }

  // ── 公開 API ────────────────────────────────────────────

  let _lastWorldPos = null;

  function getBoneScreenPos(boneId) {
    if (!_lastWorldPos?.[boneId]) return null;
    const v = _lastWorldPos[boneId].clone();
    v.project(camera);
    return {
      x: (v.x + 1) / 2 * renderer.domElement.clientWidth,
      y: (-v.y + 1) / 2 * renderer.domElement.clientHeight,
    };
  }

  // ── 粘土細工ドラッグ（平行移動 + 回転・制限なし） ─────────────
  const raycaster = new THREE.Raycaster();
  function toNDC(nx, ny) { return new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)); }

  const ROT_SENS   = 0.52;
  const TRANS_SENS = 0.00075;
  const MAX_PIX_STEP = 48;
  // applyClayTranslate 内でも POS_BONES を参照
  const _tmpDelta  = new THREE.Vector3();
  const _tmpLocal  = new THREE.Vector3();
  const _tmpCamR   = new THREE.Vector3();
  const _tmpCamU   = new THREE.Vector3();
  const _tmpParentQ = new THREE.Quaternion();

  /** 画面上のドラッグ → 親ローカル空間での位置オフセット増分 */
  function applyClayTranslate(boneId, movX, movY, boneRot, bonePos, bodyYaw) {
    if (!POS_BONES.has(boneId)) return {};
    if (Math.abs(movX) < 0.3 && Math.abs(movY) < 0.3) return {};
    const DEG = Math.PI / 180;
    const { worldPos, worldQuat } = computeFKFull(boneRot, bonePos, bodyYaw);
    const anchor = worldPos[boneId];
    if (!anchor) return {};

    const depth = Math.max(0.5, anchor.distanceTo(camera.position));
    const scale = depth * TRANS_SENS;
    // 肩は縦ドラッグを位置、横を少しだけ位置に反映
    const ty = boneId.startsWith("shldr") ? movY : movY * 0.55;
    const tx = boneId.startsWith("shldr") ? movX * 0.25 : movX * 0.45;

    _tmpCamR.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _tmpCamU.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _tmpDelta.set(0, 0, 0)
      .addScaledVector(_tmpCamR, tx * scale)
      .addScaledVector(_tmpCamU, -ty * scale);

    const parentId = BONE_DEFS_MAP[boneId]?.parent;
    if (parentId) {
      _tmpParentQ.copy(worldQuat[parentId] ?? new THREE.Quaternion());
    } else {
      _tmpParentQ.setFromEuler(new THREE.Euler(0, finiteYaw(bodyYaw, 0) * DEG, 0));
    }
    _tmpLocal.copy(_tmpDelta).applyQuaternion(_tmpParentQ.invert());

    const cur = safePos(bonePos?.[boneId]);
    return {
      [boneId]: clampBonePos(boneId, [
        cur[0] + _tmpLocal.x,
        cur[1] + _tmpLocal.y,
        cur[2] + _tmpLocal.z,
      ]),
    };
  }

  /** 画面上のドラッグ → カメラ空間回転（制限なし） */
  function applyClayRotate(boneId, movX, movY, boneRot, bonePos, bodyYaw) {
    if (Math.abs(movX) < 0.3 && Math.abs(movY) < 0.3) return {};
    const DEG = Math.PI / 180;

    _tmpCamR.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _tmpCamU.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const rotAxis = new THREE.Vector3()
      .addScaledVector(_tmpCamU,    movX)
      .addScaledVector(_tmpCamR, -movY);
    if (rotAxis.lengthSq() < 0.001) return {};
    rotAxis.normalize();

    const dist    = Math.sqrt(movX * movX + movY * movY);
    const angle   = Math.min(dist * ROT_SENS * DEG, 14 * DEG);
    const worldRotQ = new THREE.Quaternion().setFromAxisAngle(rotAxis, angle);

    const { worldQuat } = computeFKFull(boneRot, bonePos, bodyYaw);
    const parentId   = BONE_DEFS_MAP[boneId]?.parent;
    const parentQuat = parentId
      ? (worldQuat[parentId] ?? new THREE.Quaternion())
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, finiteYaw(bodyYaw, 0) * DEG, 0));

    const curRot    = safeRot(boneRot[boneId]);
    const curLocalQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(curRot[0] * DEG, curRot[1] * DEG, curRot[2] * DEG),
    );
    const curWorldQ = parentQuat.clone().multiply(curLocalQ);
    const newWorldQ = worldRotQ.clone().multiply(curWorldQ);
    const newLocalQ = parentQuat.clone().invert().multiply(newWorldQ);
    const euler     = new THREE.Euler().setFromQuaternion(newLocalQ, "XYZ");

    return {
      [boneId]: clampBoneRot(boneId, [euler.x / DEG, euler.y / DEG, euler.z / DEG]),
    };
  }

  /**
   * 粘土細工ドラッグ
   *   肩/腰/首 → 位置 + 回転（肩すくめ等）
   *   肘/膝/手首等 → 回転のみ（伸び防止）
   */
  function solveJointDrag(boneId, _normX, _normY, movX, movY, boneRot, bonePos, bodyYaw) {
    const dist = Math.hypot(movX, movY);
    if (dist > MAX_PIX_STEP) {
      const s = MAX_PIX_STEP / dist;
      movX *= s;
      movY *= s;
    }
    const pos = bonePos ?? {};
    const posUp = applyClayTranslate(boneId, movX, movY, boneRot, pos, bodyYaw);
    const rotUp = applyClayRotate(boneId, movX, movY, boneRot, pos, bodyYaw);
    return { boneRot: rotUp, bonePos: posUp };
  }

  // ── render ──────────────────────────────────────────────
  let _lastBoneRot = sanitizeBoneRot({});
  let _lastBonePos = sanitizeBonePos({});
  let _lastOpts     = {};

  function render(boneRot = {}, opts = {}) {
    const {
      bodyYaw = 0, headYaw = 0, selectedBoneId = null,
      boneScale = {}, bonePos = {},
    } = opts;
    const safeScale = sanitizeBoneScale(boneScale);
    const safeBodyYaw = finiteYaw(bodyYaw, 0);
    const safeHeadYaw = finiteYaw(headYaw, 0);
    applyBoneScale(safeScale.armScale, safeScale.legScale);

    _lastBoneRot = sanitizeBoneRot(boneRot);
    _lastBonePos = sanitizeBonePos(bonePos);
    _lastOpts      = {
      bodyYaw: safeBodyYaw,
      headYaw: safeHeadYaw,
      selectedBoneId,
      boneScale: safeScale,
      bonePos: _lastBonePos,
    };

    const eff = { ..._lastBoneRot };
    const headRot = eff.head ? [...eff.head] : [0, 0, 0];
    headRot[1]    = headRot[1] - safeHeadYaw;
    eff.head      = headRot;

    const { worldPos, worldQuat } = computeFKFull(eff, _lastBonePos, safeBodyYaw);
    _lastWorldPos = worldPos;

    updateVisuals(worldPos, worldQuat, selectedBoneId, worldQuat.head ?? null);
    try {
      renderer.render(scene, camera);
    } catch (e) {
      console.error("WebGL render failed:", e);
    }
  }

  // 初回表示（REST ポーズ）— レイアウト未確定でも最低サイズで描画
  render({});
  requestAnimationFrame(() => {
    const w = container.clientWidth  || W;
    const h = container.clientHeight || H;
    if (w >= 1 && h >= 1) resize(w, h);
  });

  function hitTestJoint(normX, normY) {
    raycaster.setFromCamera(toNDC(normX, normY), camera);
    const hits = raycaster.intersectObjects(Object.values(hitZoneMeshes), false);
    if (!hits.length) return null;
    // カメラに最も近い関節を優先（重なり時に意図した関節を選ぶ）
    hits.sort((a, b) => a.distance - b.distance);
    return hits[0].object.userData.boneId;
  }

  let orbitLast = { x: 0, y: 0 };
  function orbitStart(nx, ny)  { orbitLast = { x: nx, y: ny }; }
  function orbitMove(nx, ny) {
    camTheta -= (nx - orbitLast.x) * 3.0;
    camPhi    = Math.max(-0.28, Math.min(1.15, camPhi + (ny - orbitLast.y) * 1.6));
    orbitLast = { x: nx, y: ny };
    posCamera();
    render(_lastBoneRot, _lastOpts);
  }
  function orbitEnd() {}

  function resize(w, h) {
    if (w < 1 || h < 1) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render(_lastBoneRot, _lastOpts);
  }

  function dispose() {
    renderer.dispose();
    renderer.domElement?.parentNode?.removeChild(renderer.domElement);
  }

  return {
    render, hitTestJoint, solveJointDrag,
    getBoneScreenPos,
    orbitStart, orbitMove, orbitEnd,
    resize, dispose,
  };
}
