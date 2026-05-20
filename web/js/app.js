/**
 * Motion Studio — 緑骨格 + 16カウント（dance_training_dashboard 準拠 UI）
 */
import {
  buildTimelineView,
  drawCountPoseOnCanvas,
  drawMotionPreview,
  drawPose,
  drawPoseOnCanvas,
  easeInOutSine,
  lerpPose,
} from "./pose-render.js";
import { createPracticeController } from "./practice.js";
import {
  countDisplayLabel,
  fetchJson,
  fetchJsonPost,
  loadScoreJson,
  nearestCountIndex,
  poseAtTime,
} from "./score-data.js";

const UNIFORM_SLOTS = 16;

const $ = (id) => document.getElementById(id);

/** 動画の総尺（秒）。未ロード時は骨格フレーム／譜面から推定 */
function getVideoDurationSec() {
  const d = video.duration;
  if (Number.isFinite(d) && d > 0) return d;
  if (frames?.length) {
    const last = frames[frames.length - 1]?.time_sec;
    if (last != null && Number.isFinite(last)) return Math.max(last, 0.001);
  }
  if (score?.counts?.length) {
    const t = score.counts[score.counts.length - 1]?.time_sec;
    if (t != null && Number.isFinite(t)) return Math.max(t, 0.001);
  }
  return 0;
}

/** 1 カウントの秒数。ルール: countDuration = video.duration / 16 */
function getCountDurationSec() {
  const dur = getVideoDurationSec();
  return dur > 0 ? dur / UNIFORM_SLOTS : 0;
}

/** 再生位置 t（秒）が属するスロット 0..15 */
function uniformSlotFromTime(t) {
  const cd = getCountDurationSec();
  if (cd <= 0) return 0;
  const s = Math.floor(t / cd);
  return Math.min(UNIFORM_SLOTS - 1, Math.max(0, s));
}

function uniformTimeForSlot(slot) {
  const cd = getCountDurationSec();
  return cd * Math.max(0, Math.min(UNIFORM_SLOTS - 1, slot));
}

const video = $("player");
const overlay = $("overlay");
const octx = overlay.getContext("2d");
const motionCanvas = $("motionPreview");
const mctx = motionCanvas?.getContext("2d");

let score = null;
let phrases = [];
let frames = null;
let countIndex = 0;
let rafId = 0;
let morphRaf = 0;
let morphStart = 0;

const MORPH_MS = 700;

let scannedPeople = [];
let selectedPerson = null;
let generating = false;
let timelineView = null;
let practice = null;
let uiMode = "practice";

function setUiMode(mode) {
  uiMode = mode;
  document.body.classList.toggle("mode-practice", mode === "practice");
  document.body.classList.toggle("mode-preview", mode === "preview");
  $("modePreview").classList.toggle("primary", mode === "preview");
  $("modePreview").classList.toggle("ghost", mode !== "preview");
  $("modePractice").classList.toggle("primary", mode === "practice");
  $("modePractice").classList.toggle("ghost", mode !== "practice");
  if (mode === "practice") {
    stopMorphLoop();
    if (video?.src) video.pause();
    practice?.drawIdle();
    setStatus("PRACTICE");
  } else {
    practice?.stop();
    setStatus("PREVIEW");
    drawOverlay();
  }
}

function setHeaderMessage(text, type = "") {
  const el = $("headerMessage");
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("is-error", "is-ok");
  if (type) el.classList.add(type);
}

function showError(msg) {
  const el = $("err");
  el.classList.toggle("hidden", !msg);
  el.textContent = msg || "";
  setHeaderMessage(msg, msg ? "is-error" : "");
}

function setStatus(text) {
  $("rec-status").textContent = text;
}

export function normalizeVideoPath(path) {
  if (!path) return "";
  const p = path.trim();
  if (p.includes("_overlay")) {
    const name = p.split("/").pop().replace("_score_overlay.mp4", ".mp4");
    return `data/videos/${name}`;
  }
  return p;
}

function assetUrl(relativePath) {
  return "/" + relativePath.replace(/^\//, "");
}

async function videoExists(path) {
  try {
    const res = await fetch(assetUrl(path), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

function resizeOverlay() {
  const w = video.clientWidth;
  const h = video.clientHeight;
  if (w && h) {
    overlay.width = w;
    overlay.height = h;
  }
}

function currentPose() {
  if (!score?.counts?.length) return null;
  const t =
    !video.paused && video.src
      ? video.currentTime
      : uniformTimeForSlot(countIndex);
  return poseAtTime(frames, score.counts, t);
}

function countPair() {
  if (!score?.counts?.length) return { a: null, b: null, label: "—" };
  const cd = getCountDurationSec();
  if (cd <= 0) return { a: null, b: null, label: "—" };
  const dur = getVideoDurationSec();
  const t0 = cd * countIndex;
  const t1 = countIndex < UNIFORM_SLOTS - 1 ? cd * (countIndex + 1) : dur;
  const label =
    countIndex < UNIFORM_SLOTS - 1
      ? `${countDisplayLabel(countIndex + 1)} → ${countDisplayLabel(countIndex + 2)}`
      : `${countDisplayLabel(countIndex + 1)}（終端）`;
  return {
    a: poseAtTime(frames, score.counts, t0),
    b: poseAtTime(frames, score.counts, t1),
    label,
  };
}

function stopMorphLoop() {
  cancelAnimationFrame(morphRaf);
  morphRaf = 0;
}

function morphT(now) {
  const phase = ((now - morphStart) % (MORPH_MS * 2)) / MORPH_MS;
  return phase <= 1 ? easeInOutSine(phase) : easeInOutSine(2 - phase);
}

function drawMotionPanel(t) {
  if (!mctx || !motionCanvas) return;
  const { a, b, label } = countPair();
  drawMotionPreview(mctx, motionCanvas.width, motionCanvas.height, a, b, t, timelineView);
  $("motionCaption").textContent = `${label} の動き`;
}

function drawPausedOverlay(t) {
  if (!score?.counts?.length) return;
  resizeOverlay();
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const { a, b } = countPair();
  if (!a) return;
  const pose = a === b ? a : lerpPose(a, b, t);
  drawPose(octx, pose, overlay.width, overlay.height, a, a);
}

function startMorphLoop() {
  stopMorphLoop();
  if (!score?.counts?.length || !video.paused) return;

  morphStart = performance.now();
  const tick = (now) => {
    if (!video.paused) {
      stopMorphLoop();
      return;
    }
    const t = morphT(now);
    drawPausedOverlay(t);
    drawMotionPanel(t);
    morphRaf = requestAnimationFrame(tick);
  };
  morphRaf = requestAnimationFrame(tick);
}

function drawOverlay() {
  if (!score?.counts?.length) return;
  if (video.paused) {
    startMorphLoop();
    return;
  }
  stopMorphLoop();
  resizeOverlay();
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const pose = currentPose();
  const cd = getCountDurationSec();
  const prev =
    countIndex > 0 && cd > 0
      ? poseAtTime(frames, score.counts, cd * (countIndex - 1))
      : null;
  drawPose(octx, pose, overlay.width, overlay.height, prev, prev);
}

function paintLoop() {
  if (video.paused || video.ended) return;
  drawOverlay();
  highlightCells();
  rafId = requestAnimationFrame(paintLoop);
}

function updateBeatInfoUniform() {
  if (!score?.counts?.length) {
    $("beatInfo").innerHTML = "—<br>譜面を読み込んでください";
    $("tlMode").textContent = "16 COUNT (video ÷ 16)";
    return;
  }
  const cd = getCountDurationSec();
  const t = uniformTimeForSlot(countIndex);
  const pose = poseAtTime(frames, score.counts, t);
  const hasPose = !!pose && Object.keys(pose).length > 0;
  const label = countDisplayLabel(countIndex + 1);
  $("beatInfo").innerHTML =
    `Beat: <span style="color:#00ff88">${label}</span><br>` +
    `Slot: ${countIndex + 1} / 16<br>` +
    `Jump: ${t.toFixed(3)}s (= ${cd.toFixed(4)}s × ${countIndex})<br>` +
    `Data: ${hasPose ? '<span style="color:#00ff88">✓ pose</span>' : '<span style="color:#333">empty</span>'}`;
  $("tlMode").textContent = `16等分 ▸ ${label}`;
}

function updateNowPlaying() {
  if (!score?.counts?.length) return;
  const cd = getCountDurationSec();
  const t = uniformTimeForSlot(countIndex);
  const label = countDisplayLabel(countIndex + 1);
  $("sheetPanel").classList.remove("hidden");
  $("nowLabel").textContent = label;
  $("phraseVal").textContent = "動画尺 ÷ 16";
  $("countVal").textContent = label;
  $("timeVal").textContent = `${t.toFixed(3)}s`;
  $("tempoDisp").textContent =
    cd > 0 ? `1/16 = ${cd.toFixed(4)}s · 動画 ${getVideoDurationSec().toFixed(2)}s` : "—";
  updateBeatInfoUniform();
  highlightCells();
  drawOverlay();
}

function highlightCells() {
  const playing = !video.paused && !video.ended;
  document.querySelectorAll(".count-block").forEach((el) => {
    const slot = +el.dataset.slot;
    el.classList.toggle("selected", slot === countIndex);
    el.classList.toggle("playing", playing && slot === countIndex);
  });
  document.querySelectorAll(".person-card").forEach((el) => {
    el.classList.toggle("selected", el.dataset.pid === String(selectedPerson?.person_id));
  });
}

/** スロット i → 動画は countDuration * i 秒へジャンプし一時停止。骨格はその瞬間の score データ */
function selectUniformSlot(slot, seek) {
  if (!score?.counts?.length) return;
  countIndex = Math.max(0, Math.min(UNIFORM_SLOTS - 1, slot));
  const cd = getCountDurationSec();
  if (seek && video.src && cd > 0) {
    video.currentTime = cd * countIndex;
    video.pause();
  }
  if (score?.counts?.length) {
    const tJump = uniformTimeForSlot(countIndex);
    const step = nearestCountIndex(score.counts, tJump);
    practice?.setIndex(step);
  }
  updateNowPlaying();
}

function uniformSamplePoses() {
  const cd = getCountDurationSec();
  const out = [];
  let last = null;
  for (let i = 0; i < UNIFORM_SLOTS; i += 1) {
    const t = cd * i;
    const p = poseAtTime(frames, score.counts, t);
    last = p && Object.keys(p).length ? p : last;
    out.push(last || p || {});
  }
  return out;
}

function addUniformCountBlock(grid, slot) {
  const cd = getCountDurationSec();
  const t = cd * slot;
  const pose = poseAtTime(frames, score.counts, t);
  const prevPose = slot > 0 ? poseAtTime(frames, score.counts, cd * (slot - 1)) : null;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "count-block";
  btn.dataset.slot = String(slot);
  btn.dataset.time = String(t);

  if (pose && Object.keys(pose).length) btn.classList.add("has-data");

  const canvas = document.createElement("canvas");
  canvas.width = 144;
  canvas.height = 180;
  if (pose && timelineView) {
    drawCountPoseOnCanvas(canvas, prevPose, pose, timelineView);
  } else if (pose) {
    drawPoseOnCanvas(canvas, pose);
  }
  btn.appendChild(canvas);

  const num = document.createElement("span");
  num.className = "cb-num";
  num.textContent = countDisplayLabel(slot + 1);
  btn.appendChild(num);

  const lbl = document.createElement("span");
  lbl.className = "cb-label";
  lbl.textContent = `${t.toFixed(2)}s`;
  btn.appendChild(lbl);

  const dot = document.createElement("div");
  dot.className = "cb-dot";
  btn.appendChild(dot);

  btn.addEventListener("click", () => selectUniformSlot(slot, true));
  grid.appendChild(btn);
}

function renderSheet() {
  const root = $("sheetTimeline");
  root.innerHTML = "";
  if (!score?.counts?.length) return;

  const cd = getCountDurationSec();
  const dur = getVideoDurationSec();
  const poses = uniformSamplePoses();
  timelineView = buildTimelineView(poses.filter((p) => p && Object.keys(p).length));
  if (!timelineView) {
    timelineView = buildTimelineView(poses);
  }

  const section = document.createElement("div");
  section.className = "phrase-timeline";

  const header = document.createElement("div");
  header.className = "timeline-header";
  header.innerHTML =
    `<span class="tl-title">16 カウント（動画 ${dur.toFixed(2)}s ÷ 16）</span>` +
    `<span class="tl-mode" id="uniformMeta">1 拍 = ${cd > 0 ? cd.toFixed(4) : "—"}s</span>`;
  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "count-grid";
  grid.id = "uniform16Grid";
  for (let slot = 0; slot < UNIFORM_SLOTS; slot += 1) {
    addUniformCountBlock(grid, slot);
  }
  section.appendChild(grid);
  root.appendChild(section);
}

function renderPersonGallery() {
  const root = $("personGallery");
  root.innerHTML = "";
  $("generateBtn").classList.toggle("hidden", scannedPeople.length === 0);
  $("rescanBtn").classList.toggle("hidden", !video.src);

  if (!scannedPeople.length) {
    return;
  }

  scannedPeople.forEach((person) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "person-card";
    card.dataset.pid = String(person.person_id);

    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 60;
    drawPoseOnCanvas(canvas, person.pose);
    card.appendChild(canvas);

    const cap = document.createElement("span");
    cap.className = "person-cap";
    cap.innerHTML = `<strong>${person.label}</strong><small>${person.hint}</small>`;
    card.appendChild(cap);

    card.addEventListener("click", () => selectPerson(person));
    root.appendChild(card);
  });
}

function selectPerson(person) {
  selectedPerson = person;
  $("generateBtn").disabled = false;
  $("generateBtn").classList.remove("hidden");
  $("pickStatus").textContent = `${person.label} → Generate`;
  $("pickStatus").classList.remove("hidden");
  highlightCells();
}

async function scanPeople() {
  const videoPath = normalizeVideoPath($("videoPath").value);
  if (!videoPath || !video.src) return;

  $("scanMeta").textContent = "Scanning…";
  try {
    const data = await fetchJson(
      `/api/scan-people?video=${encodeURIComponent(videoPath)}`,
      "人物認識",
    );
    scannedPeople = data.people || [];
    $("scanMeta").textContent =
      scannedPeople.length > 0
        ? `${scannedPeople.length} detected — pick & Generate`
        : "No people found.";
    renderPersonGallery();
  } catch (e) {
    $("scanMeta").textContent = `Scan skipped: ${e.message}`;
  }
}

async function generateScore() {
  if (!selectedPerson || generating) return;
  const videoPath = normalizeVideoPath($("videoPath").value);
  const scorePath =
    $("scorePath").value.trim() ||
    `data/output/${videoPath.split("/").pop().replace(".mp4", "_score.json")}`;
  const [x, y] = selectedPerson.center;

  generating = true;
  $("generateBtn").disabled = true;
  $("pickStatus").textContent = "Generating…";
  setStatus("GENERATING");

  try {
    const payload = await fetchJsonPost(
      "/api/generate-score",
      { video: videoPath, target: `${x},${y}`, output: scorePath },
      "譜面生成",
    );

    $("scorePath").value = payload.score_path;
    $("pickStatus").textContent = `Done · ${payload.frames}f · ${payload.beats} beats`;
    await loadScore(payload.score_path);
    setStatus("SCORE READY");
  } catch (e) {
    showError(String(e.message || e));
    $("pickStatus").textContent = "Generate failed";
    setStatus("ERROR");
  } finally {
    generating = false;
    $("generateBtn").disabled = !selectedPerson;
  }
}

async function loadScore(scorePath) {
  const data = await loadScoreJson(scorePath);
  score = data.score;
  phrases = data.phrases;
  frames = data.frames;
  countIndex = 0;
  renderSheet();
  updateNowPlaying();
  showError("");
  setHeaderMessage(`Score loaded · ${score.counts.length} counts`, "is-ok");
  setStatus("SCORE READY");
  $("modeTabs").classList.remove("hidden");
  $("practicePanel").classList.remove("hidden");
  practice?.drawIdle();
  setUiMode("practice");
}

/** Practice: 譜面の任意ステップ step（0..counts-1）の区間 [t0, t1] */
function getPracticeTimesForStep(step) {
  const counts = score?.counts;
  if (!counts?.length) return { t0: 0, t1: 0 };
  const s = Math.max(0, Math.min(counts.length - 1, step));
  const t0 = Number(counts[s].time_sec);
  let t1;
  if (s < counts.length - 1) t1 = Number(counts[s + 1].time_sec);
  else t1 = getVideoDurationSec();
  return { t0, t1: Math.max(t1, t0 + 0.02) };
}

function initPractice() {
  practice = createPracticeController({
    canvas: $("practiceGuide"),
    countEl: $("practiceCount"),
    hintEl: $("practiceHint"),
    playBtn: $("practicePlay"),
    loopCheck: $("loopPhrase"),
    videoCheck: $("useVideoAudio"),
    video,
    getPracticeTimes: (step) => getPracticeTimesForStep(step),
    getScoreCounts: () => score?.counts ?? [],
    getPoseAtTime: (t) => poseAtTime(frames, score?.counts ?? [], t),
    getTimelineView: () => timelineView,
    onCountChange: () => {
      highlightCells();
    },
  });
}

async function tryLoadExistingScore() {
  const scorePath = $("scorePath").value.trim();
  if (!scorePath) return;

  try {
    await loadScore(scorePath);
    const tc = score.tracking?.target_center;
    if (tc?.length === 2 && scannedPeople.length) {
      const match = scannedPeople.find(
        (p) => Math.hypot(p.center[0] - tc[0], p.center[1] - tc[1]) < 0.12,
      );
      if (match) selectPerson(match);
    }
  } catch (e) {
    showError(String(e.message || e));
  }
}

async function loadVideo(path) {
  const normalized = normalizeVideoPath(path);
  if (!(await videoExists(normalized))) {
    showError(`Video not found: ${normalized}`);
    setStatus("NO VIDEO");
    return false;
  }

  video.src = assetUrl(normalized);
  video.load();
  setStatus("VIDEO READY");

  return new Promise((resolve) => {
    const onOk = () => {
      video.removeEventListener("loadeddata", onOk);
      video.removeEventListener("error", onErr);
      resizeOverlay();
      resolve(true);
    };
    const onErr = () => {
      video.removeEventListener("loadeddata", onOk);
      video.removeEventListener("error", onErr);
      showError(`Cannot play: ${normalized}`);
      setStatus("VIDEO ERROR");
      resolve(false);
    };
    video.addEventListener("loadeddata", onOk);
    video.addEventListener("error", onErr);
  });
}

async function loadAll() {
  showError("");
  cancelAnimationFrame(rafId);

  const videoPath = normalizeVideoPath($("videoPath").value);
  $("videoPath").value = videoPath;

  if (videoPath) await loadVideo(videoPath);
  await tryLoadExistingScore();
  scanPeople();
}

function init() {
  document.body.classList.add("mode-practice");
  initPractice();
  $("modePreview").addEventListener("click", () => setUiMode("preview"));
  $("modePractice").addEventListener("click", () => setUiMode("practice"));

  $("loadBtn").addEventListener("click", loadAll);
  $("sampleBtn").addEventListener("click", () => {
    $("videoPath").value = "data/videos/PXL_20260228_101825443.mp4";
    $("scorePath").value = "data/output/PXL_20260228_101825443_score.json";
    loadAll();
  });
  $("rescanBtn").addEventListener("click", scanPeople);
  $("generateBtn").addEventListener("click", generateScore);

  video.addEventListener("loadedmetadata", () => {
    if (score?.counts?.length) {
      renderSheet();
      updateNowPlaying();
    }
  });

  video.addEventListener("play", () => {
    if (uiMode === "practice" && practice?.isPlaying()) return;
    setStatus("PLAYING");
    stopMorphLoop();
    practice?.stop();
    cancelAnimationFrame(rafId);
    paintLoop();
  });
  video.addEventListener("pause", () => {
    if (uiMode === "practice" && practice?.isPlaying()) return;
    setStatus("PAUSED");
    highlightCells();
    startMorphLoop();
  });
  video.addEventListener("seeked", () => {
    if (uiMode === "practice") return;
    if (video.paused) startMorphLoop();
    else drawOverlay();
  });
  video.addEventListener("timeupdate", () => {
    if (uiMode === "practice" && practice?.isPlaying()) return;
    if (!score?.counts?.length) return;
    const slot = uniformSlotFromTime(video.currentTime);
    if (slot !== countIndex) {
      selectUniformSlot(slot, false);
    }
  });
  window.addEventListener("resize", () => {
    resizeOverlay();
    if (video.paused) startMorphLoop();
    else drawOverlay();
  });

  const p = new URLSearchParams(location.search);
  if (p.get("video")) $("videoPath").value = normalizeVideoPath(p.get("video"));
  if (p.get("score")) $("scorePath").value = p.get("score");

  loadAll();
}

init();
