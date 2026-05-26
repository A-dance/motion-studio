/**
 * app.js — Dance Sequence Note
 *
 * 操作体系:
 *   - 関節ドラッグ → 画面平行移動 / Shift+ドラッグ → 奥行き
 *   - カウント切替 → ポーズ・矢印・メモを同期表示
 *   - 背景ドラッグ → 視点変更
 *   - ツールバー → アノテーション追加モード
 */
import {
  REST_JOINT_POS, cloneJointPos, sanitizeJointPos,
  createStage,
} from "./pose-3d.js";
import {
  createItem,
  dragItemArcStart, dragItemBendCP, dragItemRotate, dragItemTip,
  hitTestItems, drawAnnotCanvas,
} from "./canvas-items.js";

// ─── DOM ────────────────────────────────────────────────────
const stageWrap    = document.getElementById("stageWrap");
const viewport3d   = document.getElementById("viewport3d");
const annotCanvas  = document.getElementById("annotCanvas");

const countLabel   = document.getElementById("currentCountLabel");
const countMemoEl  = document.getElementById("countMemo");
const countRefSearchEl = document.getElementById("countRefSearch");
const countRefHintEl   = document.getElementById("countRefHint");
const fieldMotionEl = document.getElementById("fieldMotion");


// アイテム調整
const dirAngle     = document.getElementById("dirAngle");
const dirAngleLbl  = document.getElementById("dirAngleLbl");
const dirPower     = document.getElementById("dirPower");
const dirPowerLbl  = document.getElementById("dirPowerLbl");
const dirBend      = document.getElementById("dirBend");
const dirBendLbl   = document.getElementById("dirBendLbl");
const dirTilt      = document.getElementById("dirTilt");
const dirTiltLbl   = document.getElementById("dirTiltLbl");
const bendRow      = document.getElementById("bendRow");
const tiltRow      = document.getElementById("tiltRow");
const itemControls  = document.getElementById("itemControls");
const itemCtrlTitle = document.getElementById("itemCtrlTitle");
const btnDeleteItem = document.getElementById("btnDeleteItem");
const addFeedback   = document.getElementById("addFeedback");

// 作品管理
const workNameEl   = document.getElementById("workName");
const saveHint     = document.getElementById("saveHint");

// インライン編集
const inlineEditEl    = document.getElementById("inlineEdit");
const inlineEditInput = document.getElementById("inlineEditInput");

// ─── 定数 ────────────────────────────────────────────────────
const LS_KEY         = "dance-studio-v5";
const LS_POSES_KEY   = "dance-studio-v5-poses";
const LS_LIBRARY_KEY = "dance-studio-v5-library";
const COUNTS_PER_PHRASE = 16;
const MAX_POSE_UNDO     = 32;
const BODY_YAW_STEP     = 15;

// カウントごとのポーズ Undo 履歴（保存しない）
const poseUndoStacks = new Map();

// ─── 状態 ────────────────────────────────────────────────────
let work       = loadWork() ?? makeWork();
let phraseIdx  = 0;
let countIdx   = 0;

let selectedBoneId = null;
let selectedItemId = null;
let editingItemId  = null;

let renamingPhraseIdx = -1; // フレーズ名リネーム中のインデックス（-1 = なし）

let dragKind      = null;   // "joint" | "orbit" | "item-*"
let dragBoneId    = null;
let dragItemId    = null;
let prevDragNorm  = null;   // 直前フレームの正規化ポインタ位置 {x, y}
let dragUndoPushed = false; // 今回のドラッグで Undo を積んだか

let addFbTimer  = 0;
let saveTimer   = 0;
let stage       = null;

let currentTool = "select";  // "select" | "orbit" | "arrow" | "spin" | "text"

// ポーズライブラリ
let poseLibrary = loadPoseLibrary();

// ─── データ ─────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function phraseLabel(idx) {
  const ch = String.fromCharCode(65 + (idx % 26));
  const n  = Math.floor(idx / 26);
  return n === 0 ? ch : `${ch}${n + 1}`;
}

const REST_PALM_ROT = { handL: 0, handR: 0, footL: 0, footR: 0 };
const REST_WRIST_PITCH = { handL: 0, handR: 0, footL: 0, footR: 0 };

function isPalmOrSoleBone(boneId) {
  return boneId?.startsWith("hand") || boneId?.startsWith("foot");
}

function updatePalmRotDisplay(boneId, rollDeg, pitchDeg = 0) {
  const el = document.getElementById("palmrot-display");
  if (!el) return;
  const roll = Math.round(Number(rollDeg) || 0);
  const pitch = Math.round(Number(pitchDeg) || 0);
  el.textContent = pitch !== 0
    ? `roll ${roll}° pitch ${pitch}°`
    : `palm ${roll}°`;
  el.hidden = false;
}

function clearPalmRotDisplay() {
  const el = document.getElementById("palmrot-display");
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

function makeCount(n) {
  return {
    n,
    jointPos: cloneJointPos(REST_JOINT_POS),
    palmRot: { handL: 0, handR: 0, footL: 0, footR: 0 },
    wristPitch: { handL: 0, handR: 0, footL: 0, footR: 0 },
    items: [],
    memo: "",
    bodyYaw: 0,
  };
}

function makePhrase(idx) {
  return {
    id:     uid(),
    label:  phraseLabel(idx),
    counts: Array.from({ length: COUNTS_PER_PHRASE }, (_, i) => makeCount(i + 1)),
  };
}

function makeWork(name = "") {
  return { id: uid(), name, phrases: [makePhrase(0)] };
}

function current() { return work.phrases[phraseIdx].counts[countIdx]; }

function selectedItem() {
  return current().items.find(i => i.id === selectedItemId) ?? null;
}

function countDisplayLabel(pi, ci) {
  return `${work.phrases[pi].label}-${ci + 1}`;
}

function hasPoseContent(c) {
  if (!c) return false;
  if (Math.abs(c.bodyYaw ?? 0) > 1) return true;
  const jp = c.jointPos ?? {};
  for (const id of Object.keys(REST_JOINT_POS)) {
    const p = jp[id] ?? REST_JOINT_POS[id];
    const r = REST_JOINT_POS[id];
    if (Math.abs(p[0] - r[0]) > 0.01
     || Math.abs(p[1] - r[1]) > 0.01
     || Math.abs(p[2] - r[2]) > 0.01) return true;
  }
  const pr = c.palmRot ?? {};
  const wp = c.wristPitch ?? {};
  if (Math.abs(Number(pr.handL) || 0) > 1
   || Math.abs(Number(pr.handR) || 0) > 1
   || Math.abs(Number(pr.footL) || 0) > 1
   || Math.abs(Number(pr.footR) || 0) > 1) return true;
  if (Math.abs(Number(wp.handL) || 0) > 1
   || Math.abs(Number(wp.handR) || 0) > 1
   || Math.abs(Number(wp.footL) || 0) > 1
   || Math.abs(Number(wp.footR) || 0) > 1) return true;
  return false;
}

function hasContent(c) {
  if (!c) return false;
  if (c.memo?.trim()) return true;
  if (c.items?.length > 0) return true;
  return hasPoseContent(c);
}

function cloneItems(items) {
  return (items ?? []).map(item => ({ ...item, id: uid() }));
}

function copyPalmRot(pr) {
  return {
    handL: Number.isFinite(Number(pr?.handL)) ? Number(pr.handL) : 0,
    handR: Number.isFinite(Number(pr?.handR)) ? Number(pr.handR) : 0,
    footL: Number.isFinite(Number(pr?.footL)) ? Number(pr.footL) : 0,
    footR: Number.isFinite(Number(pr?.footR)) ? Number(pr.footR) : 0,
  };
}

function copyWristPitch(wp) {
  return {
    handL: Number.isFinite(Number(wp?.handL)) ? Number(wp.handL) : 0,
    handR: Number.isFinite(Number(wp?.handR)) ? Number(wp.handR) : 0,
    footL: Number.isFinite(Number(wp?.footL)) ? Number(wp.footL) : 0,
    footR: Number.isFinite(Number(wp?.footR)) ? Number(wp.footR) : 0,
  };
}

function sanitizeCount(c) {
  c.jointPos = sanitizeJointPos(c.jointPos);
  c.palmRot  = copyPalmRot(c.palmRot);
  c.wristPitch = copyWristPitch(c.wristPitch);
  c.bodyYaw = Number.isFinite(Number(c.bodyYaw)) ? Number(c.bodyYaw) : 0;
  c.items  ??= [];
  c.memo   ??= "";
  return c;
}

function copyCountFull(src, dst) {
  dst.jointPos = sanitizeJointPos(src.jointPos);
  dst.palmRot  = copyPalmRot(src.palmRot);
  dst.wristPitch = copyWristPitch(src.wristPitch);
  dst.bodyYaw  = Number.isFinite(Number(src.bodyYaw)) ? Number(src.bodyYaw) : 0;
  dst.memo     = src.memo ?? "";
  dst.items    = cloneItems(src.items);
}

function applyPoseData(target, source, label) {
  if (target === current()) pushPoseUndo();
  target.jointPos = sanitizeJointPos(source.jointPos);
  target.palmRot  = copyPalmRot(source.palmRot);
  target.wristPitch = copyWristPitch(source.wristPitch);
  target.bodyYaw  = Number.isFinite(Number(source.bodyYaw)) ? Number(source.bodyYaw) : 0;
  selectedBoneId = null;
  selectedItemId = null;
  draw();
  if (label) showFb(`${label} のポーズを適用`);
}

function countStatusLabel(phrase, ci) {
  return `${phrase.label} – ${ci + 1} / ${phrase.counts.length}`;
}

function switchToCount(pi, ci) {
  phraseIdx = pi;
  const len = work.phrases[phraseIdx].counts.length;
  countIdx  = Math.max(0, Math.min(len - 1, ci));
  selectedItemId = null;
  selectedBoneId = null;
  clearPalmRotDisplay();
  syncCountUI();
  rebuildTimeline();
  draw();
  renderSongOverview();
}

function syncCountUI() {
  const c      = current();
  const phrase = work.phrases[phraseIdx];

  if (countLabel) countLabel.textContent = countStatusLabel(phrase, countIdx);

  const memo = c.memo ?? "";
  if (countMemoEl && document.activeElement !== countMemoEl) countMemoEl.value = memo;
  if (fieldMotionEl && document.activeElement !== fieldMotionEl) fieldMotionEl.value = memo;

  renderCountReferences();
}

// ─── 保存 / 読み込み ────────────────────────────────────────
function saveWork() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(work)); } catch { /* ignore */ }
}

function loadWork() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw);
    if (!w?.phrases?.length) return null;
    for (const phrase of w.phrases) {
      for (const c of phrase.counts) {
        sanitizeCount(c);
      }
    }
    return w;
  } catch { return null; }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWork, 800);
}

function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(LS_LIBRARY_KEY)) ?? []; } catch { return []; }
}
function saveCurrentToLibrary() {
  const lib = loadLibrary();
  work._savedAt = Date.now();
  work._phraseCount = work.phrases.length;
  const idx = lib.findIndex(w => w.id === work.id);
  if (idx >= 0) lib[idx] = work; else lib.push(work);
  localStorage.setItem(LS_LIBRARY_KEY, JSON.stringify(lib));
}
function openWorkFromLibrary(id) {
  const lib = loadLibrary();
  const found = lib.find(w => w.id === id);
  if (!found) return;
  if (!confirm(`「${found.name || "無名"}」を開きますか？未保存の変更は失われます。`)) return;
  for (const phrase of found.phrases) {
    for (const c of phrase.counts) sanitizeCount(c);
  }
  work = found;
  phraseIdx = 0; countIdx = 0;
  saveWork(); rebuildTimeline(); syncCountUI(); renderPoseLibrary(); draw();
  renderWorkLibrary();
  showFb(`「${work.name || "無名"}」を開きました`);
}
function deleteWorkFromLibrary(id) {
  const lib = loadLibrary().filter(w => w.id !== id);
  localStorage.setItem(LS_LIBRARY_KEY, JSON.stringify(lib));
  renderWorkLibrary();
}
function renderWorkLibrary() {
  const list = document.getElementById("workLibraryList");
  if (!list) return;
  list.innerHTML = "";
  const lib = loadLibrary();
  if (lib.length === 0) {
    list.innerHTML = '<div class="pose-empty">保存した振り付けはありません</div>';
    return;
  }
  [...lib].reverse().forEach(w => {
    const item = document.createElement("div");
    item.className = "pose-item work-library-item" + (w.id === work.id ? " is-current-work" : "");
    const info = document.createElement("div");
    info.style.flex = "1"; info.style.minWidth = "0";
    const name = document.createElement("span");
    name.className = "pose-item-name";
    name.textContent = w.name || "無名";
    const meta = document.createElement("span");
    meta.className = "pose-item-source";
    const d = w._savedAt ? new Date(w._savedAt).toLocaleDateString("ja-JP") : "-";
    meta.textContent = `${w._phraseCount ?? w.phrases?.length ?? "?"} フレーズ ・ ${d}`;
    info.appendChild(name); info.appendChild(meta);
    const openBtn = document.createElement("button");
    openBtn.type = "button"; openBtn.className = "pose-item-apply";
    openBtn.textContent = w.id === work.id ? "編集中" : "開く";
    openBtn.disabled = w.id === work.id;
    openBtn.addEventListener("click", () => openWorkFromLibrary(w.id));
    const delBtn = document.createElement("button");
    delBtn.type = "button"; delBtn.className = "pose-item-del"; delBtn.textContent = "×";
    delBtn.addEventListener("click", () => {
      if (!confirm(`「${w.name || "無名"}」を削除しますか？`)) return;
      deleteWorkFromLibrary(w.id);
    });
    item.appendChild(info); item.appendChild(openBtn); item.appendChild(delBtn);
    list.appendChild(item);
  });
}

// ─── ポーズライブラリ ────────────────────────────────────────
function loadPoseLibrary() {
  try { return JSON.parse(localStorage.getItem(LS_POSES_KEY)) ?? []; } catch { return []; }
}
function savePoseLibrary() {
  try { localStorage.setItem(LS_POSES_KEY, JSON.stringify(poseLibrary)); } catch { /* ignore */ }
}

function buildPoseSearchEntries() {
  const entries = [];

  for (const pose of poseLibrary) {
    entries.push({
      kind: "library",
      title: pose.name,
      sub: pose.source ?? "保存ポーズ",
      haystack: `${pose.name} ${pose.source ?? ""}`.toLowerCase(),
      hasPose: true,
      apply: () => applyPoseData(current(), pose, pose.name),
    });
  }

  work.phrases.forEach((phrase, pi) => {
    phrase.counts.forEach((count, ci) => {
      if (pi === phraseIdx && ci === countIdx) return;
      const label = countDisplayLabel(pi, ci);
      const memo  = count.memo?.trim() ?? "";
      const hasPose = hasPoseContent(count);
      if (!hasPose && !memo) return;

      entries.push({
        kind: "count",
        title: label,
        sub: memo || (hasPose ? "ポーズあり" : ""),
        haystack: `${label} ${memo} ${phrase.label}`.toLowerCase(),
        hasPose,
        goto: () => switchToCount(pi, ci),
        apply: () => applyPoseData(current(), count, label),
      });
    });
  });

  return entries;
}

function poseSearchRank(entry, q) {
  const title = entry.title.toLowerCase();
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (entry.kind === "library" && entry.title.toLowerCase().includes(q)) return 2;
  return 3;
}

function renderCountReferences() {
  const list = document.getElementById("countRefList");
  if (!list) return;

  const q = countRefSearchEl?.value.trim().toLowerCase() ?? "";
  list.innerHTML = "";

  if (!q) {
    if (countRefHintEl) countRefHintEl.classList.remove("hidden");
    return;
  }
  if (countRefHintEl) countRefHintEl.classList.add("hidden");

  const matches = buildPoseSearchEntries()
    .filter(e => e.haystack.includes(q))
    .sort((a, b) => {
      const ra = poseSearchRank(a, q);
      const rb = poseSearchRank(b, q);
      if (ra !== rb) return ra - rb;
      return a.title.localeCompare(b.title, "ja");
    })
    .slice(0, 12);

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pose-empty";
    empty.textContent = `「${countRefSearchEl?.value.trim()}」に一致するポーズがありません`;
    list.appendChild(empty);
    return;
  }

  for (const entry of matches) {
    const item = document.createElement("div");
    item.className = "count-ref-item";

    const meta = document.createElement("div");
    meta.className = "count-ref-meta";

    const lbl = document.createElement("span");
    lbl.className = "count-ref-label";
    lbl.textContent = entry.title;

    const badge = document.createElement("span");
    badge.className = "count-ref-badge" + (entry.kind === "library" ? " is-library" : "");
    badge.textContent = entry.kind === "library" ? "保存" : "カウント";

    const titleRow = document.createElement("div");
    titleRow.className = "count-ref-title-row";
    titleRow.appendChild(lbl);
    titleRow.appendChild(badge);

    const prev = document.createElement("span");
    prev.className = "count-ref-preview";
    prev.textContent = entry.sub;

    meta.appendChild(titleRow);
    meta.appendChild(prev);

    if (entry.kind === "count" && entry.goto) {
      const gotoBtn = document.createElement("button");
      gotoBtn.type = "button";
      gotoBtn.className = "pose-item-goto";
      gotoBtn.textContent = "参照";
      gotoBtn.title = `${entry.title} を開く`;
      gotoBtn.addEventListener("click", entry.goto);
      item.appendChild(meta);
      item.appendChild(gotoBtn);
    } else {
      item.appendChild(meta);
    }

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "pose-item-apply";
    applyBtn.textContent = "適用";
    applyBtn.title = `${entry.title} のポーズを現在のカウントに適用`;
    applyBtn.disabled = !entry.hasPose;
    applyBtn.addEventListener("click", entry.apply);
    item.appendChild(applyBtn);

    list.appendChild(item);
  }
}

function applyFirstPoseSearchResult() {
  const q = countRefSearchEl?.value.trim().toLowerCase() ?? "";
  if (!q) return;
  const first = buildPoseSearchEntries()
    .filter(e => e.haystack.includes(q) && e.hasPose)
    .sort((a, b) => poseSearchRank(a, q) - poseSearchRank(b, q))[0];
  first?.apply();
}

function renderPoseLibrary() {
  const list = document.getElementById("poseLibraryList");
  if (!list) return;
  list.innerHTML = "";

  if (poseLibrary.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pose-empty";
    empty.textContent = "ポーズを保存すると参照できます";
    list.appendChild(empty);
    return;
  }

  for (const pose of [...poseLibrary].reverse()) {
    const item = document.createElement("div");
    item.className = "pose-item";

    const nameWrap = document.createElement("div");
    nameWrap.style.flex = "1";
    nameWrap.style.minWidth = "0";

    const name = document.createElement("span");
    name.className   = "pose-item-name";
    name.textContent = pose.name;

    nameWrap.appendChild(name);
    if (pose.source) {
      const src = document.createElement("span");
      src.className   = "pose-item-source";
      src.textContent = pose.source;
      nameWrap.appendChild(src);
    }

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className   = "pose-item-apply";
    applyBtn.textContent = "適用";
    applyBtn.title = "現在のカウントに適用";
    applyBtn.addEventListener("click", () => {
      applyPoseData(current(), {
        jointPos: pose.jointPos,
        palmRot:  pose.palmRot,
        wristPitch: pose.wristPitch,
        bodyYaw: pose.bodyYaw ?? 0,
      }, pose.name);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className   = "pose-item-del";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => {
      poseLibrary = poseLibrary.filter(p => p.id !== pose.id);
      savePoseLibrary();
      renderPoseLibrary();
      renderCountReferences();
    });

    item.appendChild(nameWrap);
    item.appendChild(applyBtn);
    item.appendChild(delBtn);
    list.appendChild(item);
  }
}

function setCountMemo(value) {
  current().memo = value;
  if (countMemoEl && document.activeElement !== countMemoEl) countMemoEl.value = value;
  if (fieldMotionEl && document.activeElement !== fieldMotionEl) fieldMotionEl.value = value;
  scheduleSave();
  rebuildTimeline();
  renderCountReferences();
}

document.getElementById("btnSavePose")?.addEventListener("click", () => {
  const input  = document.getElementById("poseNameInput");
  const phrase = work.phrases[phraseIdx];
  const c      = current();
  const name   = input?.value.trim() || `${phrase.label}-${countIdx + 1}`;
  poseLibrary.push({
    id: uid(),
    name,
    source: `保存元: ${countDisplayLabel(phraseIdx, countIdx)}`,
    jointPos: cloneJointPos(c.jointPos),
    palmRot:  { ...c.palmRot },
    wristPitch: { ...c.wristPitch },
    bodyYaw: c.bodyYaw ?? 0,
  });
  savePoseLibrary();
  renderPoseLibrary();
  renderCountReferences();
  if (input) input.value = "";
  showFb(`「${name}」を保存`);
});

countMemoEl?.addEventListener("input", () => setCountMemo(countMemoEl.value));
fieldMotionEl?.addEventListener("input", () => setCountMemo(fieldMotionEl.value));

countRefSearchEl?.addEventListener("input", () => renderCountReferences());
countRefSearchEl?.addEventListener("keydown", ev => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    applyFirstPoseSearchResult();
  }
});

// ─── レンダリング ────────────────────────────────────────────
function draw() {
  const c = current();
  if (!c) return;
  sanitizeCount(c);
  try {
    stage?.render(c.jointPos, {
      bodyYaw: c.bodyYaw,
      selectedBoneId,
      palmRot: c.palmRot,
      wristPitch: c.wristPitch,
    });
  } catch (e) { console.error("3D描画エラー:", e); }
  try {
    drawAnnotCanvas(annotCanvas, c.items ?? [], selectedItemId);
  } catch (e) { console.error(e); }
  updateControls();
  scheduleSave();
}

// ─── ポーズ Undo / リセット ─────────────────────────────────
function poseUndoKey(pi = phraseIdx, ci = countIdx) {
  return `${pi}-${ci}`;
}

function poseSnapshot(c) {
  return {
    jointPos: cloneJointPos(c.jointPos),
    palmRot:  { ...c.palmRot },
    wristPitch: { ...c.wristPitch },
    bodyYaw:  c.bodyYaw ?? 0,
  };
}

function applyPoseSnapshot(c, snap) {
  c.jointPos = cloneJointPos(snap.jointPos);
  c.palmRot  = { ...snap.palmRot };
  c.wristPitch = { ...(snap.wristPitch ?? REST_WRIST_PITCH) };
  c.bodyYaw  = snap.bodyYaw ?? 0;
}

function pushPoseUndo(pi = phraseIdx, ci = countIdx) {
  const c = work.phrases[pi]?.counts[ci];
  if (!c) return;
  const key   = poseUndoKey(pi, ci);
  const stack = poseUndoStacks.get(key) ?? [];
  stack.push(poseSnapshot(c));
  if (stack.length > MAX_POSE_UNDO) stack.shift();
  poseUndoStacks.set(key, stack);
  updateUndoButton();
}

function undoPose() {
  const key   = poseUndoKey();
  const stack = poseUndoStacks.get(key) ?? [];
  if (!stack.length) return false;
  const prev = stack.pop();
  poseUndoStacks.set(key, stack);
  applyPoseSnapshot(current(), prev);
  selectedBoneId = null;
  selectedItemId = null;
  draw();
  showFb("1つ戻しました");
  return true;
}

function resetCurrentPose() {
  pushPoseUndo();
  const c = current();
  c.jointPos = cloneJointPos(REST_JOINT_POS);
  c.palmRot  = { handL: 0, handR: 0, footL: 0, footR: 0 };
  c.wristPitch = { handL: 0, handR: 0, footL: 0, footR: 0 };
  c.bodyYaw  = 0;
  selectedBoneId = null;
  draw();
  showFb("ポーズをリセット");
}

function updateUndoButton() {
  const btn   = document.getElementById("btnUndoPose");
  if (!btn) return;
  const stack = poseUndoStacks.get(poseUndoKey()) ?? [];
  btn.disabled = stack.length === 0;
}

function normalizeYaw(deg) {
  return ((Math.round(Number(deg)) % 360) + 360) % 360;
}

function shortestYawDelta(fromDeg, toDeg) {
  let delta = toDeg - fromDeg;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function setBodyYaw(yaw) {
  const c = current();
  const oldYaw = c.bodyYaw ?? 0;
  const newYaw = normalizeYaw(yaw);
  const _deltaYaw = shortestYawDelta(oldYaw, newYaw);
  c.bodyYaw = newYaw;

  // bodyYaw が変わっても手のひら・足裏の「世界空間での向き」を維持する。
  // 骨軸が bodyYaw と一緒に回るため、palmRot を同量だけ逆回しして相殺する。
  if (c.palmRot && Math.abs(_deltaYaw) > 0.0001) {
    for (const id of ["handL", "handR", "footL", "footR"]) {
      c.palmRot[id] = (c.palmRot[id] ?? 0) - _deltaYaw;
    }
  }

  updateBodyYawButtons();
  draw();
}

function nudgeBodyYaw(delta) {
  setBodyYaw(current().bodyYaw + delta);
}

function updateBodyYawButtons() {
  const yaw = normalizeYaw(current().bodyYaw);
  document.querySelectorAll("[data-yaw-preset]").forEach(btn => {
    const target = btn.dataset.yawPreset === "back" ? 180 : 0;
    const dist = Math.min(Math.abs(yaw - target), 360 - Math.abs(yaw - target));
    btn.classList.toggle("is-active", dist <= 2);
  });
}

function updateControls() {
  const item       = selectedItem();
  const isStraight = item?.type === "arrow";
  const isSpin     = item?.type === "spin";
  const isArrow    = isStraight || isSpin;
  const c          = current();

  if (btnDeleteItem) btnDeleteItem.disabled = !item;
  if (itemControls) {
    itemControls.classList.toggle("item-ctrl--idle", !isArrow && item?.type !== "text");
    if (itemCtrlTitle) itemCtrlTitle.textContent = isArrow ? "矢印の調整" : "テキスト";
  }

  updateBodyYawButtons();

  if (dirAngle) {
    dirAngle.disabled = !isArrow;
    if (isArrow) {
      dirAngle.value = String(Math.round(item.angle ?? 90) % 360);
      if (dirAngleLbl) dirAngleLbl.textContent = `${dirAngle.value}°`;
    }
  }
  if (dirPower) {
    dirPower.disabled = !isArrow;
    if (isArrow) {
      dirPower.value = String(Math.round((item.power ?? 0.45) * 100));
      if (dirPowerLbl) dirPowerLbl.textContent = `${dirPower.value}%`;
    }
  }
  bendRow?.classList.toggle("hidden", !isStraight);
  if (isStraight && dirBend) {
    dirBend.value = String(Math.round(item.bend ?? 0));
    if (dirBendLbl) dirBendLbl.textContent = String(Math.round(item.bend ?? 0));
  }
  tiltRow?.classList.toggle("hidden", !isArrow);
  if (isArrow && dirTilt) {
    dirTilt.value = String(Math.round(item.tilt ?? 0) % 360);
    if (dirTiltLbl) dirTiltLbl.textContent = `${dirTilt.value}°`;
  }

  const phrase = work.phrases[phraseIdx];
  if (countLabel) countLabel.textContent = countStatusLabel(phrase, countIdx);
  if (workNameEl && document.activeElement !== workNameEl) workNameEl.value = work.name ?? "";
  updateUndoButton();
}

// ─── ツール ────────────────────────────────────────────────
function setTool(tool) {
  currentTool = tool;
  document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.tool === tool);
  });
  document.getElementById("toolTextFieldWrap")?.classList.toggle("hidden", tool !== "text");

}

document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
  btn.addEventListener("click", () => setTool(btn.dataset.tool));
});

// ─── 選択 ────────────────────────────────────────────────
function selectBone(id) { selectedBoneId = id; selectedItemId = null; draw(); }
function selectItem(id) { selectedItemId = id; selectedBoneId = null; draw(); }

function deleteSelectedItem() {
  if (!selectedItemId) return;
  current().items = current().items.filter(i => i.id !== selectedItemId);
  selectedItemId  = null;
  draw();
}

// ─── ポインターイベント ─────────────────────────────────────
stageWrap?.addEventListener("pointerdown", onPointerDown, { capture: true });
stageWrap?.addEventListener("pointermove", onPointerMove);
stageWrap?.addEventListener("pointerup",   endDrag);
stageWrap?.addEventListener("pointercancel", endDrag);

function stageNorm(ev) {
  const r = stageWrap.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) / r.width,
    y: (ev.clientY - r.top)  / r.height,
  };
}

function onPointerDown(ev) {
  if (ev.target === inlineEditInput) return;
  if (ev.target.closest?.(".bone-hud")) return;
  closeInlineEdit(true);

  const { x, y } = stageNorm(ev);
  const c = current();

  // ── アノテーション配置ツール ──────────────────────────
  if (currentTool === "arrow" || currentTool === "spin" || currentTool === "text") {
    ev.preventDefault();
    const type  = currentTool === "text" ? "text" : currentTool;
    const text  = fieldMotionEl?.value.trim() || current().memo?.trim() || "メモ";
    const extra = type === "arrow" ? { bend: 0 }
                : type === "spin"  ? { angle: 30 }
                :                    { text };
    const msg = type === "text" ? `「${text}」を追加`
              : type === "arrow" ? "矢印を追加" : "回転矢印を追加";
    addAnnotItem(type, x, y, extra, msg);
    setTool("select");
    return;
  }

  // ── orbit モード ───────────────────────────────────────
  if (currentTool === "orbit") {
    dragKind = "orbit";
    stage?.orbitStart(x, y);
    stageWrap.setPointerCapture(ev.pointerId);
    return;
  }

  // ── select モード ──────────────────────────────────────

  // 1. アノテーションアイテムへのヒット
  annotCanvas.width  = annotCanvas.width  || stageWrap.clientWidth;
  annotCanvas.height = annotCanvas.height || stageWrap.clientHeight;
  const hit = hitTestItems(c.items, x, y, annotCanvas);
  if (hit) {
    const p = hit.part;
    dragKind = p === "tip" || p === "arc-end" ? "item-tip"
             : p === "rotate"                  ? "item-rotate"
             : p === "arc-start"               ? "item-arc-start"
             : p === "bend-cp"                 ? "item-bend-cp"
             :                                   "item-move";
    dragItemId = hit.item.id;
    selectItem(hit.item.id);
    ev.preventDefault();
    stageWrap.setPointerCapture(ev.pointerId);
    return;
  }

  // 2. 関節球へのヒット → 選択 + ドラッグ開始
  if (stage) {
    const boneId = stage.hitTestJoint(x, y);
    if (boneId) {
      dragUndoPushed = false;
      selectBone(boneId);
      dragKind     = "joint";
      dragBoneId   = boneId;
      prevDragNorm = { x, y };
      ev.preventDefault();
      stageWrap.setPointerCapture(ev.pointerId);
      return;
    }
  }

  // 3. 背景 → オービット
  selectedItemId = null;
  dragKind       = "orbit";
  stage?.orbitStart(x, y);
  stageWrap.setPointerCapture(ev.pointerId);
}

function onPointerMove(ev) {
  if (!dragKind) return;
  const { x, y } = stageNorm(ev);
  const c = current();

  // 関節直接ドラッグ — 選択関節のみ更新（手動デルタ）
  if (dragKind === "joint" && dragBoneId && stage) {
    if (!c.jointPos) c.jointPos = cloneJointPos(REST_JOINT_POS);
    if (!c.palmRot) c.palmRot = { ...REST_PALM_ROT };
    if (!c.wristPitch) c.wristPitch = { ...REST_WRIST_PITCH };
    const dx = prevDragNorm ? (x - prevDragNorm.x) * stageWrap.clientWidth  : 0;
    const dy = prevDragNorm ? (y - prevDragNorm.y) * stageWrap.clientHeight : 0;
    prevDragNorm = { x, y };
    if (Math.hypot(dx, dy) > 90) return;
    if (!dragUndoPushed && Math.hypot(dx, dy) > 2) {
      pushPoseUndo();
      dragUndoPushed = true;
    }
    const updates = stage.solveJointDrag(
      dragBoneId, dx, dy,
      c.jointPos, c.bodyYaw,
      ev.shiftKey, ev.altKey,
      c.palmRot, c.wristPitch,
    );
    if (updates.jointPos)   Object.assign(c.jointPos,   updates.jointPos);
    if (updates.palmRot)    Object.assign(c.palmRot,    updates.palmRot);
    if (updates.wristPitch) Object.assign(c.wristPitch, updates.wristPitch);
    if (ev.altKey && isPalmOrSoleBone(dragBoneId)) {
      updatePalmRotDisplay(
        dragBoneId,
        c.palmRot[dragBoneId] ?? 0,
        c.wristPitch[dragBoneId] ?? 0,
      );
    } else {
      clearPalmRotDisplay();
    }
    draw();
    return;
  }

  if (dragKind === "orbit") {
    stage?.orbitMove(x, y);
    return;
  }

  const item = c.items.find(i => i.id === dragItemId);
  if (!item) return;

  if      (dragKind === "item-tip")       dragItemTip(item, x, y, annotCanvas);
  else if (dragKind === "item-rotate")    dragItemRotate(item, x, y, annotCanvas);
  else if (dragKind === "item-arc-start") dragItemArcStart(item, x, y, annotCanvas);
  else if (dragKind === "item-bend-cp")   dragItemBendCP(item, x, y, annotCanvas);
  else if (dragKind === "item-move") {
    item.x = Math.max(0.05, Math.min(0.95, x));
    item.y = Math.max(0.05, Math.min(0.92, y));
  }
  draw();
}

function endDrag(ev) {
  if (dragKind === "orbit") stage?.orbitEnd();
  clearPalmRotDisplay();
  dragKind     = null;
  dragBoneId   = null;
  dragItemId   = null;
  prevDragNorm = null;
  dragUndoPushed = false;
  try { stageWrap.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
}

// ─── ダブルクリック ────────────────────────────────────────
stageWrap?.addEventListener("dblclick", ev => {
  if (ev.target.closest?.(".bone-hud")) return;
  const { x, y } = stageNorm(ev);
  const hit = hitTestItems(current().items, x, y, annotCanvas);
  if (hit?.item.type === "text") {
    ev.preventDefault();
    openInlineEdit(hit.item, ev.clientX, ev.clientY);
  }
});

function openInlineEdit(item, clientX, clientY) {
  editingItemId = item.id; selectedItemId = item.id;
  inlineEditEl.style.left = `${clientX}px`;
  inlineEditEl.style.top  = `${clientY}px`;
  inlineEditEl.classList.remove("hidden");
  inlineEditInput.value = item.text || "";
  inlineEditInput.style.fontSize = `${Math.max(12, (item.fontSize ?? 18) * 0.85)}px`;
  inlineEditInput.focus(); inlineEditInput.select();
}

function closeInlineEdit(commit = true) {
  if (!editingItemId) return;
  if (commit) {
    const item = current().items.find(i => i.id === editingItemId);
    if (item && inlineEditInput) item.text = inlineEditInput.value || item.text;
  }
  editingItemId = null;
  inlineEditEl.classList.add("hidden");
  draw();
}

inlineEditInput?.addEventListener("keydown", ev => {
  if (ev.key === "Enter" || ev.key === "Escape") {
    ev.preventDefault(); closeInlineEdit(ev.key === "Enter");
  }
});
inlineEditInput?.addEventListener("blur", () => closeInlineEdit(true));

// ─── ポーズリセット / 戻る ────────────────────────────────────
document.getElementById("btnResetPose")?.addEventListener("click", resetCurrentPose);
document.getElementById("btnUndoPose")?.addEventListener("click", () => undoPose());

// ─── 体の向き ──────────────────────────────────────────────
document.getElementById("btnBodyYawLeft")?.addEventListener("click", () => {
  nudgeBodyYaw(-BODY_YAW_STEP);
});
document.getElementById("btnBodyYawRight")?.addEventListener("click", () => {
  nudgeBodyYaw(BODY_YAW_STEP);
});
document.querySelectorAll("[data-yaw-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    setBodyYaw(btn.dataset.yawPreset === "back" ? 180 : 0);
  });
});

// ─── フレーズ管理 ──────────────────────────────────────────
document.getElementById("btnAddPhrase")?.addEventListener("click", () => {
  work.phrases.push(makePhrase(work.phrases.length));
  switchToCount(work.phrases.length - 1, 0);
});

// ─── 作品名 ────────────────────────────────────────────────
workNameEl?.addEventListener("input", () => { work.name = workNameEl.value; scheduleSave(); });
document.getElementById("btnSaveWork")?.addEventListener("click", () => {
  saveWork();
  saveCurrentToLibrary();
  renderWorkLibrary();
  if (saveHint) { saveHint.textContent = "✓ 保存"; setTimeout(() => { saveHint.textContent = ""; }, 2500); }
});
document.getElementById("btnNewWork")?.addEventListener("click", () => {
  if (!confirm("現在の内容を破棄して新しい作品を始めますか？")) return;
  work = makeWork();
  switchToCount(0, 0);
  renderWorkLibrary();
});

// ─── アノテーション追加 ────────────────────────────────────
function showFb(msg) {
  if (!addFeedback) return;
  addFeedback.textContent = msg;
  clearTimeout(addFbTimer);
  addFbTimer = setTimeout(() => { addFeedback.textContent = ""; }, 3000);
}
function flashStage() {
  stageWrap?.classList.remove("canvas-stack--added");
  void stageWrap?.offsetWidth;
  stageWrap?.classList.add("canvas-stack--added");
  setTimeout(() => stageWrap?.classList.remove("canvas-stack--added"), 600);
}
function addAnnotItem(type, x, y, extra = {}, msg) {
  const item = createItem(type, x, y, extra);
  current().items.push(item);
  selectItem(item.id); showFb(msg); flashStage();
}

document.getElementById("btnAddStraightArrow")?.addEventListener("click", () => setTool("arrow"));
document.getElementById("btnAddSpinArrow")    ?.addEventListener("click", () => setTool("spin"));
document.getElementById("btnAddText")         ?.addEventListener("click", () => setTool("text"));

// ─── アイテムスライダー ────────────────────────────────────
function bindSlider(el, fn) {
  el?.addEventListener("input", () => {
    const item = selectedItem();
    if (!item) return;
    fn(item);
    updateControls();
    drawAnnotCanvas(annotCanvas, current().items, selectedItemId);
  });
}
bindSlider(dirAngle, item => { item.angle = Number(dirAngle.value); });
bindSlider(dirPower, item => { item.power = Number(dirPower.value) / 100; });
bindSlider(dirBend,  item => { item.bend  = Number(dirBend.value); });
bindSlider(dirTilt,  item => { item.tilt  = Number(dirTilt.value); });
btnDeleteItem?.addEventListener("click", deleteSelectedItem);

// ─── キーボード ────────────────────────────────────────────
document.addEventListener("keydown", ev => {
  if (ev.target === inlineEditInput) return;
  if (ev.target.matches("input, textarea")) return;

  if (ev.key === "?" || ev.key === "/") { ev.preventDefault(); toggleKbdOverlay(); return; }
  if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
    ev.preventDefault();
    const next = countIdx + (ev.key === "ArrowRight" ? 1 : -1);
    const len = work.phrases[phraseIdx].counts.length;
    switchToCount(phraseIdx, Math.max(0, Math.min(len - 1, next)));
    return;
  }
  if (ev.key === "Escape") {
    const overlay = document.getElementById("kbdOverlay");
    if (overlay && !overlay.classList.contains("hidden")) { toggleKbdOverlay(); return; }
    selectedBoneId = null; setTool("select"); draw(); return;
  }
  if ((ev.key === "Delete" || ev.key === "Backspace") && selectedItemId) {
    ev.preventDefault(); deleteSelectedItem();
  }
});

// ─── フレーズ名リネーム ────────────────────────────────────
function startPhraseRename(pi, labelEl) {
  if (renamingPhraseIdx !== -1) return;
  renamingPhraseIdx = pi;
  const phrase = work.phrases[pi];

  const input = document.createElement("input");
  input.type = "text";
  input.value = phrase.label;
  input.className = "phrase-label-input";
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    renamingPhraseIdx = -1;
    const trimmed = input.value.trim();
    if (trimmed) phrase.label = trimmed;
    scheduleSave();
    rebuildTimeline();
    syncCountUI();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", ev => {
    if (ev.key === "Enter")  { ev.preventDefault(); input.blur(); }
    if (ev.key === "Escape") { ev.preventDefault(); input.value = phrase.label; input.blur(); }
  });
}

// ─── 曲の構成（俯瞰パネル） ──────────────────────────────────
function renderSongOverview() {
  const list = document.getElementById("songOverviewList");
  if (!list) return;
  list.innerHTML = "";

  work.phrases.forEach((phrase, pi) => {
    const row = document.createElement("div");
    row.className = "overview-phrase-row" + (pi === phraseIdx ? " is-active-phrase" : "");

    const label = document.createElement("div");
    label.className = "overview-phrase-label";
    label.textContent = phrase.label;
    label.addEventListener("click", () => switchToCount(pi, 0));
    row.appendChild(label);

    const chips = document.createElement("div");
    chips.className = "overview-chips";
    phrase.counts.forEach((count, ci) => {
      const chip = document.createElement("div");
      chip.className = "overview-chip";
      if (pi === phraseIdx && ci === countIdx) chip.classList.add("is-current");
      if (count.memo?.trim())      chip.classList.add("has-memo");
      if (hasPoseContent(count))   chip.classList.add("has-pose");
      if (count.items?.length > 0) chip.classList.add("has-items");

      chip.title = [
        `${phrase.label}-${ci + 1}`,
        count.memo?.trim() || "",
        count.items?.length ? `矢印・文字 ${count.items.length}件` : "",
      ].filter(Boolean).join("\n");

      chip.addEventListener("click", () => switchToCount(pi, ci));
      chips.appendChild(chip);
    });
    row.appendChild(chips);
    list.appendChild(row);
  });
}

function addCountAfter() {
  const phrase = work.phrases[phraseIdx];
  phrase.counts.splice(countIdx + 1, 0, makeCount(countIdx + 2));
  scheduleSave(); rebuildTimeline(); renderSongOverview();
}

function addCountBefore() {
  const phrase = work.phrases[phraseIdx];
  phrase.counts.splice(countIdx, 0, makeCount(countIdx + 1));
  countIdx++;
  scheduleSave(); rebuildTimeline(); renderSongOverview();
}

function removeCurrentCount() {
  const phrase = work.phrases[phraseIdx];
  if (phrase.counts.length <= 1) return;
  phrase.counts.splice(countIdx, 1);
  countIdx = Math.min(countIdx, phrase.counts.length - 1);
  selectedBoneId = null; selectedItemId = null;
  syncCountUI(); rebuildTimeline(); draw();
  scheduleSave();
}

function addCountAtEnd() {
  const phrase = work.phrases[phraseIdx];
  phrase.counts.push(makeCount(phrase.counts.length + 1));
  scheduleSave(); rebuildTimeline(); renderSongOverview();
}

// ─── タイムライン ──────────────────────────────────────────
function scrollActiveChipIntoView() {
  requestAnimationFrame(() => {
    document.querySelector(".phrase-row-wrap.is-active-phrase-wrap .count-chip.is-active")
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  });
}

function rebuildTimeline() {
  if (renamingPhraseIdx !== -1) return;
  const container = document.getElementById("phraseTimeline");
  if (!container) return;
  container.innerHTML = "";

  work.phrases.forEach((phrase, pi) => {
    const wrap = document.createElement("div");
    wrap.className = "phrase-row-wrap" + (pi === phraseIdx ? " is-active-phrase-wrap" : "");

    const row  = document.createElement("div");
    row.className = "phrase-row";

    const lbl  = document.createElement("span");
    lbl.className = "phrase-label";
    lbl.textContent = phrase.label;
    lbl.title = "クリックしてフレーズ名を変更";
    lbl.addEventListener("click", () => startPhraseRename(pi, lbl));
    row.appendChild(lbl);

    const chips = document.createElement("div");
    chips.className = "phrase-counts";

    phrase.counts.forEach((count, ci) => {
      if (ci > 0 && ci % 4 === 0) {
        const d = document.createElement("span");
        d.className = "count-divider";
        d.title = "4拍ごと";
        chips.appendChild(d);
      }
      const btn  = document.createElement("button");
      btn.type = "button";
      btn.className = "count-chip";
      const num = ci + 1;
      btn.textContent = `${phrase.label}${num}`;
      btn.title = `${phrase.label} の ${num} 拍目${hasContent(count) ? "（ポーズあり）" : ""}`;
      if (pi === phraseIdx && ci === countIdx) btn.classList.add("is-active");
      if (hasContent(count)) btn.classList.add("has-pose");
      btn.addEventListener("click", () => switchToCount(pi, ci));
      chips.appendChild(btn);
    });
    row.appendChild(chips);

    if (work.phrases.length > 1) {
      const del = document.createElement("button");
      del.type = "button"; del.className = "btn-phrase-del"; del.textContent = "×";
      del.addEventListener("click", () => {
        if (!confirm(`フレーズ ${phrase.label} を削除しますか？`)) return;
        work.phrases.splice(pi, 1);
        if (phraseIdx >= work.phrases.length) phraseIdx = work.phrases.length - 1;
        const len = work.phrases[phraseIdx].counts.length;
        switchToCount(phraseIdx, Math.min(countIdx, len - 1));
      });
      row.appendChild(del);
    }
    wrap.appendChild(row);

    if (pi === phraseIdx) {
      const tools = document.createElement("div");
      tools.className = "count-tools-row";

      const btnPre = document.createElement("button");
      btnPre.type = "button";
      btnPre.className = "btn-count-add";
      btnPre.textContent = "前へ追加";
      btnPre.title = "今の拍の前に新しいカウントを挿入";
      btnPre.addEventListener("click", () => addCountBefore());
      tools.appendChild(btnPre);

      const btnPost = document.createElement("button");
      btnPost.type = "button";
      btnPost.className = "btn-count-add";
      btnPost.textContent = "後ろへ追加";
      btnPost.title = "このフレーズの最後にカウントを追加";
      btnPost.addEventListener("click", () => addCountAtEnd());
      tools.appendChild(btnPost);

      const btnDelCount = document.createElement("button");
      btnDelCount.type = "button";
      btnDelCount.className = "btn-count-del";
      btnDelCount.textContent = "削除";
      btnDelCount.title = "今選んでいるカウントを削除";
      btnDelCount.disabled = phrase.counts.length <= 1;
      btnDelCount.addEventListener("click", () => removeCurrentCount());
      tools.appendChild(btnDelCount);

      wrap.appendChild(tools);
    }

    container.appendChild(wrap);
  });
  scrollActiveChipIntoView();
  renderSongOverview();
}
function exportWork() {
  const json  = JSON.stringify(work, null, 2);
  const blob  = new Blob([json], { type: "application/json" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  const date  = new Date().toISOString().slice(0, 10);
  a.href      = url;
  a.download  = `${work.name || "dance-note"}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showFb("ファイルを書き出しました");
}

function importWork() {
  const input = document.createElement("input");
  input.type  = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const w    = JSON.parse(text);
      if (!Array.isArray(w?.phrases) || !w.phrases.length) {
        alert("有効な振り付けファイルではありません。");
        return;
      }
      const name = w.name || "無名";
      if (!confirm(`「${name}」を読み込みます。\n現在の内容は上書きされます。よろしいですか？`)) return;
      for (const phrase of w.phrases) {
        for (const c of phrase.counts) sanitizeCount(c);
      }
      work      = w;
      phraseIdx = 0;
      countIdx  = 0;
      saveWork();
      rebuildTimeline();
      syncCountUI();
      renderPoseLibrary();
      draw();
      saveCurrentToLibrary();
      renderWorkLibrary();
      showFb(`「${name}」を読み込みました`);
    } catch (e) {
      console.error("import error:", e);
      alert("ファイルの読み込みに失敗しました。");
    }
  });
  input.click();
}

document.getElementById("btnExport")?.addEventListener("click", exportWork);
document.getElementById("btnImport")?.addEventListener("click", importWork);

// ─── キーボードショートカット オーバーレイ ────────────────
function toggleKbdOverlay() {
  document.getElementById("kbdOverlay")?.classList.toggle("hidden");
}
document.getElementById("btnHelp")?.addEventListener("click", toggleKbdOverlay);
document.getElementById("btnCloseKbd")?.addEventListener("click", toggleKbdOverlay);
document.getElementById("kbdOverlay")?.addEventListener("click", ev => {
  if (ev.target === ev.currentTarget) toggleKbdOverlay();
});

// ─── リサイズ ──────────────────────────────────────────────
function onResize() {
  const w = viewport3d?.clientWidth  || stageWrap?.clientWidth  || 0;
  const h = viewport3d?.clientHeight || stageWrap?.clientHeight || 0;
  if (w < 1 || h < 1) return;
  stage?.resize(w, h);
  annotCanvas.width  = w;
  annotCanvas.height = h;
  draw();
}

// ─── 起動 ─────────────────────────────────────────────────
function showStageError(msg) {
  if (!viewport3d) return;
  viewport3d.innerHTML =
    `<p style="color:#ffbf00;padding:16px;font-size:13px;line-height:1.6">${msg}</p>`;
}

function initApp() {
  if (!viewport3d) {
    console.error("viewport3d が見つかりません");
    return;
  }

  // 保存データの破損で NaN が出ないよう全カウントを正規化
  for (const phrase of work.phrases) {
    for (const c of phrase.counts) sanitizeCount(c);
  }

  try {
    stage = createStage(viewport3d);
  } catch (e) {
    console.error("Three.js の初期化に失敗しました:", e);
    showStageError(
      "3D表示を起動できませんでした。<br>ページを再読み込み（Cmd+Shift+R）してください。"
    );
    return;
  }

  const w = Math.max(stageWrap?.clientWidth || 0, viewport3d.clientWidth || 440);
  const h = Math.max(stageWrap?.clientHeight || 0, viewport3d.clientHeight || 560);
  annotCanvas.width  = w;
  annotCanvas.height = h;
  stage.resize(w, h);

  setTool("select");
  rebuildTimeline();
  try { syncCountUI(); } catch (e) { console.error(e); }
  renderPoseLibrary();
  renderWorkLibrary();
  renderSongOverview();
  draw();
}

function boot() {
  if (typeof ResizeObserver !== "undefined" && viewport3d) {
    new ResizeObserver(onResize).observe(stageWrap ?? viewport3d);
  }
  window.addEventListener("resize", onResize);
  // レイアウト確定後に 3D を起動（2フレーム待ち）
  requestAnimationFrame(() => requestAnimationFrame(initApp));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
