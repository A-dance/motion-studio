/**
 * 自習モード — 譜面の全 counts[] を JSON の time_sec 間隔で再生
 */
import { drawMotionPreview, easeInOutSine } from "./pose-render.js";

export function createPracticeController(deps) {
  const {
    canvas,
    countEl,
    hintEl,
    playBtn,
    loopCheck,
    videoCheck,
    video,
    getPracticeTimes,
    getScoreCounts,
    getPoseAtTime,
    getTimelineView,
    onCountChange,
  } = deps;

  const ctx = canvas.getContext("2d");
  let playing = false;
  let raf = 0;
  let index = 0;
  let segmentStart = 0;
  let audioCtx = null;

  function maxStep() {
    const n = getScoreCounts().length;
    return Math.max(0, n - 1);
  }

  function resize() {
    const wrap = canvas.parentElement;
    const w = wrap?.clientWidth || 400;
    const h = Math.max(320, Math.min(520, w * 1.1));
    canvas.width = w;
    canvas.height = h;
  }

  function playClick(accent = false) {
    try {
      if (!audioCtx) audioCtx = new AudioContext();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = accent ? 880 : 660;
      gain.gain.value = accent ? 0.12 : 0.07;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime;
      osc.start(t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.stop(t0 + 0.07);
    } catch {
      /* ignore */
    }
  }

  function drawAt(t) {
    const { t0, t1 } = getPracticeTimes(index);
    if (t1 <= t0) return;
    const a = getPoseAtTime(t0);
    const b = getPoseAtTime(t1);
    const view = getTimelineView();
    if (!view) return;
    drawMotionPreview(ctx, canvas.width, canvas.height, a, b, easeInOutSine(t), view);
  }

  function updateLabel() {
    const counts = getScoreCounts();
    const { t0, t1 } = getPracticeTimes(index);
    const ms = Math.max(0, (t1 - t0) * 1000);
    const c = counts[index];
    countEl.textContent = c?.count_display ?? "—";
    hintEl.textContent =
      `${loopCheck.checked ? "譜面全体ループ" : "譜面を最後まで"} · ` +
      `${index + 1} / ${counts.length} · ${ms.toFixed(0)} ms`;
  }

  function segmentMs() {
    const { t0, t1 } = getPracticeTimes(index);
    return Math.max(120, (t1 - t0) * 1000);
  }

  function nextIndex(i) {
    const m = maxStep();
    if (loopCheck.checked) {
      if (i >= m) return 0;
      return i + 1;
    }
    if (i >= m) return i;
    return i + 1;
  }

  function syncVideo() {
    if (!videoCheck.checked || !video?.src) return;
    const { t0 } = getPracticeTimes(index);
    video.currentTime = t0;
    if (playing) video.play().catch(() => {});
    else video.pause();
  }

  function tick(now) {
    if (!playing) return;
    const counts = getScoreCounts();
    if (counts.length < 2) return;

    const dur = segmentMs();
    const elapsed = now - segmentStart;
    const tt = Math.min(1, elapsed / dur);
    drawAt(tt);

    if (elapsed >= dur) {
      const next = nextIndex(index);
      if (next === index && !loopCheck.checked) {
        stop();
        return;
      }
      index = next;
      segmentStart = now;
      const c = counts[index];
      playClick(c?.count_in_phrase === 1 || c?.count_display === "1");
      updateLabel();
      onCountChange(index);
      syncVideo();
    }
    raf = requestAnimationFrame(tick);
  }

  function start(fromIndex = 0) {
    const counts = getScoreCounts();
    if (counts.length < 2) return;
    stop();
    resize();
    index = Math.max(0, Math.min(maxStep(), fromIndex));
    playing = true;
    segmentStart = performance.now();
    playBtn.textContent = "■ 停止";
    playClick(true);
    updateLabel();
    onCountChange(index);
    syncVideo();
    if (videoCheck.checked && video?.src) {
      video.play().catch(() => {});
    }
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    raf = 0;
    playBtn.textContent = "▶ 練習開始";
    if (video?.src) video.pause();
    drawAt(0);
  }

  function toggle() {
    if (playing) stop();
    else start(index);
  }

  function setIndex(i) {
    index = Math.max(0, Math.min(maxStep(), i));
    updateLabel();
    drawAt(0);
  }

  playBtn.addEventListener("click", toggle);
  loopCheck.addEventListener("change", updateLabel);
  videoCheck.addEventListener("change", () => {
    if (!videoCheck.checked && video) video.pause();
    else syncVideo();
  });
  window.addEventListener("resize", () => {
    resize();
    drawAt(0);
  });

  return {
    resize,
    start,
    stop,
    setIndex,
    isPlaying: () => playing,
    drawIdle: () => {
      resize();
      drawAt(0);
      updateLabel();
    },
  };
}
