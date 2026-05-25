/**
 * pose-3d.js — 回転ベース FK ダンサーステージ
 *
 * FK は Three.js ボーン行列ではなく、独自クォータニオン計算で実装。
 * ポーズ形式: { boneId: [pitchX, yawY, rollZ] }（度数）
 *
 * 操作: 関節をクリック → ギズモリング（X:赤 / Y:緑 / Z:青）が表示
 *       リングをドラッグ → その軸で回転
 */
import * as THREE from "three";

// ─── ボーン定義 ─────────────────────────────────────────────
// offset: 親ボーンからの相対オフセット（立ちポーズ / 全回転ゼロ時）
export const BONE_DEFS = [
  { id: "hip",    parent: null,     offset: [0,      0.84,   0    ], r: 0.095, label: "腰" },
  { id: "neck",   parent: "hip",    offset: [0,      0.66,   0    ], r: 0.055, label: "首" },
  { id: "head",   parent: "neck",   offset: [0,      0.25,   0    ], r: 0.125, label: "頭" },
  { id: "shldrL", parent: "neck",   offset: [-0.46, -0.10,   0    ], r: 0.088, label: "左肩" },
  { id: "elbowL", parent: "shldrL", offset: [-0.08, -0.50,   0    ], r: 0.065, label: "左肘" },
  { id: "wristL", parent: "elbowL", offset: [0,     -0.50,   0    ], r: 0.058, label: "左手首" },
  { id: "handL",  parent: "wristL", offset: [0,     -0.18,   0    ], r: 0.048, label: "左手" },
  { id: "shldrR", parent: "neck",   offset: [0.46,  -0.10,   0    ], r: 0.088, label: "右肩" },
  { id: "elbowR", parent: "shldrR", offset: [0.08,  -0.50,   0    ], r: 0.065, label: "右肘" },
  { id: "wristR", parent: "elbowR", offset: [0,     -0.50,   0    ], r: 0.058, label: "右手首" },
  { id: "handR",  parent: "wristR", offset: [0,     -0.18,   0    ], r: 0.048, label: "右手" },
  { id: "hipL",   parent: "hip",    offset: [-0.22, -0.12,   0    ], r: 0.080, label: "左股" },
  { id: "kneeL",  parent: "hipL",   offset: [0,     -0.72,   0    ], r: 0.073, label: "左膝" },
  { id: "ankleL", parent: "kneeL",  offset: [0,     -0.93,   0    ], r: 0.058, label: "左足首" },
  { id: "footL",  parent: "ankleL", offset: [0,     -0.06,   0.13 ], r: 0.044, label: "左足" },
  { id: "hipR",   parent: "hip",    offset: [0.22,  -0.12,   0    ], r: 0.080, label: "右股" },
  { id: "kneeR",  parent: "hipR",   offset: [0,     -0.72,   0    ], r: 0.073, label: "右膝" },
  { id: "ankleR", parent: "kneeR",  offset: [0,     -0.93,   0    ], r: 0.058, label: "右足首" },
  { id: "footR",  parent: "ankleR", offset: [0,     -0.06,   0.13 ], r: 0.044, label: "右足" },
];

export const BONE_LABELS = Object.fromEntries(BONE_DEFS.map(d => [d.id, d.label]));
export const REST_POSE   = Object.fromEntries(BONE_DEFS.map(d => [d.id, [0, 0, 0]]));

export function cloneBoneRot(br) {
  const r = {};
  for (const [k, v] of Object.entries(br)) r[k] = [...v];
  return r;
}

export const BONE_LIMITS = {
  hip:    { x:[-40,  40], y:[-60,  60], z:[-35,  35] },
  neck:   { x:[-60,  60], y:[-90,  90], z:[-50,  50] },
  head:   { x:[-35,  35], y:[-75,  75], z:[-35,  35] },
  shldrL: { x:[-90, 180], y:[-100,100], z:[-90,  90] },
  shldrR: { x:[-90, 180], y:[-100,100], z:[-90,  90] },
  elbowL: { x:[-10,  10], y:[-10,  10], z:[-150,  5] },
  elbowR: { x:[-10,  10], y:[-10,  10], z:[-5,  150] },
  wristL: { x:[-85,  85], y:[-90,  90], z:[-75,  75] },
  wristR: { x:[-85,  85], y:[-90,  90], z:[-75,  75] },
  handL:  { x:[-65,  65], y:[-65,  65], z:[-45,  45] },
  handR:  { x:[-65,  65], y:[-65,  65], z:[-45,  45] },
  hipL:   { x:[-130, 45], y:[-55,  55], z:[-65,  65] },
  hipR:   { x:[-130, 45], y:[-55,  55], z:[-65,  65] },
  kneeL:  { x:[0,   155], y:[-20,  20], z:[-15,  15] },
  kneeR:  { x:[0,   155], y:[-20,  20], z:[-15,  15] },
  ankleL: { x:[-50,  55], y:[-35,  35], z:[-40,  40] },
  ankleR: { x:[-50,  55], y:[-35,  35], z:[-40,  40] },
  footL:  { x:[-25,  35], y:[-35,  35], z:[-25,  25] },
  footR:  { x:[-25,  35], y:[-35,  35], z:[-25,  25] },
};

export function clampBoneRot(boneId, rot) {
  const lim = BONE_LIMITS[boneId];
  if (!lim) return rot;
  return [
    Math.max(lim.x[0], Math.min(lim.x[1], rot[0])),
    Math.max(lim.y[0], Math.min(lim.y[1], rot[1])),
    Math.max(lim.z[0], Math.min(lim.z[1], rot[2])),
  ];
}

// ─── FK: 全ボーンのワールド座標を計算 ────────────────────────
// BONE_DEFS は「親が先、子が後」の順になっている → 単純ループで OK
const _tmpQ  = new THREE.Quaternion();
const _tmpE  = new THREE.Euler();
const _tmpV  = new THREE.Vector3();

/**
 * boneRot と bodyYaw からすべてのボーンのワールド座標を返す。
 * Three.js ボーン行列は使わず、クォータニオン数学で直接計算。
 *
 * @param {Object} boneRot - { boneId: [rx,ry,rz] } 度数
 * @param {number} bodyYaw - 全体回転（度数）
 * @returns {{ [boneId]: THREE.Vector3 }}
 */
function computeFK(boneRot, bodyYaw) {
  const DEG = Math.PI / 180;
  const wPos  = {};  // ワールド位置
  const wQuat = {};  // ワールド回転（累積）

  // 全体の body yaw クォータニオン
  const bodyQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw * DEG, 0));

  for (const def of BONE_DEFS) {
    const rot = boneRot[def.id] ?? [0, 0, 0];
    _tmpE.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG);
    const localQ = new THREE.Quaternion().setFromEuler(_tmpE);

    if (!def.parent) {
      // ルートボーン (hip): bodyQ 込みでオフセットを適用
      _tmpV.set(...def.offset).applyQuaternion(bodyQ);
      wPos[def.id]  = new THREE.Vector3().copy(_tmpV);
      wQuat[def.id] = bodyQ.clone().multiply(localQ);
    } else {
      const pPos  = wPos[def.parent];
      const pQuat = wQuat[def.parent];
      _tmpV.set(...def.offset).applyQuaternion(pQuat);
      wPos[def.id]  = new THREE.Vector3().addVectors(pPos, _tmpV);
      wQuat[def.id] = pQuat.clone().multiply(localQ);
    }
  }

  return wPos;
}

// ─── ステージ作成 ─────────────────────────────────────────────
export function createStage(container) {
  const W = container.clientWidth  || 440;
  const H = container.clientHeight || 560;

  // ── レンダラー ──────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setSize(W, H);
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;";
  container.appendChild(renderer.domElement);

  // ── シーン ──────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x181410);
  scene.fog        = new THREE.Fog(0x181410, 9, 22);

  // ── カメラ ──────────────────────────────────────────────
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

  // ── ライト ──────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xfff0d4, 0.55));

  const keyLight = new THREE.DirectionalLight(0xfff8f0, 1.7);
  keyLight.position.set(2.5, 5, 3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left   = -3; keyLight.shadow.camera.right  =  3;
  keyLight.shadow.camera.top    =  4; keyLight.shadow.camera.bottom = -2;
  keyLight.shadow.camera.near   = 0.5;
  keyLight.shadow.camera.far    = 20;
  keyLight.shadow.bias          = -0.003;
  keyLight.shadow.normalBias    = 0.02;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xc8dcf8, 0.50);
  fillLight.position.set(-3, 2, 1);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xf0c840, 0.40);
  rimLight.position.set(0.5, 0, -4);
  scene.add(rimLight);

  // ── フロア ──────────────────────────────────────────────
  const floorMesh = new THREE.Mesh(
    new THREE.CircleGeometry(4, 64),
    new THREE.MeshStandardMaterial({ color: 0x1e1810, roughness: 0.90, metalness: 0.08 }),
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -1.0;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  const grid = new THREE.GridHelper(6, 20, 0x4a3828, 0x38281a);
  grid.position.y = -0.99;
  scene.add(grid);

  // ── マテリアル ──────────────────────────────────────────
  const mBase = new THREE.MeshStandardMaterial({ color: 0xdca8bc, roughness: 0.55, metalness: 0.10 });
  const mSel  = new THREE.MeshStandardMaterial({
    color: 0xff90b8,
    emissive: new THREE.Color(0xff4070), emissiveIntensity: 0.70,
    roughness: 0.30, metalness: 0.18,
  });
  const mEnd = new THREE.MeshStandardMaterial({ color: 0xf0d060, roughness: 0.45, metalness: 0.20 });
  const mEndSel = new THREE.MeshStandardMaterial({
    color: 0xffe080,
    emissive: new THREE.Color(0xffaa00), emissiveIntensity: 0.55,
    roughness: 0.30, metalness: 0.25,
  });
  const mBone = new THREE.MeshStandardMaterial({ color: 0xb89098, roughness: 0.68, metalness: 0.06 });

  // ── 関節球メッシュ ──────────────────────────────────────
  const jointMeshes = {};
  for (const def of BONE_DEFS) {
    const isEnd = def.id.startsWith("hand") || def.id.startsWith("foot");
    const geom  = isEnd
      ? new THREE.BoxGeometry(def.r * 2.2, def.r * 1.2, def.r * 3.0)
      : new THREE.SphereGeometry(def.r, 16, 12);
    const mesh = new THREE.Mesh(geom, mBase.clone());
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.boneId = def.id;
    mesh.userData.isEnd  = isEnd;
    scene.add(mesh);
    jointMeshes[def.id] = mesh;
  }

  // 鼻インジケーター（頭の向き）
  const noseMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.036, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xd06080, emissive: new THREE.Color(0xc04060), emissiveIntensity: 0.35,
    }),
  );
  scene.add(noseMesh);

  // ── 骨シリンダーメッシュ ────────────────────────────────
  const BONE_PAIRS = BONE_DEFS.filter(d => d.parent).map(d => [d.parent, d.id]);
  const boneMeshes = {};
  for (const [a, b] of BONE_PAIRS) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.033, 0.024, 1, 9),
      mBone.clone(),
    );
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    boneMeshes[`${a}__${b}`] = mesh;
    scene.add(mesh);
  }

  // ── ギズモリング ──────────────────────────────────────────
  const GIZMO_R    = 0.27;
  const GIZMO_TUBE = 0.024;

  const gizmoGroup = new THREE.Group();
  scene.add(gizmoGroup);
  gizmoGroup.visible = false;

  function makeRing(color, rotX, rotY, axis) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(GIZMO_R, GIZMO_TUBE, 10, 64),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    if (rotX) m.rotation.x = rotX;
    if (rotY) m.rotation.y = rotY;
    m.renderOrder       = 10;
    m.userData.axis     = axis;
    return m;
  }
  const gizX = makeRing(0xff3333, 0, Math.PI / 2, "x"); // X 軸（赤・YZ 平面）
  const gizY = makeRing(0x33dd33, 0, 0,           "y"); // Y 軸（緑・XZ 平面）
  const gizZ = makeRing(0x4488ff, Math.PI / 2, 0, "z"); // Z 軸（青・XY 平面）
  gizmoGroup.add(gizX, gizY, gizZ);

  // ── ヘルパー ────────────────────────────────────────────
  const UP       = new THREE.Vector3(0, 1, 0);
  const tmpDir   = new THREE.Vector3();
  const tmpMid   = new THREE.Vector3();
  const tmpA     = new THREE.Vector3();
  const tmpB     = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();

  let orbitActive = false;
  let orbitLast   = { x: 0, y: 0 };

  function toNDC(nx, ny) { return new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)); }

  // ── ボーンスケール ──────────────────────────────────────
  // boneScale は render 時に boneRot に反映するのではなく、
  // offset を拡縮することで FK 計算前に適用する。
  // ※ 現状は computeFK を直接変更せず、scale 付き boneRot を作る。
  //    実装を単純にするため scale は offset 調整で行う。
  let _armScale = 1;
  let _legScale = 1;

  // 元オフセットを保存
  const BASE_OFFSETS = Object.fromEntries(BONE_DEFS.map(d => [d.id, [...d.offset]]));

  function applyBoneScale(armScale, legScale) {
    if (armScale === _armScale && legScale === _legScale) return;
    _armScale = armScale;
    _legScale = legScale;
    const armIds = ["elbowL","wristL","handL","elbowR","wristR","handR"];
    const legIds = ["kneeL","ankleL","footL","kneeR","ankleR","footR"];
    for (const id of armIds) {
      const b = BASE_OFFSETS[id];
      BONE_DEFS.find(d => d.id === id).offset = [b[0]*armScale, b[1]*armScale, b[2]*armScale];
    }
    for (const id of legIds) {
      const b = BASE_OFFSETS[id];
      BONE_DEFS.find(d => d.id === id).offset = [b[0]*legScale, b[1]*legScale, b[2]*legScale];
    }
  }

  // ── ビジュアル更新 ──────────────────────────────────────
  function updateVisuals(worldPos, selectedBoneId, headWorldQuat) {
    const headPos = worldPos.head;

    for (const def of BONE_DEFS) {
      const pos  = worldPos[def.id];
      if (!pos) continue;

      // 関節球の位置
      jointMeshes[def.id].position.copy(pos);

      // hand/foot はボーン方向に合わせる
      if (def.id.startsWith("hand") || def.id.startsWith("foot")) {
        const parentPos = worldPos[def.parent];
        if (parentPos) {
          tmpDir.subVectors(pos, parentPos);
          if (tmpDir.length() > 0.01) {
            jointMeshes[def.id].quaternion.setFromUnitVectors(UP, tmpDir.normalize());
          }
        }
      }

      // マテリアル（選択中は発光）
      const isSel = (def.id === selectedBoneId);
      const isEnd = def.id.startsWith("hand") || def.id.startsWith("foot");
      if (isSel)      jointMeshes[def.id].material = isEnd ? mEndSel : mSel;
      else if (isEnd) jointMeshes[def.id].material = mEnd;
      else            jointMeshes[def.id].material = mBase;
    }

    // 鼻インジケーター（頭の向きを示す）
    if (headPos && headWorldQuat) {
      const noseFwd = new THREE.Vector3(0, 0, 0.135).applyQuaternion(headWorldQuat);
      noseMesh.position.copy(headPos).add(noseFwd);
      noseMesh.visible = true;
    } else {
      noseMesh.visible = false;
    }

    // シリンダー（骨）
    for (const [a, b] of BONE_PAIRS) {
      const pa = worldPos[a];
      const pb = worldPos[b];
      if (!pa || !pb) continue;
      tmpA.copy(pa); tmpB.copy(pb);
      tmpDir.subVectors(tmpB, tmpA);
      const len = tmpDir.length();
      const mesh = boneMeshes[`${a}__${b}`];
      if (len < 0.005) { mesh.visible = false; continue; }
      mesh.visible = true;
      tmpMid.addVectors(tmpA, tmpB).multiplyScalar(0.5);
      mesh.position.copy(tmpMid);
      mesh.scale.y = len;
      mesh.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
    }

    // ギズモをボーンのワールド位置に配置
    if (selectedBoneId && worldPos[selectedBoneId]) {
      gizmoGroup.position.copy(worldPos[selectedBoneId]);
      gizmoGroup.visible = true;
    } else {
      gizmoGroup.visible = false;
    }
  }

  // ── パブリック API ──────────────────────────────────────

  /**
   * ボーン回転を適用してレンダリング
   * @param {Object} boneRot       - { boneId: [rx,ry,rz] } 度数
   * @param {Object} [opts]
   * @param {number} [opts.bodyYaw]
   * @param {number} [opts.headYaw]
   * @param {string|null} [opts.selectedBoneId]
   * @param {Object} [opts.boneScale]
   */
  function render(boneRot = {}, opts = {}) {
    const { bodyYaw = 0, headYaw = 0, selectedBoneId = null, boneScale = {} } = opts;

    // ボーンスケール適用
    const { armScale = 1, legScale = 1 } = boneScale;
    applyBoneScale(armScale, legScale);

    // headYaw を head ボーンの Y 回転に統合（コピーして変更）
    const effectiveBoneRot = Object.assign({}, boneRot);
    const headRot = effectiveBoneRot.head ? [...effectiveBoneRot.head] : [0, 0, 0];
    headRot[1] = headRot[1] - headYaw;
    effectiveBoneRot.head = headRot;

    // FK でワールド座標を計算
    const worldPos = computeFK(effectiveBoneRot, bodyYaw);

    // 頭のワールドクォータニオンを取得（鼻インジケーター用）
    // computeFK 内で計算した wQuat を使うには別途返す必要がある。
    // 簡易版: noseMesh に別途 FK を走らせず、頭の向きから direction を近似。
    const headQ = computeHeadQuat(effectiveBoneRot, bodyYaw);

    // ビジュアルを更新
    updateVisuals(worldPos, selectedBoneId, headQ);

    // レンダリング
    renderer.render(scene, camera);
  }

  /** 頭のワールドクォータニオンを返す（鼻インジケーター用） */
  function computeHeadQuat(boneRot, bodyYaw) {
    const DEG = Math.PI / 180;
    const bodyQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw * DEG, 0));
    let q = bodyQ.clone();
    // hip → neck → head の回転を累積
    const chain = ["hip", "neck", "head"];
    for (const id of chain) {
      const rot = boneRot[id] ?? [0, 0, 0];
      const lq = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rot[0]*DEG, rot[1]*DEG, rot[2]*DEG)
      );
      q = q.multiply(lq);
    }
    return q;
  }

  /**
   * 画面位置 (normX, normY) が関節球にヒットするか判定
   * @returns {string|null} boneId
   */
  function hitTestJoint(normX, normY) {
    raycaster.setFromCamera(toNDC(normX, normY), camera);
    const hits = raycaster.intersectObjects(Object.values(jointMeshes), false);
    return hits.length ? hits[0].object.userData.boneId : null;
  }

  /**
   * ギズモリングにヒットするか判定
   * @returns {"x"|"y"|"z"|null}
   */
  function hitTestGizmo(normX, normY) {
    if (!gizmoGroup.visible) return null;
    raycaster.setFromCamera(toNDC(normX, normY), camera);
    const hits = raycaster.intersectObjects([gizX, gizY, gizZ], false);
    return hits.length ? hits[0].object.userData.axis : null;
  }

  function orbitStart(nx, ny)  { orbitActive = true; orbitLast = { x: nx, y: ny }; }
  function orbitMove(nx, ny) {
    if (!orbitActive) return;
    camTheta -= (nx - orbitLast.x) * 3.0;
    camPhi    = Math.max(-0.28, Math.min(1.15, camPhi + (ny - orbitLast.y) * 1.6));
    orbitLast = { x: nx, y: ny };
    posCamera();
    renderer.render(scene, camera);
  }
  function orbitEnd() { orbitActive = false; }

  function resize(w, h) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function dispose() {
    renderer.dispose();
    renderer.domElement?.parentNode?.removeChild(renderer.domElement);
  }

  return { render, hitTestJoint, hitTestGizmo, orbitStart, orbitMove, orbitEnd, resize, dispose };
}
