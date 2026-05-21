/**
 * stage.ts — Three.js ダンサーステージ（シンプル版）
 *
 * - 影なし / AmbientLight のみ / MeshBasicMaterial フラット表示
 * - 手のひら・足先のフラット形状付き
 * - ギズモリング廃止（直感ドラッグ IK に一本化）
 */
import * as THREE from "three";
import type { Pose, StageAPI, ViewPreset } from "./types";

// ─── スケルトン ──────────────────────────────────────────
const JOINT_DEFS: { id: string; r: number; isEnd?: boolean }[] = [
  { id: "head",   r: 0.125 },
  { id: "neck",   r: 0.050 },
  { id: "shldrL", r: 0.078 }, { id: "shldrR", r: 0.078 },
  { id: "elbowL", r: 0.058 }, { id: "elbowR", r: 0.058 },
  { id: "wristL", r: 0.048 }, { id: "wristR", r: 0.048 },
  { id: "handL",  r: 0.042, isEnd: true },
  { id: "handR",  r: 0.042, isEnd: true },
  { id: "hip",    r: 0.088 },
  { id: "hipL",   r: 0.072 }, { id: "hipR",   r: 0.072 },
  { id: "kneeL",  r: 0.066 }, { id: "kneeR",  r: 0.066 },
  { id: "ankleL", r: 0.050 }, { id: "ankleR", r: 0.050 },
  { id: "footL",  r: 0.040, isEnd: true },
  { id: "footR",  r: 0.040, isEnd: true },
];

const BONE_PAIRS: [string, string][] = [
  ["head",   "neck"],
  ["neck",   "shldrL"], ["neck",  "shldrR"],
  ["neck",   "hip"],
  ["shldrL", "elbowL"], ["elbowL","wristL"], ["wristL","handL"],
  ["shldrR", "elbowR"], ["elbowR","wristR"], ["wristR","handR"],
  ["hip",    "hipL"],   ["hip",   "hipR"],
  ["hipL",   "kneeL"],  ["kneeL", "ankleL"], ["ankleL","footL"],
  ["hipR",   "kneeR"],  ["kneeR", "ankleR"], ["ankleR","footR"],
];

// ─── 頭の向きサイクル ─────────────────────────────────────
export const HEAD_YAW_CYCLE = [0, 45, 90, -90, -45] as const;
export function nextHeadYaw(current: number): number {
  const idx = HEAD_YAW_CYCLE.findIndex((v) => Math.abs(v - current) < 15);
  return HEAD_YAW_CYCLE[(idx + 1) % HEAD_YAW_CYCLE.length];
}

// ─── ステージ作成 ────────────────────────────────────────
export function createStage(container: HTMLElement): StageAPI {
  const W = container.clientWidth  || 440;
  const H = container.clientHeight || 560;

  // ── レンダラー ──────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace   = THREE.SRGBColorSpace;
  renderer.toneMapping        = THREE.NoToneMapping;
  renderer.setSize(W, H);
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;";
  container.appendChild(renderer.domElement);

  // ── シーン ──────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x131110);

  // ── カメラ ──────────────────────────────────────────
  const camera   = new THREE.PerspectiveCamera(40, W / H, 0.1, 50);
  const CAM_LOOK = new THREE.Vector3(0, 0.75, 0);
  let camTheta   = 0;
  let camPhi     = 0.10;
  const CAM_R    = 5.8;

  function posCamera() {
    camera.position.set(
      CAM_R * Math.sin(camTheta) * Math.cos(camPhi),
      CAM_LOOK.y + CAM_R * Math.sin(camPhi),
      CAM_R * Math.cos(camTheta) * Math.cos(camPhi)
    );
    camera.lookAt(CAM_LOOK);
  }
  posCamera();

  // ── 全方位均一照明（影なし） ─────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 3.8));

  // ── フロア + グリッド ────────────────────────────────
  const floorMesh = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 64),
    new THREE.MeshBasicMaterial({ color: 0x181410 })
  );
  floorMesh.rotation.x  = -Math.PI / 2;
  floorMesh.position.y  = -1.0;
  floorMesh.renderOrder = 1;
  scene.add(floorMesh);

  // 接地グロウ
  const ringMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.6, 64),
    new THREE.MeshBasicMaterial({ color: 0x4a2e18, transparent: true, opacity: 0.14, depthWrite: false })
  );
  ringMesh.rotation.x  = -Math.PI / 2;
  ringMesh.position.y  = -0.998;
  ringMesh.renderOrder = 2;
  scene.add(ringMesh);

  const grid = new THREE.GridHelper(7, 28, 0x5a3820, 0x3a1e10);
  const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const m of gridMats) {
    (m as THREE.LineBasicMaterial).transparent = true;
    (m as THREE.LineBasicMaterial).opacity     = 0.42;
    (m as THREE.LineBasicMaterial).depthWrite  = false;
  }
  grid.position.y  = -0.999;
  grid.renderOrder = 0;
  scene.add(grid);

  // ── マテリアル ──────────────────────────────────────
  const COL_JOINT = 0xdca8bc;
  const COL_SEL   = 0xff50a0;
  const COL_BONE  = 0xa07888;
  const COL_END   = 0xf0c8e0;

  function mkBasic(color: number) {
    return new THREE.MeshBasicMaterial({ color });
  }

  // ── フィギュア ──────────────────────────────────────
  const figureGroup = new THREE.Group();
  scene.add(figureGroup);

  const jointMeshes: Record<string, THREE.Mesh> = {};
  for (const { id, r, isEnd } of JOINT_DEFS) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 10),
      mkBasic(isEnd ? COL_END : COL_JOINT)
    );
    mesh.userData.id = id;
    jointMeshes[id] = mesh;
    figureGroup.add(mesh);
  }

  // 頭グループ + 鼻（headYaw回転のため分離）
  const headGroup = new THREE.Group();
  headGroup.add(jointMeshes.head);
  figureGroup.remove(jointMeshes.head);

  const noseMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.048, 10, 8),
    mkBasic(0xff3060)
  );
  noseMesh.position.set(0, 0.01, 0.145);
  noseMesh.userData.id = "_nose";
  headGroup.add(noseMesh);
  figureGroup.add(headGroup);

  // 手のひら・足先の形状メッシュ（位置を示す静的な形）
  type EndShapeInfo = { geo: THREE.BufferGeometry; mat: THREE.Material; offset: [number,number,number] };
  const endShapes: Record<string, THREE.Mesh> = {};
  const END_SHAPE_DEFS: Record<string, EndShapeInfo> = {
    handL: { geo: new THREE.BoxGeometry(0.15, 0.024, 0.20), mat: mkBasic(0xe8b8d0), offset: [0,0,0.06] },
    handR: { geo: new THREE.BoxGeometry(0.15, 0.024, 0.20), mat: mkBasic(0xe8b8d0), offset: [0,0,0.06] },
    footL: { geo: new THREE.BoxGeometry(0.09, 0.020, 0.22), mat: mkBasic(0xb0a888), offset: [0,0,0.08] },
    footR: { geo: new THREE.BoxGeometry(0.09, 0.020, 0.22), mat: mkBasic(0xb0a888), offset: [0,0,0.08] },
  };
  for (const [id, def] of Object.entries(END_SHAPE_DEFS)) {
    const mesh = new THREE.Mesh(def.geo, def.mat);
    mesh.position.set(...def.offset);
    mesh.userData.id = id;
    endShapes[id] = mesh;
    jointMeshes[id].add(mesh); // ジョイントスフィアの子として配置
  }

  // ── ボーン ───────────────────────────────────────────
  const boneMeshes: Record<string, THREE.Mesh> = {};
  for (const [a, b] of BONE_PAIRS) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.020, 1, 8),
      mkBasic(COL_BONE)
    );
    boneMeshes[`${a}__${b}`] = mesh;
    figureGroup.add(mesh);
  }

  // ── ヘルパー ────────────────────────────────────────
  const UP     = new THREE.Vector3(0, 1, 0);
  const tmpDir = new THREE.Vector3();
  const tmpMid = new THREE.Vector3();

  function getLocalPos(id: string): THREE.Vector3 {
    if (id === "head") return headGroup.position;
    return jointMeshes[id].position;
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

  // ── レイキャスト / オービット ───────────────────────
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.04 };
  const dragPlane = new THREE.Plane();
  const planeHit  = new THREE.Vector3();
  const camDir    = new THREE.Vector3();
  let orbitActive = false;
  let orbitLast   = { x: 0, y: 0 };

  function toNDC(nx: number, ny: number) {
    return new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1));
  }

  // ── API ──────────────────────────────────────────────

  function render(
    pose: Pose,
    opts: { bodyYaw?: number; headYaw?: number; selectedJoint?: string | null } = {}
  ) {
    const { bodyYaw = 0, headYaw = 0, selectedJoint: sel = null } = opts;

    figureGroup.rotation.y = (bodyYaw * Math.PI) / 180;
    headGroup.rotation.y   = -(headYaw * Math.PI) / 180;

    for (const { id, isEnd } of JOINT_DEFS) {
      const pos = pose[id];
      if (!pos) continue;
      const colSel  = sel === id;
      const mat = mkBasic(colSel ? COL_SEL : (isEnd ? COL_END : COL_JOINT));
      if (id === "head") {
        headGroup.position.set(pos[0], pos[1], pos[2]);
        jointMeshes[id].material = mat;
      } else {
        jointMeshes[id].position.set(pos[0], pos[1], pos[2]);
        jointMeshes[id].material = mat;
      }
    }

    refreshBones();
    renderer.render(scene, camera);
  }

  function hitTestJoint(normX: number, normY: number): string | null {
    raycaster.setFromCamera(toNDC(normX, normY), camera);
    // 末端シェイプを含む全ジョイント + 鼻
    const targets = [...Object.values(jointMeshes), noseMesh, ...Object.values(endShapes)];
    const hits = raycaster.intersectObjects(targets, true);
    return hits.length > 0 ? (hits[0].object.userData.id as string ?? hits[0].object.parent?.userData.id as string ?? null) : null;
  }

  function getDraggedPos(jointId: string, normX: number, normY: number) {
    const anchor = jointId === "head" ? headGroup : jointMeshes[jointId];
    const worldPos = new THREE.Vector3();
    (anchor as THREE.Object3D).getWorldPosition(worldPos);
    camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, worldPos);
    raycaster.setFromCamera(toNDC(normX, normY), camera);
    if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return null;
    const local = figureGroup.worldToLocal(planeHit.clone());
    return [local.x, local.y, local.z] as [number, number, number];
  }

  function orbitStart(nx: number, ny: number) { orbitActive = true; orbitLast = { x: nx, y: ny }; }
  function orbitMove(nx: number, ny: number) {
    if (!orbitActive) return;
    camTheta -= (nx - orbitLast.x) * 3.0;
    camPhi    = Math.max(-0.28, Math.min(1.15, camPhi + (ny - orbitLast.y) * 1.6));
    orbitLast = { x: nx, y: ny };
    posCamera();
    renderer.render(scene, camera);
  }
  function orbitEnd() { orbitActive = false; }

  function resize(w: number, h: number) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function applyViewPreset(preset: ViewPreset) {
    const THETA: Record<ViewPreset, number> = { front: 0, diagonal: Math.PI/4, side: Math.PI/2 };
    camTheta = THETA[preset]; camPhi = 0.10;
    posCamera();
    renderer.render(scene, camera);
  }

  function dispose() {
    renderer.dispose();
    renderer.domElement?.parentNode?.removeChild(renderer.domElement);
  }

  return { render, hitTestJoint, getDraggedPos, orbitStart, orbitMove, orbitEnd, resize, applyViewPreset, dispose };
}
