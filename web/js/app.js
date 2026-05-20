/**
 * Motion Studio — 緑骨格 + 16カウント（dance_training_dashboard 準拠 UI）
 */
import { drawPose, drawPoseOnCanvas } from "./pose-render.js";
import {
  fetchJson,
  fetchJsonPost,
  loadScoreJson,
  nearestCountIndex,
  poseAtTime,
  poseForCount,
} from "./score-data.js";

const $ = (id) => document.getElementById(id);

const video = $("player");
const overlay = $("overlay");
const octx = overlay.getContext("2d");

let score = null;
let phrases = [];
let frames = null;
let countIndex = 0;
let rafId = 0;

let scannedPeople = [];
let selectedPerson = null;
let generating = false;

function showError(msg) {
  const el = $("err");
  el.classList.toggle("hidden", !msg);
  el.textContent = msg || "";
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
    !video.paused && video.src ? video.currentTime : score.counts[countIndex].time_sec;
  return poseAtTime(frames, score.counts, t);
}

function drawOverlay() {
  if (!score?.counts?.length) return;
  resizeOverlay();
  octx.clearRect(0, 0, overlay.width, overlay.height);
  drawPose(octx, currentPose(), overlay.width, overlay.height);
}

function paintLoop() {
  if (video.paused || video.ended) return;
  drawOverlay();
  highlightCells();
  rafId = requestAnimationFrame(paintLoop);
}

function updateBeatInfo(c) {
  if (!c) {
    $("beatInfo").innerHTML = "—<br>カウントをクリック";
    $("tlMode").textContent = "COUNT MODE";
    return;
  }
  const hasPose = !!poseForCount(c, frames);
  $("beatInfo").innerHTML =
    `Beat: <span style="color:#00ff88">${c.count_display}</span><br>` +
    `Phrase: ${c.phrase_label}<br>` +
    `Time: ${c.time_sec.toFixed(2)}s<br>` +
    `Data: ${hasPose ? '<span style="color:#00ff88">✓ pose</span>' : '<span style="color:#333">empty</span>'}`;
  $("tlMode").textContent = `BEAT ${c.count_in_phrase}/16 ▸ ${c.count_display}`;
}

function updateNowPlaying() {
  if (!score?.counts?.length) return;
  const c = score.counts[countIndex];
  $("sheetPanel").classList.remove("hidden");
  $("nowLabel").textContent = c.count_display;
  $("phraseVal").textContent = c.phrase_label;
  $("countVal").textContent = c.count_display;
  $("timeVal").textContent = `${c.time_sec.toFixed(2)}s`;
  $("tempoDisp").textContent = score.audio?.bpm
    ? `♩= ${Math.round(score.audio.bpm)} BPM`
    : "♩= — BPM";
  updateBeatInfo(c);
  highlightCells();
  drawOverlay();
}

function highlightCells() {
  const playing = !video.paused && !video.ended;
  document.querySelectorAll(".count-block").forEach((el) => {
    const i = +el.dataset.i;
    el.classList.toggle("selected", i === countIndex);
    el.classList.toggle("playing", playing && i === countIndex);
  });
  document.querySelectorAll(".person-card").forEach((el) => {
    el.classList.toggle("selected", el.dataset.pid === String(selectedPerson?.person_id));
  });
}

function selectCount(i, seek) {
  if (!score?.counts[i]) return;
  countIndex = i;
  if (seek && video.src) {
    video.currentTime = Math.max(0, score.counts[i].time_sec);
  }
  updateNowPlaying();
}

function addCountBlock(grid, c, globalI) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "count-block";
  btn.dataset.i = String(globalI);
  btn.dataset.time = String(c.time_sec);

  const pose = poseForCount(c, frames);
  if (pose) btn.classList.add("has-data");

  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 60;
  if (pose) drawPoseOnCanvas(canvas, pose);
  btn.appendChild(canvas);

  const num = document.createElement("span");
  num.className = "cb-num";
  num.textContent = c.count_display;
  btn.appendChild(num);

  const lbl = document.createElement("span");
  lbl.className = "cb-label";
  lbl.textContent = c.sheet_label || c.count_display;
  btn.appendChild(lbl);

  const dot = document.createElement("div");
  dot.className = "cb-dot";
  btn.appendChild(dot);

  btn.addEventListener("click", () => selectCount(globalI, true));
  grid.appendChild(btn);
}

function renderSheet() {
  const root = $("sheetTimeline");
  root.innerHTML = "";
  if (!phrases.length) return;

  phrases.forEach((phrase) => {
    const section = document.createElement("div");
    section.className = "phrase-timeline";

    const header = document.createElement("div");
    header.className = "timeline-header";
    header.innerHTML =
      `<span class="tl-title">${phrase.label}</span>` +
      `<span class="tl-mode">${phrase.label_ja}</span>`;
    section.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "count-grid";
    phrase.counts.forEach((c) => addCountBlock(grid, c, c.index - 1));
    section.appendChild(grid);

    root.appendChild(section);
  });
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
  setStatus("SCORE READY");
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
  $("loadBtn").addEventListener("click", loadAll);
  $("sampleBtn").addEventListener("click", () => {
    $("videoPath").value = "data/videos/PXL_20260228_101825443.mp4";
    $("scorePath").value = "data/output/PXL_20260228_101825443_score.json";
    loadAll();
  });
  $("rescanBtn").addEventListener("click", scanPeople);
  $("generateBtn").addEventListener("click", generateScore);

  video.addEventListener("play", () => {
    setStatus("PLAYING");
    cancelAnimationFrame(rafId);
    paintLoop();
  });
  video.addEventListener("pause", () => {
    setStatus("PAUSED");
    drawOverlay();
    highlightCells();
  });
  video.addEventListener("seeked", drawOverlay);
  video.addEventListener("timeupdate", () => {
    if (!score?.counts?.length) return;
    const i = nearestCountIndex(score.counts, video.currentTime);
    if (i !== countIndex) selectCount(i, false);
  });
  window.addEventListener("resize", () => {
    resizeOverlay();
    drawOverlay();
  });

  const p = new URLSearchParams(location.search);
  if (p.get("video")) $("videoPath").value = normalizeVideoPath(p.get("video"));
  if (p.get("score")) $("scorePath").value = p.get("score");

  loadAll();
}

init();
