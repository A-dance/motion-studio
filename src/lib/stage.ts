/**
 * stage.ts — Three.js ダンサーステージ
 *
 * - Phong シェーディング + ディレクショナルライトで立体感表現
 * - 関節ドラッグ IK（球=上下左右 / 形=前後左右）
 */
import * as THREE from "three";
import type { Pose, StageAPI, ViewPreset, EndRot } from "./types";

// ─── スケルトン定義 ──────────────────────────────────────
const JOINT_DEFS: { id: string; r: number; isEnd?: boolean }[] = [
  { id: "head",   r: 0.130 },
  { id: "neck",   r: 0.052 },
  { id: "shldrL", r: 0.080 }, { id: "shldrR", r: 0.080 },
  { id: "elbowL", r: 0.062 }, { id: "elbowR", r: 0.062 },
  { id: "wristL", r: 0.058 }, { id: "wristR", r: 0.058 },
  { id: "handL",  r: 0.052, isEnd: true },
  { id: "handR",  r: 0.052, isEnd: true },
  { id: "hip",    r: 0.090 },
  { id: "hipL",   r: 0.074 }, { id: "hipR",   r: 0.074 },
  { id: "kneeL",  r: 0.070 }, { id: "kneeR",  r: 0.070 },
  { id: "ankleL", r: 0.068 }, { id: "ankleR", r: 0.068 },
  { id: "footL",  r: 0.056, isEnd: true },
  { id: "footR",  r: 0.056, isEnd: true },
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

export const HEAD_YAW_CYCLE = [0, 45, 90, -90, -45] as const;
export function nextHeadYaw(current: number): number {
  const idx = HEAD_YAW_CYCLE.findIndex((v) => Math.abs(v - current) < 15);
  return HEAD_YAW_CYCLE[(idx + 1) % HEAD_YAW_CYCLE.length];
}

// ─── ステージ ────────────────────────────────────────────
export function createStage(container: HTMLElement): StageAPI {
  const W = container.clientWidth  || 440;
  const H = container.clientHeight || 560;

  // ── レンダラー ───────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace   = THREE.SRGBColorSpace;
  renderer.toneMapping        = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setSize(W, H);
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;";
  container.appendChild(renderer.domElement);

  // ── シーン ───────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f0d0b);
  // 奥行き感を出す微妙なフォグ
  scene.fog = new THREE.Fog(0x0f0d0b, 9, 22);

  // ── カメラ ───────────────────────────────────────────
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

  // ── ライティング（立体感用） ─────────────────────────
  // 環境光（ベース）
  scene.add(new THREE.AmbientLight(0xffe8d8, 1.2));

  // キーライト：右斜め上前方
  const keyLight = new THREE.DirectionalLight(0xfff0e8, 1.8);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);

  // フィルライト：左後方（柔らか）
  const fillLight = new THREE.DirectionalLight(0xc0d4f0, 0.5);
  fillLight.position.set(-3, 2, -3);
  scene.add(fillLight);

  // リムライト：下後方（輪郭強調）
  const rimLight = new THREE.DirectionalLight(0xffc0a0, 0.3);
  rimLight.position.set(0, -1, -4);
  scene.add(rimLight);

  // ── フロア + グリッド ────────────────────────────────
  const floorMesh = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 64),
    new THREE.MeshLambertMaterial({ color: 0x120e0b })
  );
  floorMesh.rotation.x  = -Math.PI / 2;
  floorMesh.position.y  = -1.0;
  floorMesh.renderOrder = 1;
  scene.add(floorMesh);

  const ringMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.7, 64),
    new THREE.MeshBasicMaterial({ color: 0x5a3018, transparent: true, opacity: 0.18, depthWrite: false })
  );
  ringMesh.rotation.x  = -Math.PI / 2;
  ringMesh.position.y  = -0.998;
  ringMesh.renderOrder = 2;
  scene.add(ringMesh);

  const grid = new THREE.GridHelper(7, 28, 0x6a4030, 0x3a1e10);
  const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const m of gridMats) {
    (m as THREE.LineBasicMaterial).transparent = true;
    (m as THREE.LineBasicMaterial).opacity     = 0.35;
    (m as THREE.LineBasicMaterial).depthWrite  = false;
  }
  grid.position.y  = -0.999;
  grid.renderOrder = 0;
  scene.add(grid);

  // ── マテリアル ───────────────────────────────────────
  const COL_JOINT = 0xe0b0c8;
  const COL_SEL   = 0xff3880;
  const COL_BONE  = 0xa88090;
  const COL_END   = 0xf4d0e0;

  function mkPhong(color: number, shininess = 55): THREE.MeshPhongMaterial {
    return new THREE.MeshPhongMaterial({ color, shininess });
  }

  // ── フィギュアグループ ───────────────────────────────
  const figureGroup = new THREE.Group();
  scene.add(figureGroup);

  const jointMeshes: Record<string, THREE.Mesh> = {};
  for (const { id, r, isEnd } of JOINT_DEFS) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      mkPhong(isEnd ? COL_END : COL_JOINT)
    );
    mesh.userData.id = id;
    jointMeshes[id]  = mesh;
    figureGroup.add(mesh);
  }

  // 頭グループ + 鼻（headYaw 回転用）
  const headGroup = new THREE.Group();
  headGroup.add(jointMeshes.head);
  figureGroup.remove(jointMeshes.head);

  const noseMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.052, 12, 10),
    new THREE.MeshPhongMaterial({ color: 0xff2855, shininess: 80 })
  );
  noseMesh.position.set(0, 0.01, 0.150);
  noseMesh.userData.id = "_nose";
  headGroup.add(noseMesh);
  figureGroup.add(headGroup);

  // ── 手のひら・足先の形状（方向制御可能・独立グループ） ──
  // 球ジョイントドラッグ → IK 移動 / 四角ドラッグ → 方向回転
  const END_SHAPE_COLS = { hand: 0xecc0d8, foot: 0xc0b090 };
  const endShapes: Record<string, THREE.Mesh> = {};
  const endGroups: Record<string, THREE.Group> = {};

  // 親ジョイント（方向計算用）
  const END_PARENT: Record<string, string> = {
    handR: "wristR", handL: "wristL",
    footR: "ankleR", footL: "ankleL",
  };

  type EndShapeInfo = { geo: THREE.BufferGeometry; col: number; offset: [number,number,number] };
  const END_SHAPE_DEFS: Record<string, EndShapeInfo> = {
    handL: { geo: new THREE.BoxGeometry(0.19, 0.036, 0.25), col: END_SHAPE_COLS.hand, offset: [0, 0, 0.10] },
    handR: { geo: new THREE.BoxGeometry(0.19, 0.036, 0.25), col: END_SHAPE_COLS.hand, offset: [0, 0, 0.10] },
    footL: { geo: new THREE.BoxGeometry(0.11, 0.034, 0.28), col: END_SHAPE_COLS.foot, offset: [0, 0, 0.11] },
    footR: { geo: new THREE.BoxGeometry(0.11, 0.034, 0.28), col: END_SHAPE_COLS.foot, offset: [0, 0, 0.11] },
  };
  for (const [id, def] of Object.entries(END_SHAPE_DEFS)) {
    const group = new THREE.Group();
    figureGroup.add(group);
    endGroups[id] = group;

    const mesh = new THREE.Mesh(def.geo, mkPhong(def.col, 35));
    mesh.position.set(...def.offset);
    // "handR_rot" などで返すことで、球 IK ドラッグと区別する
    mesh.userData.id = id + "_rot";
    endShapes[id]    = mesh;
    group.add(mesh);
  }

  // ── ボーン ──────────────────────────────────────────
  const boneMeshes: Record<string, THREE.Mesh> = {};
  for (const [a, b] of BONE_PAIRS) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.030, 0.022, 1, 10),
      mkPhong(COL_BONE, 30)
    );
    boneMeshes[`${a}__${b}`] = mesh;
    figureGroup.add(mesh);
  }

  // ── ヘルパー ────────────────────────────────────────
  const UP     = new THREE.Vector3(0, 1, 0);
  const tmpDir = new THREE.Vector3();
  const tmpMid = new THREE.Vector3();

  function getLocalPos(id: string): THREE.Vector3 {
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

  // ── レイキャスト / オービット ────────────────────────
  const raycaster  = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.04 };
  const dragPlane  = new THREE.Plane();
  const planeHit   = new THREE.Vector3();
  const camDir     = new THREE.Vector3();
  let orbitActive  = false;
  let orbitLast    = { x: 0, y: 0 };

  function toNDC(nx: number, ny: number) {
    return new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1));
  }

  // ── ライト位置をカメラ角度に追従させる ──────────────
  function updateLights() {
    // キーライトはカメラの右斜め上前方
    const sin = Math.sin(camTheta), cos = Math.cos(camTheta);
    keyLight.position.set(cos * 3 + sin * 1, 5, -sin * 3 + cos * 1);
    fillLight.position.set(-cos * 3, 2, sin * 3 - cos * 3);
  }
  updateLights();

  // ── API ─────────────────────────────────────────────

  // ── 方向計算ヘルパー ─────────────────────────────────
  const WORLD_Z  = new THREE.Vector3(0, 0, 1);
  const tmpVec   = new THREE.Vector3();
  const tmpQ1    = new THREE.Quaternion();
  const tmpQ2    = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();

  function render(
    pose: Pose,
    opts: {
      bodyYaw?: number; headYaw?: number;
      selectedJoint?: string | null;
      endRot?: Record<string, EndRot>;
    } = {}
  ) {
    const { bodyYaw = 0, headYaw = 0, selectedJoint: sel = null, endRot } = opts;

    figureGroup.rotation.y = (bodyYaw  * Math.PI) / 180;
    headGroup.rotation.y   = -(headYaw * Math.PI) / 180;

    for (const { id, isEnd } of JOINT_DEFS) {
      const pos = pose[id];
      if (!pos) continue;
      const selected = sel === id;
      const color    = selected ? COL_SEL : (isEnd ? COL_END : COL_JOINT);
      const mat = mkPhong(color, selected ? 100 : (isEnd ? 40 : 55));
      if (id === "head") {
        headGroup.position.set(pos[0], pos[1], pos[2]);
        jointMeshes[id].material = mat;
      } else {
        jointMeshes[id].position.set(pos[0], pos[1], pos[2]);
        jointMeshes[id].material = mat;
      }
    }

    // 手先・足先の四角グループを位置・方向・endRot で更新
    for (const [id, parentId] of Object.entries(END_PARENT)) {
      const endPos    = pose[id];
      const parentPos = pose[parentId];
      const group     = endGroups[id];
      const shapeMesh = endShapes[id];
      if (!endPos || !parentPos || !group || !shapeMesh) continue;

      group.position.set(endPos[0], endPos[1], endPos[2]);

      // 前腕 / 下腿方向を Z 軸に合わせる
      tmpVec.set(endPos[0] - parentPos[0], endPos[1] - parentPos[1], endPos[2] - parentPos[2]);
      if (tmpVec.length() > 0.001) {
        tmpVec.normalize();
        tmpQ1.setFromUnitVectors(WORLD_Z, tmpVec);
      } else {
        tmpQ1.identity();
      }

      // ユーザーが設定した追加回転（pitch / roll）
      const rot = endRot?.[id];
      if (rot && (rot[0] !== 0 || rot[1] !== 0)) {
        tmpEuler.set(rot[0], 0, rot[1]);
        tmpQ2.setFromEuler(tmpEuler);
        group.quaternion.multiplyQuaternions(tmpQ1, tmpQ2);
      } else {
        group.quaternion.copy(tmpQ1);
      }

      // 選択中は四角を強調表示
      const isSelRot = sel === id + "_rot";
      const shapeCol = isSelRot ? COL_SEL : (id.startsWith("hand") ? END_SHAPE_COLS.hand : END_SHAPE_COLS.foot);
      (shapeMesh.material as THREE.MeshPhongMaterial).color.setHex(shapeCol);
    }

    refreshBones();
    renderer.render(scene, camera);
  }

  function hitTestJoint(normX: number, normY: number): string | null {
    raycaster.setFromCamera(toNDC(normX, normY), camera);
    const targets = [...Object.values(jointMeshes), noseMesh, ...Object.values(endGroups)];
    const hits    = raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    const obj = hits[0].object;
    return (obj.userData.id as string | undefined)
      ?? (obj.parent?.userData.id as string | undefined)
      ?? null;
  }

  const HORIZ_NORMAL = new THREE.Vector3(0, 1, 0);

  function getDraggedPos(jointId: string, normX: number, normY: number, useHorizontalPlane = false) {
    const anchor   = (jointId === "head" ? headGroup : jointMeshes[jointId]) as THREE.Object3D;
    const worldPos = new THREE.Vector3();
    anchor.getWorldPosition(worldPos);

    if (useHorizontalPlane) {
      // XZ 水平面（関節の現在の高さ） — 前後・左右に自由に動ける
      dragPlane.setFromNormalAndCoplanarPoint(HORIZ_NORMAL, worldPos);
    } else {
      // カメラ正面の垂直面 — 上下・左右に動ける
      camera.getWorldDirection(camDir);
      dragPlane.setFromNormalAndCoplanarPoint(camDir, worldPos);
    }

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
    updateLights();
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
    const THETA: Record<ViewPreset, number> = { front: 0, diagonal: Math.PI / 4, side: Math.PI / 2 };
    camTheta = THETA[preset]; camPhi = 0.10;
    posCamera();
    updateLights();
    renderer.render(scene, camera);
  }

  function dispose() {
    renderer.dispose();
    renderer.domElement?.parentNode?.removeChild(renderer.domElement);
  }

  return { render, hitTestJoint, getDraggedPos, orbitStart, orbitMove, orbitEnd, resize, applyViewPreset, dispose };
}
