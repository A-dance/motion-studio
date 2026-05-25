/**
 * app.js — Dance Sequence Note メインアプリ
 *
 * ポーズ = boneRot { boneId: [pitchX, yawY, rollZ] }（度数）
 * 操作  = ギズモリング（X:赤 / Y:緑 / Z:青）をドラッグして回転
 * 旧来の座標ベース IK / enrichPoseHands は廃止。
 */
import {
  BONE_DEFS, BONE_LABELS, REST_POSE,
  cloneBoneRot, clampBoneRot,
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
const bodyYawLbl   = document.getElementById("bodyYawLbl");
const headYawEl    = document.getElementById("headYaw");
const headYawLbl   = document.getElementById("headYawLbl");

const armScaleEl   = document.getElementById("armScale");
const armScaleLbl  = document.getElementById("armScaleLbl");
const legScaleEl   = document.getElementById("legScale");
const legScaleLbl  = document.getElementById("legScaleLbl");

const selectedBoneLbl = document.getElementById("selectedBoneLbl");

const dirAngle    = document.getElementById("dirAngle");
const dirAngleLbl = document.getElementById("dirAngleLbl");
const dirPower    = document.getElementById("dirPower");
const dirPowerLbl = document.getElementById("dirPowerLbl");
const dirBend     = document.getElementById("dirBend");
const dirBendLbl  = document.getElementById("dirBendLbl");
const dirTilt     = document.getElementById("dirTilt");
const dirTiltLbl  = document.getElementById("dirTiltLbl");
const bendRow     = document.getElementById("bendRow");
const tiltRow     = document.getElementById("tiltRow");

const itemControls  = document.getElementById("itemControls");
const itemCtrlTitle = document.getElementById("itemCtrlTitle");
const btnDeleteItem = document.getElementById("btnDeleteItem");

const addFeedback   = document.getElementById("addFeedback");
const countLabel    = document.getElementById("currentCountLabel");
const workNameEl    = document.getElementById("workName");
const saveHint      = document.getElementById("saveHint");

const inlineEditEl    = document.getElementById("inlineEdit");
const inlineEditInput = document.getElementById("inlineEditInput");

// ─── 定数 ────────────────────────────────────────────────────
const LS_KEY            = "dance-studio-v5";   // 旧 v4 と互換なし（新フォーマット）
const COUNTS_PER_PHRASE = 16;

// ドラッグ感度: 度数 / ピクセル
const GIZMO_SENSITIVITY = 0.45;

// ─── 状態 ────────────────────────────────────────────────────
let work           = loadWork() ?? makeWork();
let phraseIdx      = 0;
let countIdx       = 0;

let selectedBoneId = null;   // 選択中ボーン
let selectedItemId = null;   // 選択中アノテーション
let editingItemId  = null;

let dragKind   = null;
// "gizmo-x" | "gizmo-y" | "gizmo-z" | "item-*" | "orbit"
let dragItemId = null;

let addFbTimer = 0;
let saveTimer  = 0;
let stage      = null;

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
    items:     [],
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

function current() {
  return work.phrases[phraseIdx].counts[countIdx];
}

function selectedItem() {
  return current().items.find(i => i.id === selectedItemId) ?? null;
}

/** ポーズが REST と異なるか（タイムラインのマーカー用） */
function hasContent(c) {
  if (!c) return false;
  if (c.items?.length > 0) return true;
  if (Math.abs(c.bodyYaw ?? 0) > 1 || Math.abs(c.headYaw ?? 0) > 1) return true;
  const br = c.boneRot ?? {};
  for (const id of Object.keys(REST_POSE)) {
    const r = br[id] ?? [0, 0, 0];
    if (Math.abs(r[0]) > 2 || Math.abs(r[1]) > 2 || Math.abs(r[2]) > 2) return true;
  }
  return false;
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
    // 各カウントを最新構造に補完
    for (const phrase of w.phrases) {
      for (const c of phrase.counts) {
        if (!c.boneRot) c.boneRot = cloneBoneRot(REST_POSE);
        else {
          // 新しいボーンが増えた場合に REST_POSE で補完
          for (const id of Object.keys(REST_POSE)) {
            if (!c.boneRot[id]) c.boneRot[id] = [0, 0, 0];
          }
        }
        c.items     = c.items     ?? [];
        c.headYaw   = c.headYaw   ?? 0;
        c.bodyYaw   = c.bodyYaw   ?? 0;
        c.boneScale = c.boneScale ?? { armScale: 1, legScale: 1 };
      }
    }
    return w;
  } catch { return null; }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWork, 800);
}

// ─── レンダリング ────────────────────────────────────────────
function draw() {
  const c = current();
  stage?.render(c.boneRot, {
    bodyYaw:        c.bodyYaw,
    headYaw:        c.headYaw ?? 0,
    selectedBoneId,
    boneScale:      c.boneScale ?? {},
  });
  drawAnnotCanvas(annotCanvas, c.items, selectedItemId);
  updateControls();
  scheduleSave();
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

  // 選択ボーン表示
  if (selectedBoneLbl) {
    selectedBoneLbl.textContent = selectedBoneId
      ? `選択: ${BONE_LABELS[selectedBoneId] ?? selectedBoneId}`
      : "関節をクリックして選択";
  }

  // Body yaw
  if (bodyYawEl) {
    bodyYawEl.value = String(Math.round(c.bodyYaw) % 360);
    if (bodyYawLbl) bodyYawLbl.textContent = `${bodyYawEl.value}°`;
  }
  // Head yaw
  if (headYawEl) {
    headYawEl.value = String(Math.round(c.headYaw ?? 0));
    if (headYawLbl) headYawLbl.textContent = `${headYawEl.value}°`;
  }
  // Bone scale
  const { armScale = 1, legScale = 1 } = c.boneScale ?? {};
  if (armScaleEl) {
    armScaleEl.value = String(armScale);
    if (armScaleLbl) armScaleLbl.textContent = `×${Number(armScale).toFixed(2)}`;
  }
  if (legScaleEl) {
    legScaleEl.value = String(legScale);
    if (legScaleLbl) legScaleLbl.textContent = `×${Number(legScale).toFixed(2)}`;
  }

  // 矢印スライダー
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

  // カウントラベル
  const phrase = work.phrases[phraseIdx];
  if (countLabel) countLabel.textContent = `${phrase.label} – ${countIdx + 1}`;
  if (workNameEl && document.activeElement !== workNameEl) workNameEl.value = work.name ?? "";
}

// ─── 選択 ─────────────────────────────────────────────────────
function selectBone(id) {
  selectedBoneId = id;
  selectedItemId = null;
  draw();
}

function selectItem(id) {
  selectedItemId = id;
  selectedBoneId = null;
  draw();
}

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
  closeInlineEdit(true);

  const { x, y } = stageNorm(ev);
  const c = current();

  // 1. ギズモリングへのヒット（ボーン選択中のみ）
  if (stage && selectedBoneId) {
    const axis = stage.hitTestGizmo(x, y);
    if (axis) {
      dragKind = `gizmo-${axis}`;
      ev.preventDefault();
      stageWrap.setPointerCapture(ev.pointerId);
      return;
    }
  }

  // 2. アノテーションアイテムへのヒット
  annotCanvas.width  = annotCanvas.width  || stageWrap.clientWidth;
  annotCanvas.height = annotCanvas.height || stageWrap.clientHeight;
  const hit = hitTestItems(c.items, x, y, annotCanvas);
  if (hit) {
    const p = hit.part;
    if      (p === "tip" || p === "arc-end") dragKind = "item-tip";
    else if (p === "rotate")    dragKind = "item-rotate";
    else if (p === "arc-start") dragKind = "item-arc-start";
    else if (p === "bend-cp")   dragKind = "item-bend-cp";
    else                        dragKind = "item-move";
    dragItemId = hit.item.id;
    selectItem(hit.item.id);
    ev.preventDefault();
    stageWrap.setPointerCapture(ev.pointerId);
    return;
  }

  // 3. 関節球へのヒット → 選択 + ギズモ表示
  if (stage) {
    const boneId = stage.hitTestJoint(x, y);
    if (boneId) {
      selectBone(boneId);
      ev.preventDefault();
      stageWrap.setPointerCapture(ev.pointerId);
      return;
    }
  }

  // 4. 背景 → オービット（選択は解除しない）
  selectedItemId = null;
  dragKind       = "orbit";
  stage?.orbitStart(x, y);
  stageWrap.setPointerCapture(ev.pointerId);
}

function onPointerMove(ev) {
  if (!dragKind) return;
  const { x, y } = stageNorm(ev);
  const c = current();

  // ギズモドラッグ
  if (dragKind.startsWith("gizmo-") && selectedBoneId) {
    const axis = dragKind[6]; // "x" | "y" | "z"
    let deltaDeg;
    if (axis === "x") deltaDeg = ev.movementY * -GIZMO_SENSITIVITY;
    else if (axis === "y") deltaDeg = ev.movementX *  GIZMO_SENSITIVITY;
    else                   deltaDeg = ev.movementX *  GIZMO_SENSITIVITY;

    const rot = [...(c.boneRot[selectedBoneId] ?? [0, 0, 0])];
    if (axis === "x") rot[0] += deltaDeg;
    else if (axis === "y") rot[1] += deltaDeg;
    else                   rot[2] += deltaDeg;

    c.boneRot[selectedBoneId] = clampBoneRot(selectedBoneId, rot);
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
  dragKind   = null;
  dragItemId = null;
  try { stageWrap.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
}

// ─── ダブルクリック: インライン文字編集 ────────────────────
stageWrap?.addEventListener("dblclick", ev => {
  const { x, y } = stageNorm(ev);
  annotCanvas.width  = annotCanvas.width  || stageWrap.clientWidth;
  annotCanvas.height = annotCanvas.height || stageWrap.clientHeight;
  const hit = hitTestItems(current().items, x, y, annotCanvas);
  if (hit?.item.type === "text") {
    ev.preventDefault();
    openInlineEdit(hit.item, ev.clientX, ev.clientY);
  }
});

function openInlineEdit(item, clientX, clientY) {
  editingItemId = item.id;
  selectedItemId = item.id;
  inlineEditEl.style.left = `${clientX}px`;
  inlineEditEl.style.top  = `${clientY}px`;
  inlineEditEl.classList.remove("hidden");
  inlineEditInput.value = item.text || "";
  inlineEditInput.style.fontSize = `${Math.max(12, (item.fontSize ?? 18) * 0.85)}px`;
  inlineEditInput.focus();
  inlineEditInput.select();
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
    ev.preventDefault();
    closeInlineEdit(ev.key === "Enter");
  }
});
inlineEditInput?.addEventListener("blur", () => closeInlineEdit(true));

// ─── ポーズリセット ────────────────────────────────────────
document.querySelector("[data-preset='reset']")?.addEventListener("click", () => {
  const c = current();
  c.boneRot   = cloneBoneRot(REST_POSE);
  c.bodyYaw   = 0;
  c.headYaw   = 0;
  c.boneScale = { armScale: 1, legScale: 1 };
  selectedBoneId = null;
  draw();
});

// ─── Body/Head Yaw スライダー ──────────────────────────────
bodyYawEl?.addEventListener("input", () => { current().bodyYaw = Number(bodyYawEl.value); draw(); });
headYawEl?.addEventListener("input", () => { current().headYaw = Number(headYawEl.value); draw(); });

// ─── ボーンスケールスライダー ──────────────────────────────
armScaleEl?.addEventListener("input", () => {
  current().boneScale ??= {};
  current().boneScale.armScale = Number(armScaleEl.value);
  draw();
});
legScaleEl?.addEventListener("input", () => {
  current().boneScale ??= {};
  current().boneScale.legScale = Number(legScaleEl.value);
  draw();
});

// ─── ビュープリセット ──────────────────────────────────────
document.querySelectorAll("[data-view]").forEach(btn => {
  const ANGLE = { front: 0, diag: 45, side: 85 };
  btn.addEventListener("click", () => {
    current().bodyYaw = ANGLE[btn.dataset.view] ?? 0;
    if (bodyYawEl) {
      bodyYawEl.value = String(current().bodyYaw);
      if (bodyYawLbl) bodyYawLbl.textContent = `${bodyYawEl.value}°`;
    }
    draw();
  });
});

// ─── カウントコピー ────────────────────────────────────────
document.getElementById("btnCopyCount")?.addEventListener("click", () => {
  const phrase  = work.phrases[phraseIdx];
  const nextIdx = countIdx + 1;
  if (nextIdx < COUNTS_PER_PHRASE) {
    const src = current();
    const dst = phrase.counts[nextIdx];
    dst.boneRot   = cloneBoneRot(src.boneRot);
    dst.bodyYaw   = src.bodyYaw;
    dst.headYaw   = src.headYaw ?? 0;
    dst.boneScale = { ...(src.boneScale ?? {}) };
    countIdx      = nextIdx;
    selectedItemId = null;
    selectedBoneId = null;
    rebuildTimeline();
    draw();
  }
});

// ─── フレーズ追加 ──────────────────────────────────────────
document.getElementById("btnAddPhrase")?.addEventListener("click", () => {
  work.phrases.push(makePhrase(work.phrases.length));
  phraseIdx = work.phrases.length - 1;
  countIdx  = 0;
  rebuildTimeline();
  draw();
});

// ─── 作品名 ────────────────────────────────────────────────
workNameEl?.addEventListener("input", () => { work.name = workNameEl.value; scheduleSave(); });
document.getElementById("btnSaveWork")?.addEventListener("click", () => {
  saveWork();
  if (saveHint) {
    saveHint.textContent = "✓ 保存しました";
    setTimeout(() => { saveHint.textContent = ""; }, 2500);
  }
});
document.getElementById("btnNewWork")?.addEventListener("click", () => {
  if (!confirm("現在の内容を破棄して新しい作品を始めますか？")) return;
  work      = makeWork();
  phraseIdx = 0; countIdx = 0;
  selectedItemId = null; selectedBoneId = null;
  rebuildTimeline();
  draw();
});

// ─── アイテム追加 ──────────────────────────────────────────
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
  selectItem(item.id);
  showFb(msg);
  flashStage();
}

document.getElementById("btnAddStraightArrow")?.addEventListener("click", () => addAnnotItem("arrow",  0.5, 0.62, { bend: 0 }, "進む矢印を追加"));
document.getElementById("btnAddSpinArrow")    ?.addEventListener("click", () => addAnnotItem("spin",   0.5, 0.50, { angle: 30 }, "回転の矢印を追加"));
document.getElementById("btnAddText")         ?.addEventListener("click", () => {
  const text = document.getElementById("fieldMotion")?.value.trim() || "メモ";
  addAnnotItem("text", 0.5, 0.35, { text }, `「${text}」を追加`);
});

// ─── 矢印スライダー ────────────────────────────────────────
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
    ev.preventDefault();
    countIdx = Math.max(0, Math.min(COUNTS_PER_PHRASE - 1, countIdx + (ev.key === "ArrowRight" ? 1 : -1)));
    selectedItemId = null; selectedBoneId = null;
    rebuildTimeline(); draw();
    return;
  }
  if (ev.key === "Escape") {
    selectedBoneId = null; draw();
    return;
  }
  if ((ev.key === "Delete" || ev.key === "Backspace") && selectedItemId) {
    ev.preventDefault();
    deleteSelectedItem();
  }
});

// ─── タイムライン ──────────────────────────────────────────
function rebuildTimeline() {
  const container = document.getElementById("phraseTimeline");
  if (!container) return;
  container.innerHTML = "";

  work.phrases.forEach((phrase, pi) => {
    const row = document.createElement("div");
    row.className = "phrase-row";

    const lbl = document.createElement("span");
    lbl.className = "phrase-label";
    lbl.textContent = phrase.label;
    row.appendChild(lbl);

    const chips = document.createElement("div");
    chips.className = "phrase-counts";

    phrase.counts.forEach((count, ci) => {
      if (ci === 8) {
        const d = document.createElement("span");
        d.className = "count-divider";
        chips.appendChild(d);
      }
      const btn = document.createElement("button");
      btn.type        = "button";
      btn.className   = "count-chip";
      btn.textContent = ci + 1;
      if (pi === phraseIdx && ci === countIdx) btn.classList.add("is-active");
      if (hasContent(count)) btn.classList.add("has-pose");
      btn.addEventListener("click", () => {
        phraseIdx = pi; countIdx = ci;
        selectedItemId = null; selectedBoneId = null;
        rebuildTimeline(); draw();
      });
      chips.appendChild(btn);
    });
    row.appendChild(chips);

    if (work.phrases.length > 1) {
      const del = document.createElement("button");
      del.type        = "button";
      del.className   = "btn-phrase-del";
      del.textContent = "×";
      del.addEventListener("click", () => {
        if (!confirm(`フレーズ ${phrase.label} を削除しますか？`)) return;
        work.phrases.splice(pi, 1);
        if (phraseIdx >= work.phrases.length) phraseIdx = work.phrases.length - 1;
        rebuildTimeline(); draw();
      });
      row.appendChild(del);
    }
    container.appendChild(row);
  });
}

// ─── リサイズ ──────────────────────────────────────────────
function onResize() {
  const w = viewport3d.clientWidth;
  const h = viewport3d.clientHeight;
  if (w < 1 || h < 1) return;
  stage?.resize(w, h);
  annotCanvas.width  = w;
  annotCanvas.height = h;
  draw();
}

// ─── 起動 ─────────────────────────────────────────────────
(async function boot() {
  try {
    stage = createStage(viewport3d);
  } catch (e) {
    console.error("Three.js の初期化に失敗しました:", e);
  }

  const initW = viewport3d.clientWidth  || 440;
  const initH = viewport3d.clientHeight || 560;
  annotCanvas.width  = initW;
  annotCanvas.height = initH;

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(onResize).observe(viewport3d);
  }
  window.addEventListener("resize", onResize);

  rebuildTimeline();
  draw();
})();
