/**
 * app.js — Dance Sequence Note
 *
 * 操作体系:
 *   - 関節ドラッグ → 粘土細工型 6DOF（平行移動 + 回転・制限なし）
 *   - 肩の上下ドラッグ → 肩すくめ / 肩下制
 *   - カウント切替 → ポーズ・矢印・メモを同期表示
 *   - 背景ドラッグ → 視点変更
 *   - ツールバー → アノテーション追加モード
 */
import {
  BONE_DEFS, BONE_LABELS, REST_POSE, REST_POSE_POS,
  cloneBoneRot, cloneBonePos, sanitizeBoneRot, sanitizeBonePos, sanitizeBoneScale,
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

const bodyYawEl    = document.getElementById("bodyYaw");
const countLabel   = document.getElementById("currentCountLabel");
const countMemoEl  = document.getElementById("countMemo");
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
const LS_KEY        = "dance-studio-v5";
const LS_POSES_KEY  = "dance-studio-v5-poses";
const COUNTS_PER_PHRASE = 16;
const PLAY_INTERVAL_MS  = 550;
const MAX_POSE_UNDO     = 32;

// カウントごとのポーズ Undo 履歴（保存しない）
const poseUndoStacks = new Map();

// ─── 状態 ────────────────────────────────────────────────────
let work       = loadWork() ?? makeWork();
let phraseIdx  = 0;
let countIdx   = 0;

let selectedBoneId = null;
let selectedItemId = null;
let editingItemId  = null;

let dragKind      = null;   // "joint" | "orbit" | "item-*"
let dragBoneId    = null;
let dragItemId    = null;
let prevDragNorm  = null;   // 直前フレームの正規化ポインタ位置 {x, y}
let dragUndoPushed = false; // 今回のドラッグで Undo を積んだか

let addFbTimer  = 0;
let saveTimer   = 0;
let playTimer   = 0;
let isPlaying   = false;
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

function makeCount(n) {
  return {
    n,
    boneRot:   cloneBoneRot(REST_POSE),
    bonePos:   cloneBonePos(REST_POSE_POS),
    items:     [],
    memo:      "",
    bodyYaw:   0,
    headYaw:   0,
    boneScale: { armScale: 1, legScale: 1 },
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
  const br = c.boneRot ?? {};
  for (const id of Object.keys(REST_POSE)) {
    const r = br[id] ?? [0, 0, 0];
    if (Math.abs(r[0]) > 2 || Math.abs(r[1]) > 2 || Math.abs(r[2]) > 2) return true;
  }
  const bp = c.bonePos ?? {};
  for (const id of Object.keys(REST_POSE_POS)) {
    const p = bp[id] ?? [0, 0, 0];
    if (Math.abs(p[0]) > 0.01 || Math.abs(p[1]) > 0.01 || Math.abs(p[2]) > 0.01) return true;
  }
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

function sanitizeCount(c) {
  c.boneRot   = sanitizeBoneRot(c.boneRot);
  c.bonePos   = sanitizeBonePos(c.bonePos);
  c.items     ??= [];
  c.memo      ??= "";
  c.headYaw   = Number.isFinite(Number(c.headYaw)) ? Number(c.headYaw) : 0;
  c.bodyYaw   = Number.isFinite(Number(c.bodyYaw)) ? Number(c.bodyYaw) : 0;
  c.boneScale = sanitizeBoneScale(c.boneScale);
  return c;
}

function copyCountFull(src, dst) {
  dst.boneRot   = sanitizeBoneRot(src.boneRot);
  dst.bonePos   = sanitizeBonePos(src.bonePos);
  dst.bodyYaw   = Number.isFinite(Number(src.bodyYaw)) ? Number(src.bodyYaw) : 0;
  dst.headYaw   = Number.isFinite(Number(src.headYaw)) ? Number(src.headYaw) : 0;
  dst.boneScale = sanitizeBoneScale(src.boneScale);
  dst.memo      = src.memo ?? "";
  dst.items     = cloneItems(src.items);
}

function applyPoseData(target, source, label) {
  if (target === current()) pushPoseUndo();
  target.boneRot   = sanitizeBoneRot(source.boneRot);
  target.bonePos   = sanitizeBonePos(source.bonePos);
  target.bodyYaw   = Number.isFinite(Number(source.bodyYaw)) ? Number(source.bodyYaw) : 0;
  target.headYaw   = Number.isFinite(Number(source.headYaw)) ? Number(source.headYaw) : 0;
  target.boneScale = sanitizeBoneScale(source.boneScale);
  selectedBoneId   = null;
  selectedItemId   = null;
  draw();
  if (label) showFb(`${label} のポーズを適用`);
}

function switchToCount(pi, ci) {
  stopPlay();
  phraseIdx = pi;
  countIdx  = ci;
  selectedItemId = null;
  selectedBoneId = null;
  syncCountUI();
  rebuildTimeline();
  draw();
}

function syncCountUI() {
  const c      = current();
  const phrase = work.phrases[phraseIdx];

  if (countLabel) countLabel.textContent = `${phrase.label} – ${countIdx + 1}`;

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

// ─── ポーズライブラリ ────────────────────────────────────────
function loadPoseLibrary() {
  try { return JSON.parse(localStorage.getItem(LS_POSES_KEY)) ?? []; } catch { return []; }
}
function savePoseLibrary() {
  try { localStorage.setItem(LS_POSES_KEY, JSON.stringify(poseLibrary)); } catch { /* ignore */ }
}

function renderCountReferences() {
  const list = document.getElementById("countRefList");
  if (!list) return;
  list.innerHTML = "";

  let found = false;
  work.phrases.forEach((phrase, pi) => {
    phrase.counts.forEach((count, ci) => {
      if (pi === phraseIdx && ci === countIdx) return;
      if (!hasPoseContent(count) && !count.memo?.trim() && !(count.items?.length)) return;
      found = true;

      const label   = countDisplayLabel(pi, ci);
      const preview = count.memo?.trim()
        || (count.items?.length ? `矢印・文字 ${count.items.length}件` : "ポーズあり");

      const item = document.createElement("div");
      item.className = "count-ref-item";

      const meta = document.createElement("div");
      meta.className = "count-ref-meta";
      const lbl = document.createElement("span");
      lbl.className = "count-ref-label";
      lbl.textContent = label;
      const prev = document.createElement("span");
      prev.className = "count-ref-preview";
      prev.textContent = preview;
      meta.appendChild(lbl);
      meta.appendChild(prev);

      const gotoBtn = document.createElement("button");
      gotoBtn.type = "button";
      gotoBtn.className = "pose-item-goto";
      gotoBtn.textContent = "参照";
      gotoBtn.title = `${label} を開く`;
      gotoBtn.addEventListener("click", () => switchToCount(pi, ci));

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "pose-item-apply";
      applyBtn.textContent = "適用";
      applyBtn.title = `${label} のポーズを現在のカウントに適用`;
      applyBtn.addEventListener("click", () => applyPoseData(current(), count, label));

      item.appendChild(meta);
      item.appendChild(gotoBtn);
      item.appendChild(applyBtn);
      list.appendChild(item);
    });
  });

  if (!found) {
    const empty = document.createElement("div");
    empty.className = "pose-empty";
    empty.textContent = "他カウントにデータがありません";
    list.appendChild(empty);
  }
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
        boneRot: pose.boneRot, bonePos: pose.bonePos,
        bodyYaw: pose.bodyYaw ?? 0, headYaw: pose.headYaw ?? 0,
        boneScale: pose.boneScale ?? {},
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
    boneRot: cloneBoneRot(c.boneRot),
    bonePos: cloneBonePos(c.bonePos),
    bodyYaw: c.bodyYaw ?? 0,
    headYaw: c.headYaw ?? 0,
    boneScale: { ...(c.boneScale ?? {}) },
  });
  savePoseLibrary();
  renderPoseLibrary();
  if (input) input.value = "";
  showFb(`「${name}」を保存`);
});

countMemoEl?.addEventListener("input", () => setCountMemo(countMemoEl.value));
fieldMotionEl?.addEventListener("input", () => setCountMemo(fieldMotionEl.value));

// ─── レンダリング ────────────────────────────────────────────
function draw() {
  const c = current();
  if (!c) return;
  sanitizeCount(c);
  try {
    stage?.render(c.boneRot, {
      bodyYaw:        c.bodyYaw,
      headYaw:        c.headYaw ?? 0,
      selectedBoneId,
      boneScale:      c.boneScale,
      bonePos:        c.bonePos,
    });
  } catch (e) {
    console.error("3D 描画エラー:", e);
  }
  try {
    drawAnnotCanvas(annotCanvas, c.items ?? [], selectedItemId);
  } catch (e) {
    console.error("アノテーション描画エラー:", e);
  }
  updateControls();
  scheduleSave();
}

// ─── ポーズ Undo / リセット ─────────────────────────────────
function poseUndoKey(pi = phraseIdx, ci = countIdx) {
  return `${pi}-${ci}`;
}

function poseSnapshot(c) {
  return {
    boneRot:   cloneBoneRot(c.boneRot),
    bonePos:   cloneBonePos(c.bonePos),
    bodyYaw:   c.bodyYaw ?? 0,
    headYaw:   c.headYaw ?? 0,
    boneScale: sanitizeBoneScale(c.boneScale),
  };
}

function applyPoseSnapshot(c, snap) {
  c.boneRot   = cloneBoneRot(snap.boneRot);
  c.bonePos   = cloneBonePos(snap.bonePos);
  c.bodyYaw   = snap.bodyYaw ?? 0;
  c.headYaw   = snap.headYaw ?? 0;
  c.boneScale = sanitizeBoneScale(snap.boneScale);
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
  c.boneRot   = cloneBoneRot(REST_POSE);
  c.bonePos   = cloneBonePos(REST_POSE_POS);
  c.bodyYaw   = 0;
  c.headYaw   = 0;
  c.boneScale = { armScale: 1, legScale: 1 };
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

  if (bodyYawEl) bodyYawEl.value = String(Math.round(c.bodyYaw) % 360);

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
  if (countLabel) countLabel.textContent = `${phrase.label} – ${countIdx + 1}`;
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
    if (!c.bonePos) c.bonePos = cloneBonePos(REST_POSE_POS);
    const dx = prevDragNorm ? (x - prevDragNorm.x) * stageWrap.clientWidth  : 0;
    const dy = prevDragNorm ? (y - prevDragNorm.y) * stageWrap.clientHeight : 0;
    prevDragNorm = { x, y };
    // 初回スパイク（クリック直後のジャンプ）を無視
    if (Math.hypot(dx, dy) > 90) return;
    if (!dragUndoPushed && Math.hypot(dx, dy) > 2) {
      pushPoseUndo();
      dragUndoPushed = true;
    }
    const updates = stage.solveJointDrag(
      dragBoneId, x, y, dx, dy, c.boneRot, c.bonePos, c.bodyYaw,
    );
    if (updates.boneRot) Object.assign(c.boneRot, updates.boneRot);
    if (updates.bonePos) Object.assign(c.bonePos, updates.bonePos);
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

// ─── Body Yaw ──────────────────────────────────────────────
bodyYawEl?.addEventListener("input", () => { current().bodyYaw = Number(bodyYawEl.value); draw(); });

// ─── ビュープリセット ──────────────────────────────────────
document.querySelectorAll("[data-view]").forEach(btn => {
  const ANGLE = { front: 0, diag: 45, side: 85 };
  btn.addEventListener("click", () => {
    current().bodyYaw = ANGLE[btn.dataset.view] ?? 0;
    if (bodyYawEl) bodyYawEl.value = String(current().bodyYaw);
    draw();
  });
});

// ─── トランスポート ────────────────────────────────────────
document.getElementById("btnFirst")?.addEventListener("click", () => {
  switchToCount(phraseIdx, 0);
});
document.getElementById("btnLast")?.addEventListener("click", () => {
  switchToCount(phraseIdx, COUNTS_PER_PHRASE - 1);
});
document.getElementById("btnNext")?.addEventListener("click", () => {
  if (countIdx < COUNTS_PER_PHRASE - 1) switchToCount(phraseIdx, countIdx + 1);
});
document.getElementById("btnStop")?.addEventListener("click", () => {
  stopPlay();
  selectedItemId = null;
  selectedBoneId = null;
  draw();
});
document.getElementById("btnPlay")?.addEventListener("click", togglePlay);

function togglePlay() { isPlaying ? stopPlay() : startPlay(); }
function startPlay() {
  isPlaying = true;
  const btn = document.getElementById("btnPlay");
  if (btn) btn.textContent = "⏸";
  playTimer = setInterval(() => {
    switchToCount(phraseIdx, (countIdx + 1) % COUNTS_PER_PHRASE);
  }, PLAY_INTERVAL_MS);
}

function stopPlay() {
  isPlaying = false; clearInterval(playTimer);
  const btn = document.getElementById("btnPlay");
  if (btn) btn.textContent = "▶";
}

// ─── カウントコピー ────────────────────────────────────────
document.getElementById("btnCopyCount")?.addEventListener("click", () => {
  const nextIdx = countIdx + 1;
  if (nextIdx < COUNTS_PER_PHRASE) {
    const srcLabel = countDisplayLabel(phraseIdx, countIdx);
    pushPoseUndo(phraseIdx, nextIdx);
    copyCountFull(current(), work.phrases[phraseIdx].counts[nextIdx]);
    switchToCount(phraseIdx, nextIdx);
    showFb(`${srcLabel} → ${countDisplayLabel(phraseIdx, nextIdx)} にコピー`);
  }
});
document.getElementById("btnActi")?.addEventListener("click", () => {
  document.getElementById("btnCopyCount")?.click();
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
  if (saveHint) { saveHint.textContent = "✓ 保存"; setTimeout(() => { saveHint.textContent = ""; }, 2500); }
});
document.getElementById("btnNewWork")?.addEventListener("click", () => {
  if (!confirm("現在の内容を破棄して新しい作品を始めますか？")) return;
  work = makeWork();
  switchToCount(0, 0);
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

  if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
    ev.preventDefault(); stopPlay();
    const next = countIdx + (ev.key === "ArrowRight" ? 1 : -1);
    switchToCount(phraseIdx, Math.max(0, Math.min(COUNTS_PER_PHRASE - 1, next)));
    return;
  }
  if (ev.key === "Escape") { selectedBoneId = null; setTool("select"); draw(); return; }
  if ((ev.key === "Delete" || ev.key === "Backspace") && selectedItemId) {
    ev.preventDefault(); deleteSelectedItem();
  }
});

// ─── タイムライン ──────────────────────────────────────────
function rebuildTimeline() {
  const container = document.getElementById("phraseTimeline");
  if (!container) return;
  container.innerHTML = "";

  work.phrases.forEach((phrase, pi) => {
    const row  = document.createElement("div");
    row.className = "phrase-row";
    const lbl  = document.createElement("span");
    lbl.className = "phrase-label"; lbl.textContent = phrase.label;
    row.appendChild(lbl);
    const chips = document.createElement("div");
    chips.className = "phrase-counts";

    phrase.counts.forEach((count, ci) => {
      if (ci === 8) { const d = document.createElement("span"); d.className = "count-divider"; chips.appendChild(d); }
      const btn  = document.createElement("button");
      btn.type      = "button"; btn.className = "count-chip"; btn.textContent = ci + 1;
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
        switchToCount(phraseIdx, Math.min(countIdx, COUNTS_PER_PHRASE - 1));
      });
      row.appendChild(del);
    }
    container.appendChild(row);
  });
}

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
