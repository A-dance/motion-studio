/**
 * pose-3d.js — Three.js 3D ダンサーステージ
 *
 * 座標系: Y-up, 身長 ~2.7 units
 *   ankleL/R: y ≈ -0.95, head: y ≈ 1.75
 *
 * ポーズ形式: { jointId: [x, y, z], ... }
 * bodyYaw: figureGroup を Y 軸回転（正面←→横）
 * headYaw: headGroup を Y 軸回転 → 鼻ドットで方向表示
 */
import * as THREE from "three";

// ─── デフォルトポーズ ───────────────────────────────────
export const STAND_POSE = {
  head:   [  0,    1.75,  0  ],
  neck:   [  0,    1.50,  0  ],
  shldrL: [ -0.46, 1.40,  0  ],
  shldrR: [  0.46, 1.40,  0  ],
  elbowL: [ -0.54, 0.90,  0  ],
  elbowR: [  0.54, 0.90,  0  ],
  wristL: [ -0.54, 0.40,  0  ],
  wristR: [  0.54, 0.40,  0  ],
  hip:    [  0,    0.84,  0  ],
  hipL:   [ -0.22, 0.72,  0  ],
  hipR:   [  0.22, 0.72,  0  ],
  kneeL:  [ -0.22, 0.00,  0  ],
  kneeR:  [  0.22, 0.00,  0  ],
  ankleL: [ -0.22, -0.95, 0  ],
  ankleR: [  0.22, -0.95, 0  ],
};

export function clonePose(p) {
  const r = {};
  for (const [k, v] of Object.entries(p)) r[k] = [...v];
  return r;
}

// ─── スケルトン定義 ──────────────────────────────────────
const JOINT_DEFS = [
  { id: "head",   r: 0.125 },
  { id: "neck",   r: 0.052 },
  { id: "shldrL", r: 0.088 }, { id: "shldrR", r: 0.088 },
  { id: "elbowL", r: 0.065 }, { id: "elbowR", r: 0.065 },
  { id: "wristL", r: 0.055 }, { id: "wristR", r: 0.055 },
  { id: "hip",    r: 0.095 },
  { id: "hipL",   r: 0.080 }, { id: "hipR",   r: 0.080 },
  { id: "kneeL",  r: 0.073 }, { id: "kneeR",  r: 0.073 },
  { id: "ankleL", r: 0.055 }, { id: "ankleR", r: 0.055 },
];

const BONE_PAIRS = [
  ["head",   "neck"],
  ["neck",   "shldrL"], ["neck",   "shldrR"],
  ["neck",   "hip"],                            // 脊柱
  ["shldrL", "elbowL"], ["elbowL", "wristL"],
  ["shldrR", "elbowR"], ["elbowR", "wristR"],
  ["hip",    "hipL"],   ["hip",    "hipR"],
  ["hipL",   "kneeL"],  ["kneeL",  "ankleL"],
  ["hipR",   "kneeR"],  ["kneeR",  "ankleR"],
];

// ─── ステージ作成 ────────────────────────────────────────
export function createStage(container) {
  const W = container.clientWidth  || 440;
  const H = container.clientHeight || 560;

  // ── レンダラー ──────────────────────────────────────
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

  // ── シーン ──────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x181410);
  scene.fog        = new THREE.Fog(0x181410, 9, 22);

  // ── カメラ ──────────────────────────────────────────
  const camera    = new THREE.PerspectiveCamera(40, W / H, 0.1, 50);
  const CAM_LOOK  = new THREE.Vector3(0, 0.75, 0);
  let camTheta    = 0;
  let camPhi      = 0.10;
  const CAM_R     = 5.8;

  function posCamera() {
    camera.position.set(
      CAM_R * Math.sin(camTheta) * Math.cos(camPhi),
      CAM_LOOK.y + CAM_R * Math.sin(camPhi),
      CAM_R * Math.cos(camTheta) * Math.cos(camPhi)
    );
    camera.lookAt(CAM_LOOK);
  }
  posCamera();

  // ── ライト ──────────────────────────────────────────
  // アンビエント（柔らかい全体光）
  scene.add(new THREE.AmbientLight(0xfff0d4, 0.50));

  // メインライト（影あり）
  const key = new THREE.DirectionalLight(0xfff8f0, 1.7);
  key.position.set(2.5, 5, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left   = -3;
  key.shadow.camera.right  =  3;
  key.shadow.camera.top    =  4;
  key.shadow.camera.bottom = -2;
  key.shadow.camera.near   = 0.5;
  key.shadow.camera.far    = 20;
  key.shadow.bias          = -0.003;
  key.shadow.normalBias    = 0.02;
  scene.add(key);

  // フィルライト（左から柔らかい青白い補助光）
  const fill = new THREE.DirectionalLight(0xc8dcf8, 0.50);
  fill.position.set(-3, 2, 1);
  scene.add(fill);

  // リムライト（後方からゴールドの輪郭光）
  const rim = new THREE.DirectionalLight(0xf0c840, 0.40);
  rim.position.set(0.5, 0, -4);
  scene.add(rim);

  // ── フロア ──────────────────────────────────────────
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x1e1810, roughness: 0.90, metalness: 0.08,
  });
  const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(4, 64), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -1.0;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  // グリッドライン
  const grid = new THREE.GridHelper(6, 20, 0x4a3828, 0x38281a);
  grid.position.y = -0.99;
  scene.add(grid);

  // ── マテリアル ──────────────────────────────────────
  // 通常関節: 温かみのあるローズ
  const mBase = new THREE.MeshStandardMaterial({
    color: 0xdca8bc, roughness: 0.55, metalness: 0.10,
  });
  // 選択中: ピンク + 発光
  const mSel = new THREE.MeshStandardMaterial({
    color: 0xff90b8,
    emissive: new THREE.Color(0xff4070),
    emissiveIntensity: 0.65,
    roughness: 0.35,
    metalness: 0.15,
  });
  // 骨: 少し暗め
  const mBone = new THREE.MeshStandardMaterial({
    color: 0xb89098, roughness: 0.68, metalness: 0.06,
  });

  // ── フィギュアグループ ──────────────────────────────
  const figureGroup = new THREE.Group();
  scene.add(figureGroup);

  // 関節メッシュを作成
  const jointMeshes = {};
  for (const { id, r } of JOINT_DEFS) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      mBase.clone()
    );
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.id   = id;
    jointMeshes[id]    = mesh;
  }

  // 頭グループ（headYaw + 鼻インジケーター）
  const headGroup = new THREE.Group();
  headGroup.add(jointMeshes.head);

  const noseMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.036, 8, 6),
    new THREE.MeshStandardMaterial({
      color: 0xd06080, emissive: new THREE.Color(0xc04060), emissiveIntensity: 0.35,
    })
  );
  noseMesh.position.set(0, 0.01, 0.135); // 頭の正面に
  headGroup.add(noseMesh);
  figureGroup.add(headGroup);

  // head 以外は直接 figureGroup に追加
  for (const { id } of JOINT_DEFS) {
    if (id !== "head") figureGroup.add(jointMeshes[id]);
  }

  // 骨メッシュ
  const boneMeshes = {};
  for (const [a, b] of BONE_PAIRS) {
    // 上が細く、下が少し太い
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.026, 1, 9),
      mBone.clone()
    );
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    boneMeshes[`${a}__${b}`] = mesh;
    figureGroup.add(mesh);
  }

  // ── ヘルパー ────────────────────────────────────────
  const UP      = new THREE.Vector3(0, 1, 0);
  const tmpDir  = new THREE.Vector3();
  const tmpMid  = new THREE.Vector3();

  function getLocalPos(id) {
    // head は headGroup の位置（headGroup.position が頭の位置）
    return id === "head" ? headGroup.position : jointMeshes[id].position;
  }

  function refreshBones() {
    for (const [a, b] of BONE_PAIRS) {
      const pa   = getLocalPos(a);
      const pb   = getLocalPos(b);
      const mesh = boneMeshes[`${a}__${b}`];
      tmpDir.subVectors(pb, pa);
      const len = tmpDir.length();
      if (len < 0.005) { mesh.visible = false; continue; }
      mesh.visible = true;
      tmpMid.addVectors(pa, pb).multiplyScalar(0.5);
      mesh.position.copy(tmpMid);
      mesh.scale.y = len;
      mesh.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
    }
  }

  // ── ドラッグ / オービット ──────────────────────────
  const raycaster  = new THREE.Raycaster();
  const dragPlane  = new THREE.Plane();
  const planeHit   = new THREE.Vector3();
  const camDir     = new THREE.Vector3();

  let orbitActive = false;
  let orbitLast   = { x: 0, y: 0 };

  function toNDC(nx, ny) {
    return new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1));
  }

  // ── パブリック API ──────────────────────────────────

  /**
   * ポーズ・yaw を反映してレンダリング
   * @param {Object} pose  - { jointId: [x,y,z] }
   * @param {Object} opts  - { bodyYaw, headYaw, selectedJoint }
   */
  function render(pose, opts = {}) {
    const { bodyYaw = 0, headYaw = 0, selectedJoint: sel = null } = opts;

    figureGroup.rotation.y = (bodyYaw * Math.PI) / 180;
    headGroup.rotation.y   = -(headYaw * Math.PI) / 180;

    for (const { id } of JOINT_DEFS) {
      const pos = pose[id];
      if (!pos) continue;
      if (id === "head") {
        headGroup.position.set(pos[0], pos[1], pos[2]);
      } else {
        jointMeshes[id].position.set(pos[0], pos[1], pos[2]);
      }
      // 選択中マテリアル
      jointMeshes[id].material = sel === id ? mSel : mBase;
    }

    refreshBones();
    renderer.render(scene, camera);
  }

  /**
   * 画面上 (normX, normY) が関節にヒットするか判定
   * @returns {string|null} jointId or null
   */
  function hitTestJoint(normX, normY) {
    raycaster.setFromCamera(toNDC(normX, normY), camera);
    const meshList = Object.values(jointMeshes); // head sphere も含まれる
    const hits = raycaster.intersectObjects(meshList, false);
    return hits.length > 0 ? hits[0].object.userData.id : null;
  }

  /**
   * ドラッグ中の関節の新しいローカル座標を返す
   * @param {string} jointId - ドラッグ中の関節 ID
   * @param {number} normX, normY - 現在のマウス位置 (0-1)
   * @returns {[number,number,number]|null}
   */
  function getDraggedPos(jointId, normX, normY) {
    // 関節のワールド位置を取得
    const anchor = jointId === "head" ? headGroup : jointMeshes[jointId];
    const worldPos = new THREE.Vector3();
    anchor.getWorldPosition(worldPos);

    // カメラ向き法線の平面（ドラッグ平面）を設定
    camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, worldPos);

    raycaster.setFromCamera(toNDC(normX, normY), camera);
    if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return null;

    // ワールド座標 → figureGroup ローカル座標に変換
    const local = figureGroup.worldToLocal(planeHit.clone());
    return [local.x, local.y, local.z];
  }

  /** カメラオービット開始 */
  function orbitStart(normX, normY) {
    orbitActive = true;
    orbitLast   = { x: normX, y: normY };
  }

  /** カメラオービット移動 */
  function orbitMove(normX, normY) {
    if (!orbitActive) return;
    const dx = normX - orbitLast.x;
    const dy = normY - orbitLast.y;
    camTheta -= dx * 3.0;
    camPhi    = Math.max(-0.28, Math.min(1.15, camPhi + dy * 1.6));
    orbitLast = { x: normX, y: normY };
    posCamera();
    renderer.render(scene, camera);
  }

  /** カメラオービット終了 */
  function orbitEnd() { orbitActive = false; }

  /** レンダラーリサイズ */
  function resize(w, h) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  /** クリーンアップ */
  function dispose() {
    renderer.dispose();
    renderer.domElement?.parentNode?.removeChild(renderer.domElement);
  }

  return { render, hitTestJoint, getDraggedPos, orbitStart, orbitMove, orbitEnd, resize, dispose };
}
