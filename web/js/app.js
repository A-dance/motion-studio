/**
 * app.js — Dance Sequence Note メインアプリ
 *
 * アーキテクチャ:
 *   pose-3d.js  → Three.js 3D アバター（ライト・シャドウ・関節ドラッグ・オービット）
 *   canvas-items.js → 2D アノテーション（矢印・文字）を #annotCanvas に描画
 *   stageWrap   → 全ポインターイベントを一元管理（アノテーション → 関節 → オービット）
 */
import { STAND_POSE, clonePose, createStage } from "./pose-3d.js";
import {
  createItem,
  dragItemArcStart,
  dragItemBendCP,
  dragItemRotate,
  dragItemTip,
  hitTestItems,
  drawAnnotCanvas,
} from "./canvas-items.js";

// ─── DOM ──────────────────────────────────────────────────
const stageWrap   = document.getElementById("stageWrap");
const viewport3d  = document.getElementById("viewport3d");
const annotCanvas = document.getElementById("annotCanvas");

const bodyYawEl  = document.getElementById("bodyYaw");
const bodyYawLbl = document.getElementById("bodyYawLbl");
const headYawEl  = document.getElementById("headYaw");
const headYawLbl = document.getElementById("headYawLbl");

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

// インライン文字編集
const inlineEditEl    = document.getElementById("inlineEdit");
const inlineEditInput = document.getElementById("inlineEditInput");

// ─── 定数 ─────────────────────────────────────────────────
const LS_KEY            = "dance-studio-v4";
const COUNTS_PER_PHRASE = 16;

// ─── 状態 ─────────────────────────────────────────────────
let work       = loadWork() ?? makeWork();
let phraseIdx  = 0;
let countIdx   = 0;

let selectedJoint  = null;
let selectedItemId = null;
let editingItemId  = null; // インライン編集中のアイテム

let dragKind   = null; // "joint"|"item-tip"|"item-rotate"|"item-arc-start"|"item-bend-cp"|"item-move"
let dragJoint  = null;
let dragItemId = null;

let addFbTimer = 0;
let saveTimer  = 0;

let stage = null; // Three.js ステージ

// ─── データ構造 ────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function phraseLabel(idx) {
  const ch = String.fromCharCode(65 + (idx % 26));
  const n  = Math.floor(idx / 26);
  return n === 0 ? ch : `${ch}${n + 1}`;
}

function makeCount(n) {
  return { n, pose: clonePose(STAND_POSE), items: [], bodyYaw: 0, headYaw: 0 };
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
  return current().items.find((i) => i.id === selectedItemId) ?? null;
}

function hasContent(c) {
  if (!c) return false;
  if (c.items?.length > 0) return true;
  if (Math.abs(c.bodyYaw ?? 0) > 1 || Math.abs(c.headYaw ?? 0) > 1) return true;
  for (const id of Object.keys(STAND_POSE)) {
    const p = c.pose?.[id];
    if (!p) continue;
    const s = STAND_POSE[id];
    if (Math.abs(p[0] - s[0]) > 0.03 || Math.abs(p[1] - s[1]) > 0.03) return true;
  }
  return false;
}

// ─── 保存 / 読み込み ─────────────────────────────────────
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
        c.pose    = { ...clonePose(STAND_POSE), ...c.pose };
        c.items   = c.items   ?? [];
        c.headYaw = c.headYaw ?? 0;
        c.bodyYaw = c.bodyYaw ?? 0;
      }
    }
    return w;
  } catch { return null; }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWork, 800);
}

// ─── レンダリング ──────────────────────────────────────────
function draw() {
  const c = current();
  // Three.js アバター
  stage?.render(c.pose, { bodyYaw: c.bodyYaw, headYaw: c.headYaw ?? 0, selectedJoint });
  // 2D アノテーション
  drawAnnotCanvas(annotCanvas, c.items, selectedItemId);
  updateControls();
  scheduleSave();
}

function updateControls() {
  const item       = selectedItem();
  const isStraight = item?.type === "arrow";
  const isSpin     = item?.type === "spin";
  const isArrow    = isStraight || isSpin;
  const isText     = item?.type === "text";
  const c          = current();

  if (btnDeleteItem) btnDeleteItem.disabled = !item;

  // itemControls セクション
  if (itemControls) {
    const show = isArrow || isText;
    itemControls.classList.toggle("item-ctrl--idle", !show);
    if (itemCtrlTitle) itemCtrlTitle.textContent = isArrow ? "矢印の調整" : "テキスト";
  }

  // ポーズスライダー
  if (bodyYawEl) {
    bodyYawEl.value = String(Math.round(c.bodyYaw) % 360);
    if (bodyYawLbl) bodyYawLbl.textContent = `${bodyYawEl.value}°`;
  }
  if (headYawEl) {
    headYawEl.value = String(Math.round(c.headYaw ?? 0));
    if (headYawLbl) headYawLbl.textContent = `${headYawEl.value}°`;
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

  // 曲がり: 直線矢印のみ
  bendRow?.classList.toggle("hidden", !isStraight);
  if (isStraight) {
    if (dirBend) {
      dirBend.value = String(Math.round(item.bend ?? 0));
      if (dirBendLbl) dirBendLbl.textContent = String(Math.round(item.bend ?? 0));
    }
  }

  // 傾き: 両方の矢印
  tiltRow?.classList.toggle("hidden", !isArrow);
  if (isArrow) {
    if (dirTilt) {
      dirTilt.value = String(Math.round(item.tilt ?? 0) % 360);
      if (dirTiltLbl) dirTiltLbl.textContent = `${dirTilt.value}°`;
    }
  }

  // カウントラベル
  const phrase = work.phrases[phraseIdx];
  if (countLabel) countLabel.textContent = `${phrase.label} – ${countIdx + 1}`;

  // 作品名（フォーカス中は上書きしない）
  if (workNameEl && document.activeElement !== workNameEl) {
    workNameEl.value = work.name ?? "";
  }
}

// ─── アイテム操作 ─────────────────────────────────────────
function selectItem(id) { selectedItemId = id; selectedJoint = null; draw(); }
function selectJoint(id) { selectedJoint = id; selectedItemId = null; draw(); }

function deleteSelectedItem() {
  if (!selectedItemId) return;
  current().items = current().items.filter((i) => i.id !== selectedItemId);
  selectedItemId  = null;
  draw();
}

// ─── stageWrap のポインターイベント ────────────────────────
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
  // インライン編集中はクリックをそのまま通す
  if (ev.target === inlineEditInput) return;
  closeInlineEdit(true);

  const { x, y } = stageNorm(ev);
  const c = current();

  // 1. 2D アノテーションアイテムへのヒット
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

  // 2. Three.js 関節へのヒット
  if (stage) {
    const joint = stage.hitTestJoint(x, y);
    if (joint) {
      dragKind  = "joint";
      dragJoint = joint;
      selectJoint(joint);
      ev.preventDefault();
      stageWrap.setPointerCapture(ev.pointerId);
      return;
    }
  }

  // 3. 背景 → オービット
  selectedItemId = null;
  selectedJoint  = null;
  dragKind       = "orbit";
  stage?.orbitStart(x, y);
  stageWrap.setPointerCapture(ev.pointerId);
  draw();
}

function onPointerMove(ev) {
  if (!dragKind) return;
  const { x, y } = stageNorm(ev);
  const c = current();

  if (dragKind === "orbit") {
    stage?.orbitMove(x, y);
    return;
  }

  if (dragKind === "joint" && dragJoint && stage) {
    const newPos = stage.getDraggedPos(dragJoint, x, y);
    if (newPos) {
      c.pose[dragJoint] = newPos;
      draw();
    }
    return;
  }

  const item = c.items.find((i) => i.id === dragItemId);
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
  dragJoint  = null;
  dragItemId = null;
  try { stageWrap.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
}

// ─── ダブルクリック: インライン文字編集 ────────────────────
stageWrap?.addEventListener("dblclick", (ev) => {
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
    const item = current().items.find((i) => i.id === editingItemId);
    if (item && inlineEditInput) item.text = inlineEditInput.value || item.text;
  }
  editingItemId = null;
  inlineEditEl.classList.add("hidden");
  draw();
}

inlineEditInput?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === "Escape") {
    ev.preventDefault();
    closeInlineEdit(ev.key === "Enter");
  }
});
inlineEditInput?.addEventListener("blur", () => closeInlineEdit(true));

// ─── ポーズ操作 ────────────────────────────────────────────
document.querySelector("[data-preset]")?.addEventListener("click", () => {
  const c = current();
  c.pose    = clonePose(STAND_POSE);
  c.bodyYaw = 0;
  c.headYaw = 0;
  draw();
});

bodyYawEl?.addEventListener("input", () => {
  current().bodyYaw = Number(bodyYawEl.value);
  draw();
});
headYawEl?.addEventListener("input", () => {
  current().headYaw = Number(headYawEl.value);
  draw();
});

document.querySelectorAll("[data-view]").forEach((btn) => {
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

document.getElementById("btnCopyCount")?.addEventListener("click", () => {
  const phrase  = work.phrases[phraseIdx];
  const nextIdx = countIdx + 1;
  if (nextIdx < COUNTS_PER_PHRASE) {
    const src = current();
    const dst = phrase.counts[nextIdx];
    dst.pose    = clonePose(src.pose);
    dst.bodyYaw = src.bodyYaw;
    dst.headYaw = src.headYaw ?? 0;
    countIdx    = nextIdx;
    selectedItemId = null;
    selectedJoint  = null;
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

// ─── 作品名 ───────────────────────────────────────────────
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
  phraseIdx = 0;
  countIdx  = 0;
  selectedItemId = null;
  selectedJoint  = null;
  rebuildTimeline();
  draw();
});

// ─── キャンバスアイテム追加 ────────────────────────────────
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

document.getElementById("btnAddStraightArrow")?.addEventListener("click", () => {
  addAnnotItem("arrow", 0.5, 0.62, { bend: 0 }, "進む矢印を追加");
});
document.getElementById("btnAddSpinArrow")?.addEventListener("click", () => {
  addAnnotItem("spin", 0.5, 0.50, { angle: 30 }, "回転の矢印を追加");
});
document.getElementById("btnAddText")?.addEventListener("click", () => {
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
bindSlider(dirAngle, (item) => { item.angle = Number(dirAngle.value); });
bindSlider(dirPower, (item) => { item.power = Number(dirPower.value) / 100; });
bindSlider(dirBend,  (item) => { item.bend  = Number(dirBend.value); });
bindSlider(dirTilt,  (item) => { item.tilt  = Number(dirTilt.value); });

// ─── アイテム削除 ─────────────────────────────────────────
btnDeleteItem?.addEventListener("click", deleteSelectedItem);

// ─── キーボードショートカット ─────────────────────────────
document.addEventListener("keydown", (ev) => {
  // インライン編集中は委任
  if (ev.target === inlineEditInput) return;
  if (ev.target.matches("input, textarea")) return;

  if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
    ev.preventDefault();
    const delta = ev.key === "ArrowRight" ? 1 : -1;
    countIdx = Math.max(0, Math.min(COUNTS_PER_PHRASE - 1, countIdx + delta));
    selectedItemId = null;
    selectedJoint  = null;
    rebuildTimeline();
    draw();
    return;
  }

  if (ev.key === "Delete" || ev.key === "Backspace") {
    if (selectedItemId) {
      ev.preventDefault();
      deleteSelectedItem();
    }
  }
});

// ─── タイムライン ─────────────────────────────────────────
function rebuildTimeline() {
  const container = document.getElementById("phraseTimeline");
  if (!container) return;
  container.innerHTML = "";

  work.phrases.forEach((phrase, pi) => {
    const row = document.createElement("div");
    row.className = "phrase-row";

    const lbl = document.createElement("span");
    lbl.className   = "phrase-label";
    lbl.textContent = phrase.label;
    row.appendChild(lbl);

    const chips = document.createElement("div");
    chips.className = "phrase-counts";

    phrase.counts.forEach((count, ci) => {
      if (ci === 8) {
        const d     = document.createElement("span");
        d.className = "count-divider";
        chips.appendChild(d);
      }
      const btn       = document.createElement("button");
      btn.type        = "button";
      btn.className   = "count-chip";
      btn.textContent = ci + 1;
      if (pi === phraseIdx && ci === countIdx) btn.classList.add("is-active");
      if (hasContent(count)) btn.classList.add("has-pose");
      btn.addEventListener("click", () => {
        phraseIdx = pi; countIdx = ci;
        selectedItemId = null; selectedJoint = null;
        rebuildTimeline(); draw();
      });
      chips.appendChild(btn);
    });

    row.appendChild(chips);

    if (work.phrases.length > 1) {
      const del       = document.createElement("button");
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

// ─── 起動 ──────────────────────────────────────────────────
(async function boot() {
  // Three.js ステージ初期化
  try {
    stage = createStage(viewport3d);
  } catch (e) {
    console.error("Three.js の初期化に失敗しました:", e);
  }

  // annotCanvas を viewport3d と同じサイズに
  const initW = viewport3d.clientWidth  || 440;
  const initH = viewport3d.clientHeight || 560;
  annotCanvas.width  = initW;
  annotCanvas.height = initH;

  // リサイズ監視
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(onResize).observe(viewport3d);
  }
  window.addEventListener("resize", onResize);

  // 初回描画
  rebuildTimeline();
  draw();
})();
