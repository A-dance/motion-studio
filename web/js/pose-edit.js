/**
 * 手動ポーズ編集 — 3D ドラッグ + スライダー → カウント登録
 */
import {
  clonePose,
  DEFAULT_POSE,
  JOINT_LABELS,
  JOINT_NAMES,
  nudgeJoint,
  setJoint,
} from "./pose-math.js";
import { hasPose } from "./score.js";

/**
 * @param {object} opts
 * @param {{ update: Function, resize: Function, highlightJoint: Function, bindPoseEdit: Function, reset: Function }} opts.view3d
 * @param {HTMLElement} opts.root
 * @param {() => object|null} opts.getScore
 * @param {() => number} opts.getIndex
 * @param {() => void} opts.onChange
 */
export function createPoseEditor(opts) {
  const { view3d, root, getScore, getIndex, onChange } = opts;

  const el = {
    joint: root.querySelector("#editJoint"),
    x: root.querySelector("#editX"),
    y: root.querySelector("#editY"),
    z: root.querySelector("#editZ"),
    lblX: root.querySelector("#editXLbl"),
    lblY: root.querySelector("#editYLbl"),
    lblZ: root.querySelector("#editZLbl"),
    btnSave: root.querySelector("#btnSavePose"),
    btnClear: root.querySelector("#btnClearPose"),
    btnReset: root.querySelector("#btnResetPose"),
    hint: root.querySelector("#editHint"),
  };

  let editPose = clonePose(DEFAULT_POSE);
  let selected = "left_wrist";
  let unbind = null;

  function fillJointSelect() {
    if (!el.joint) return;
    el.joint.innerHTML = "";
    for (const name of JOINT_NAMES) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = JOINT_LABELS[name] || name;
      el.joint.appendChild(opt);
    }
    el.joint.value = selected;
  }

  function syncSliders() {
    const row = editPose[selected];
    if (!row) return;
    const x = row[0];
    const y = row[1];
    const z = row[3] ?? 0;
    if (el.x) {
      el.x.value = String(x);
      if (el.lblX) el.lblX.textContent = x.toFixed(2);
    }
    if (el.y) {
      el.y.value = String(y);
      if (el.lblY) el.lblY.textContent = y.toFixed(2);
    }
    if (el.z) {
      el.z.value = String(z);
      if (el.lblZ) el.lblZ.textContent = z.toFixed(2);
    }
  }

  function preview() {
    view3d?.update(editPose, { smooth: false, onionPast: [], onionFuture: [] });
    view3d?.highlightJoint?.(selected);
    view3d?.resize?.();
  }

  function selectJoint(name) {
    selected = name;
    if (el.joint) el.joint.value = name;
    syncSliders();
    preview();
  }

  function applySliders() {
    if (!editPose[selected]) return;
    const x = Number(el.x?.value ?? 0.5);
    const y = Number(el.y?.value ?? 0.5);
    const z = Number(el.z?.value ?? 0);
    setJoint(editPose, selected, x, y, z);
    preview();
  }

  function loadForCount(index) {
    const c = getScore()?.counts?.[index];
    editPose = hasPose(c?.pose) ? clonePose(c.pose) : clonePose(DEFAULT_POSE);
    syncSliders();
    preview();
    if (el.hint) {
      el.hint.textContent = hasPose(c?.pose)
        ? "登録済み。ドラッグまたはスライダーで直して「このカウントに登録」。"
        : "関節をドラッグして形を決め、「このカウントに登録」。";
    }
  }

  function saveToCount() {
    const s = getScore();
    const i = getIndex();
    if (!s?.counts?.[i]) return;
    s.counts[i].pose = clonePose(editPose);
    delete s.counts[i].time_sec;
    onChange?.();
    if (el.hint) el.hint.textContent = "登録しました。";
  }

  function clearCountPose() {
    const s = getScore();
    const i = getIndex();
    if (!s?.counts?.[i]) return;
    delete s.counts[i].pose;
    editPose = clonePose(DEFAULT_POSE);
    syncSliders();
    preview();
    onChange?.();
    if (el.hint) el.hint.textContent = "ポーズを削除しました。";
  }

  function resetEditor() {
    editPose = clonePose(DEFAULT_POSE);
    syncSliders();
    preview();
  }

  fillJointSelect();
  syncSliders();

  el.joint?.addEventListener("change", () => selectJoint(el.joint.value));
  el.x?.addEventListener("input", applySliders);
  el.y?.addEventListener("input", applySliders);
  el.z?.addEventListener("input", applySliders);

  el.btnSave?.addEventListener("click", saveToCount);
  el.btnClear?.addEventListener("click", clearCountPose);
  el.btnReset?.addEventListener("click", resetEditor);

  document.querySelectorAll("[data-nudge]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dx = Number(btn.dataset.dx || 0);
      const dy = Number(btn.dataset.dy || 0);
      const dz = Number(btn.dataset.dz || 0);
      nudgeJoint(editPose, selected, dx, dy, dz);
      syncSliders();
      preview();
    });
  });

  if (view3d?.bindPoseEdit) {
    unbind = view3d.bindPoseEdit({
      getPose: () => editPose,
      setPose: (pose, joint) => {
        editPose = pose;
        if (joint) selected = joint;
        syncSliders();
        onChange?.({ draft: true });
      },
      onSelect: (name) => selectJoint(name),
    });
  }

  return {
    loadForCount,
    saveToCount,
    clearCountPose,
    resetEditor,
    getEditPose: () => editPose,
    dispose() {
      unbind?.();
    },
  };
}
