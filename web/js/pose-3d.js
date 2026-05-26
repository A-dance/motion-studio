/**
 * pose-3d.js — 関節座標型ダンサーステージ
 *
 * 各関節 = body-local 座標 (x,y,z) を直接保持
 * bodyYaw = 全関節を一括 Y 軸回転（向き変更のみ）
 * ドラッグ = 画面平行移動 / Shift+ドラッグ = 奥行き
 */
import * as THREE from "three";

// ─── ボーン定義 ─────────────────────────────────────────────
export const BONE_DEFS = [
  { id: "hip",    parent: null,     offset: [0,      0.84,   0    ], r: 0.095 },
  { id: "spine",  parent: "hip",    offset: [0,      0.20,   0    ], r: 0.082 },
  { id: "chest",  parent: "spine",  offset: [0,      0.20,   0    ], r: 0.090 },
  { id: "neck",   parent: "chest",  offset: [0,      0.26,   0    ], r: 0.055 },
  { id: "head",   parent: "neck",   offset: [0,      0.25,   0    ], r: 0.125 },
  { id: "shldrL", parent: "chest",  offset: [-0.46,  0.16,   0    ], r: 0.088 },
  { id: "elbowL", parent: "shldrL", offset: [-0.08, -0.50,   0    ], r: 0.065 },
  { id: "wristL", parent: "elbowL", offset: [0,     -0.50,   0    ], r: 0.058 },
  { id: "handL",  parent: "wristL", offset: [0,     -0.18,   0    ], r: 0.048 },
  { id: "shldrR", parent: "chest",  offset: [0.46,   0.16,   0    ], r: 0.088 },
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
  hip: "腰", spine: "腹", chest: "胸", neck: "首", head: "頭",
  shldrL: "左肩", elbowL: "左肘", wristL: "左手首", handL: "左手",
  shldrR: "右肩", elbowR: "右肘", wristR: "右手首", handR: "右手",
  hipL: "左股", kneeL: "左膝", ankleL: "左足首", footL: "左足",
  hipR: "右股", kneeR: "右膝", ankleR: "右足首", footR: "右足",
};

export const REST_JOINT_POS = (() => {
  const pos = {};
  for (const def of BONE_DEFS) {
    if (!def.parent) {
      pos[def.id] = [...def.offset];
    } else {
      const p = pos[def.parent];
      pos[def.id] = [
        p[0] + def.offset[0],
        p[1] + def.offset[1],
        p[2] + def.offset[2],
      ];
    }
  }
  return pos;
})();

export function cloneJointPos(jp) {
  const r = {};
  for (const id of Object.keys(REST_JOINT_POS)) {
    const v = jp?.[id];
    r[id] = (Array.isArray(v) && v.length >= 3)
      ? [+v[0] || 0, +v[1] || 0, +v[2] || 0]
      : [...REST_JOINT_POS[id]];
  }
  return r;
}

export function sanitizeJointPos(jp) {
  return cloneJointPos(jp);
}

const BONE_DEFS_MAP = Object.fromEntries(BONE_DEFS.map(d => [d.id, d]));
const BONE_PAIRS = BONE_DEFS.filter(d => d.parent).map(d => [d.parent, d.id]);
const PALM_BONE_KEYS = new Set(["wristL__handL", "wristR__handR"]);
const SOLE_BONE_KEYS = new Set(["ankleL__footL", "ankleR__footR"]);

function finiteYaw(deg, fallback = 0) {
  const n = Number(deg);
  return Number.isFinite(n) ? n : fallback;
}

function localToWorldPos(jointPos, bodyYaw) {
  const DEG = Math.PI / 180;
  const yaw = finiteYaw(bodyYaw, 0) * DEG;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const worldPos = {};
  for (const def of BONE_DEFS) {
    const lp = jointPos[def.id] ?? REST_JOINT_POS[def.id];
    const [lx, ly, lz] = lp;
    worldPos[def.id] = new THREE.Vector3(
      lx * cosY + lz * sinY,
      ly,
      -lx * sinY + lz * cosY,
    );
  }
  return worldPos;
}

// ─── ステージ作成 ─────────────────────────────────────────────
export function createStage(container) {
  const W = container.clientWidth  || 440;
  const H = container.clientHeight || 560;

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

  const mBase = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.50, metalness: 0.08 });
  const mSel  = new THREE.MeshStandardMaterial({
    color: 0xffbf00, emissive: new THREE.Color(0xffbf00), emissiveIntensity: 0.55,
    roughness: 0.25, metalness: 0.20,
  });
  const mBone = new THREE.MeshStandardMaterial({ color: 0x787060, roughness: 0.72, metalness: 0.05 });
  const mPalm = new THREE.MeshStandardMaterial({ color: 0xffd3b0, roughness: 0.68, metalness: 0.02 });
  const mSole = new THREE.MeshStandardMaterial({ color: 0xe0c8b0, roughness: 0.72, metalness: 0.02 });

  const avatarGroup = new THREE.Group();
  scene.add(avatarGroup);

  const jointMeshes = {};
  const UP = new THREE.Vector3(0, 1, 0);

  for (const def of BONE_DEFS) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.r, 16, 12), mBase.clone());
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.boneId = def.id;
    avatarGroup.add(mesh);
    jointMeshes[def.id] = mesh;
  }

  const HIT_ZONE_SCALE = {
    hip: 1.9, spine: 1.85, chest: 1.9, neck: 1.65,
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

  const boneMeshes = {};
  const mittenMeshes = {};
  for (const key of PALM_BONE_KEYS) {
    const handId = key.split("__")[1];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 1, 0.050),
      mPalm.clone(),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.boneId = handId;
    mittenMeshes[key] = mesh;
    avatarGroup.add(mesh);
  }
  for (const key of SOLE_BONE_KEYS) {
    const footId = key.split("__")[1];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 1, 0.068),
      mSole.clone(),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.boneId = footId;
    mittenMeshes[key] = mesh;
    avatarGroup.add(mesh);
  }
  for (const [a, b] of BONE_PAIRS) {
    const key = `${a}__${b}`;
    if (PALM_BONE_KEYS.has(key) || SOLE_BONE_KEYS.has(key)) continue;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.030, 0.022, 1, 9),
      mBone.clone(),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    boneMeshes[key] = mesh;
    avatarGroup.add(mesh);
  }

  const selRing = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffbf00, emissive: new THREE.Color(0xffbf00), emissiveIntensity: 1.2,
      transparent: true, opacity: 0.50, depthWrite: false,
    }),
  );
  selRing.visible = false;
  avatarGroup.add(selRing);

  const tmpDir = new THREE.Vector3();
  const tmpMid = new THREE.Vector3();
  const tmpA   = new THREE.Vector3();
  const tmpB   = new THREE.Vector3();
  const tmpPalmQ = new THREE.Quaternion();
  const tmpPitchQ = new THREE.Quaternion();
  const tmpCamRight = new THREE.Vector3();

  function placeBoneSegment(mesh, pa, pb, towardEnd = 0.55) {
    tmpDir.subVectors(pb, pa);
    const len = tmpDir.length();
    if (len < 0.005) { mesh.visible = false; return; }
    mesh.visible = true;
    tmpMid.lerpVectors(pa, pb, towardEnd);
    mesh.position.copy(tmpMid);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
  }

  function updateVisuals(worldPos, selectedBoneId, palmRot = {}, wristPitch = {}) {
    for (const def of BONE_DEFS) {
      const pos = worldPos[def.id];
      if (!pos || !Number.isFinite(pos.x)) continue;
      const mesh = jointMeshes[def.id];
      if (mesh) {
        mesh.position.copy(pos);
        mesh.visible = true;
        mesh.material = def.id === selectedBoneId ? mSel : mBase;
      }
      const hm = hitZoneMeshes[def.id];
      if (hm) hm.position.copy(pos);
    }

    if (selectedBoneId && worldPos[selectedBoneId]) {
      const r = BONE_DEFS_MAP[selectedBoneId]?.r ?? 0.065;
      selRing.scale.setScalar(r / 0.065);
      selRing.position.copy(worldPos[selectedBoneId]);
      selRing.visible = true;
    } else {
      selRing.visible = false;
    }

    for (const [a, b] of BONE_PAIRS) {
      const pa = worldPos[a]; const pb = worldPos[b];
      if (!pa || !pb) continue;
      tmpA.copy(pa); tmpB.copy(pb);
      const key = `${a}__${b}`;
      const isMitten = mittenMeshes[key] != null;
      const mesh = boneMeshes[key] ?? mittenMeshes[key];
      if (!mesh) continue;

      placeBoneSegment(mesh, tmpA, tmpB, isMitten ? 0.58 : 0.5);

      if (isMitten) {
        const childId = b;

        const rollDeg = palmRot?.[childId] ?? 0;
        tmpDir.subVectors(tmpB, tmpA).normalize();
        tmpPalmQ.setFromAxisAngle(tmpDir, rollDeg * Math.PI / 180);
        mesh.quaternion.premultiply(tmpPalmQ);

        const pitchDeg = wristPitch?.[childId] ?? 0;
        if (Math.abs(pitchDeg) > 0.001) {
          tmpCamRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
          tmpPitchQ.setFromAxisAngle(tmpCamRight, pitchDeg * Math.PI / 180);
          mesh.quaternion.premultiply(tmpPitchQ);
        }
      }
    }
  }

  let _lastJointPos = cloneJointPos({});
  let _lastOpts     = {};
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

  const raycaster = new THREE.Raycaster();
  function toNDC(nx, ny) { return new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)); }

  function solveJointDrag(boneId, movX, movY, jointPos, bodyYaw,
                        shiftKey = false, altKey = false,
                        palmRot = {}, wristPitch = {}) {
    const isPalmOrSole = boneId.startsWith("hand") || boneId.startsWith("foot");
    if (altKey && isPalmOrSole) {
      const currentRoll  = palmRot?.[boneId] ?? 0;
      const currentPitch = wristPitch?.[boneId] ?? 0;
      return {
        palmRot:    { [boneId]: currentRoll  + movX * 3.0 },
        wristPitch: { [boneId]: currentPitch - movY * 3.0 },
      };
    }

    const dist = Math.hypot(movX, movY);
    const cap = 48;
    if (dist > cap) { const s = cap / dist; movX *= s; movY *= s; }

    const DEG = Math.PI / 180;
    const yaw = (bodyYaw ?? 0) * DEG;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);

    const lp = jointPos[boneId] ?? REST_JOINT_POS[boneId];
    const worldCurrent = new THREE.Vector3(
      lp[0] * cosY + lp[2] * sinY,
      lp[1],
      -lp[0] * sinY + lp[2] * cosY,
    );

    const depth = Math.max(0.5, worldCurrent.distanceTo(camera.position));
    const scale = depth * 0.00075;

    const camR = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const camU = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const camF = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

    const delta = new THREE.Vector3();
    if (shiftKey) {
      delta.addScaledVector(camF, movX * scale).addScaledVector(camU, -movY * scale);
    } else {
      delta.addScaledVector(camR, movX * scale).addScaledVector(camU, -movY * scale);
    }

    const newWorld = worldCurrent.clone().add(delta);

    const newLx = newWorld.x * cosY - newWorld.z * sinY;
    const newLy = newWorld.y;
    const newLz = newWorld.x * sinY + newWorld.z * cosY;

    const FLOOR_Y = -1.0, MARGIN = 0.04;
    const finalY = (boneId === "footL" || boneId === "footR")
      ? Math.max(FLOOR_Y + MARGIN, newLy)
      : newLy;

    return { jointPos: { [boneId]: [newLx, finalY, newLz] } };
  }

  function render(jointPos = {}, opts = {}) {
    const {
      bodyYaw = 0,
      selectedBoneId = null,
      palmRot = {},
      wristPitch = {},
    } = opts;
    const safeJointPos = sanitizeJointPos(jointPos);
    const safeBodyYaw = finiteYaw(bodyYaw, 0);
    const worldPos = localToWorldPos(safeJointPos, safeBodyYaw);

    _lastJointPos = cloneJointPos(safeJointPos);
    _lastOpts = { bodyYaw: safeBodyYaw, selectedBoneId, palmRot, wristPitch };
    _lastWorldPos = worldPos;

    updateVisuals(worldPos, selectedBoneId, palmRot, wristPitch);
    try { renderer.render(scene, camera); } catch (e) { console.error(e); }
  }

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
    render(_lastJointPos, _lastOpts);
  }
  function orbitEnd() {}

  function resize(w, h) {
    if (w < 1 || h < 1) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render(_lastJointPos, _lastOpts);
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
