/**
 * Motion Studio — 2 ペイン（Avatar + Pose Memo）
 */
import {
  buildTimelineView,
  drawCountPoseOnCanvas,
  drawMotionPreview,
  drawPoseOnCanvas,
  easeInOutSine,
} from "./pose-render.js";
import { countTitle, hasPose } from "./score.js";

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root
 * @param {() => object|null} opts.getScore
 * @param {() => number} opts.getIndex
 * @param {(n: number) => void} opts.setIndex
 */
export function createStudio(opts) {
  const { root, getScore, getIndex, setIndex } = opts;

  const el = {
    strip: root.querySelector("#countStrip"),
    title: root.querySelector("#choreoTitle"),
    desc: root.querySelector("#fieldDesc"),
    memo: root.querySelector("#fieldMemo"),
    flowText: root.querySelector("#fieldFlow"),
    badge: root.querySelector("#countBadge"),
    flowCanvas: root.querySelector("#flowCanvas"),
    poseSnap: root.querySelector("#poseSnap"),
    btnFlow: root.querySelector("#btnFlow"),
  };

  let timelineView = null;
  let flowAnim = 0;
  let flowOn = false;
  const fctx = el.flowCanvas?.getContext("2d");

  function count() {
    return getScore()?.counts?.[getIndex()] ?? null;
  }

  function rebuildView() {
    const poses = (getScore()?.counts ?? []).map((c) => c.pose).filter(hasPose);
    timelineView = poses.length ? buildTimelineView(poses) : null;
  }

  function syncFields() {
    const c = count();
    if (!c) return;
    if (el.title && !el.title.dataset.userEdited) {
      const s = getScore();
      if (s && !el.title.value) el.title.value = s.title || "";
    }
    if (el.desc) el.desc.value = c.description ?? "";
    if (el.memo) el.memo.value = c.memo ?? "";
    if (el.flowText) el.flowText.value = c.transition ?? "";
    if (el.badge) el.badge.textContent = `Count ${countTitle(c, getIndex())}`;
  }

  function patch(key, val) {
    const s = getScore();
    const i = getIndex();
    if (s?.counts?.[i]) s.counts[i][key] = val;
  }

  function drawSnap() {
    if (!el.poseSnap) return;
    const c = count();
    const ctx = el.poseSnap.getContext("2d");
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, el.poseSnap.width, el.poseSnap.height);
    if (!c?.pose || !hasPose(c.pose)) {
      ctx.fillStyle = "#555";
      ctx.font = "11px system-ui,sans-serif";
      ctx.fillText("No pose", 12, 72);
      return;
    }
    const i = getIndex();
    const prev = getScore()?.counts?.[i - 1]?.pose;
    const onion = prev && hasPose(prev) ? [prev] : [];
    if (timelineView) drawCountPoseOnCanvas(el.poseSnap, c.pose, timelineView, onion);
    else drawPoseOnCanvas(el.poseSnap, c.pose);
  }

  function drawFlow(t = 0) {
    if (!fctx || !el.flowCanvas) return;
    const s = getScore();
    const i = getIndex();
    const a = s?.counts?.[i]?.pose;
    const b = s?.counts?.[i + 1]?.pose;
    if (!hasPose(a) || !hasPose(b) || !timelineView) {
      fctx.fillStyle = "#0a0a0a";
      fctx.fillRect(0, 0, el.flowCanvas.width, el.flowCanvas.height);
      fctx.fillStyle = "#444";
      fctx.font = "11px system-ui,sans-serif";
      fctx.fillText("このカウントと次にポーズが必要", 8, 64);
      return;
    }
    drawMotionPreview(fctx, el.flowCanvas.width, el.flowCanvas.height, a, b, easeInOutSine(t), timelineView);
  }

  function stopFlow() {
    flowOn = false;
    cancelAnimationFrame(flowAnim);
    flowAnim = 0;
    if (el.btnFlow) el.btnFlow.textContent = "Flow preview";
    drawFlow(0);
  }

  function toggleFlow() {
    if (flowOn) {
      stopFlow();
      return;
    }
    flowOn = true;
    if (el.btnFlow) el.btnFlow.textContent = "Stop";
    const start = performance.now();
    const tick = (now) => {
      if (!flowOn) return;
      const p = ((now - start) % 1200) / 600;
      drawFlow(p <= 1 ? p : 2 - p);
      flowAnim = requestAnimationFrame(tick);
    };
    flowAnim = requestAnimationFrame(tick);
  }

  function renderStrip() {
    if (!el.strip) return;
    const s = getScore();
    el.strip.innerHTML = "";
    if (!s?.counts?.length) return;

    s.counts.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "count-card";
      btn.setAttribute("role", "option");
      if (i === getIndex()) btn.classList.add("is-current");
      if (!hasPose(c.pose)) btn.classList.add("is-empty");

      const cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 76;
      if (hasPose(c.pose) && timelineView) {
        const prev = i > 0 ? s.counts[i - 1]?.pose : null;
        const onion = prev && hasPose(prev) ? [prev] : [];
        drawCountPoseOnCanvas(cv, c.pose, timelineView, onion);
      } else if (hasPose(c.pose)) {
        drawPoseOnCanvas(cv, c.pose);
      } else {
        const cx = cv.getContext("2d");
        cx.fillStyle = "#141414";
        cx.fillRect(0, 0, 64, 76);
        cx.fillStyle = "#444";
        cx.font = "9px system-ui";
        cx.fillText("EMPTY", 14, 40);
      }
      btn.appendChild(cv);

      const cap = document.createElement("span");
      cap.className = "count-card-label";
      cap.textContent = countTitle(c, i);
      btn.appendChild(cap);

      btn.addEventListener("click", () => {
        setIndex(i);
        render();
      });
      el.strip.appendChild(btn);
    });
  }

  function render() {
    rebuildView();
    renderStrip();
    syncFields();
    drawSnap();
    if (!flowOn) drawFlow(0);
  }

  el.desc?.addEventListener("input", () => patch("description", el.desc.value));
  el.memo?.addEventListener("input", () => patch("memo", el.memo.value));
  el.flowText?.addEventListener("input", () => patch("transition", el.flowText.value));
  el.title?.addEventListener("input", () => {
    el.title.dataset.userEdited = "1";
    const s = getScore();
    if (s) s.title = el.title.value;
  });
  el.btnFlow?.addEventListener("click", toggleFlow);

  window.addEventListener("resize", () => {
    if (!flowOn) drawFlow(0);
  });

  return { render, stopFlow };
}
