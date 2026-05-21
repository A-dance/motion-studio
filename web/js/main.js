/**
 * Motion Studio — ポーズメモ帳（動画なし・手動ポーズ登録）
 */
import { createPose3DView } from "./pose-3d.js";
import { createPoseEditor } from "./pose-edit.js";
import { createBlankScore, downloadScore, loadScore } from "./score.js";
import { createStudio } from "./studio.js";

const $ = (sel) => document.querySelector(sel);

let score = null;
let countIndex = 0;
let studio = null;
let view3d = null;
let poseEditor = null;

const ui = {
  status: $("#status"),
  error: $("#error"),
  empty: $("#empty"),
  studio: $("#studio"),
  scorePath: $("#scorePath"),
};

function setStatus(msg) {
  if (ui.status) ui.status.textContent = msg;
}

function setError(msg) {
  if (!ui.error) return;
  ui.error.textContent = msg || "";
  ui.error.classList.toggle("hidden", !msg);
}

function showStudio(show) {
  ui.studio?.classList.toggle("hidden", !show);
  ui.empty?.classList.toggle("hidden", show);
}

function openScoreInMemory(data) {
  setError("");
  score = data;
  countIndex = 0;
  const titleInput = $("#choreoTitle");
  if (titleInput) {
    delete titleInput.dataset.userEdited;
    titleInput.value = score.title || "";
  }
  view3d?.reset?.();
  showStudio(true);
  poseEditor?.loadForCount(0);
  studio?.render();
  const registered = score.counts.filter((c) => c.pose && Object.keys(c.pose).length).length;
  setStatus(`${score.title || "Untitled"} · ${score.counts.length} counts · ${registered} poses`);
}

async function openScore(path) {
  const rel = path.replace(/^\//, "");
  ui.scorePath.value = rel;
  openScoreInMemory(await loadScore(rel));
}

function init() {
  const viewport = $("#viewport3d");
  if (viewport) view3d = createPose3DView(viewport);

  poseEditor = createPoseEditor({
    view3d,
    root: document.getElementById("app"),
    getScore: () => score,
    getIndex: () => countIndex,
    onChange: ({ draft } = {}) => {
      studio?.render();
      if (!draft) {
        const registered = score?.counts?.filter((c) => c.pose && Object.keys(c.pose).length).length ?? 0;
        setStatus(`${score?.title || "Untitled"} · ${score?.counts?.length ?? 0} counts · ${registered} poses`);
      }
    },
  });

  studio = createStudio({
    root: document.getElementById("app"),
    getScore: () => score,
    getIndex: () => countIndex,
    setIndex: (i) => {
      countIndex = i;
      poseEditor?.loadForCount(i);
    },
  });

  $("#btnNew")?.addEventListener("click", () => {
    setError("");
    openScoreInMemory(createBlankScore(8));
    ui.scorePath.value = "scripts/fixtures/blank_score.json";
    setStatus("新規メモ帳 — アバターを動かして各カウントに登録");
  });

  $("#btnLoad")?.addEventListener("click", async () => {
    try {
      await openScore(ui.scorePath?.value || "scripts/fixtures/blank_score.json");
    } catch (e) {
      setError(String(e.message || e));
    }
  });

  $("#btnLoadDemo")?.addEventListener("click", async () => {
    ui.scorePath.value = "scripts/fixtures/demo_score.json";
    try {
      await openScore(ui.scorePath.value);
    } catch (e) {
      setError(String(e.message || e));
    }
  });

  $("#btnApplyPaths")?.addEventListener("click", async () => {
    setError("");
    try {
      if (ui.scorePath?.value) await openScore(ui.scorePath.value);
    } catch (e) {
      setError(String(e.message || e));
    }
  });

  $("#btnDownload")?.addEventListener("click", () => {
    if (!score) return;
    downloadScore(score);
    setStatus("Downloaded JSON");
  });

  const params = new URLSearchParams(location.search);
  if (params.get("score")) ui.scorePath.value = params.get("score");

  if (params.get("score")) {
    openScore(params.get("score")).catch((e) => setError(String(e.message)));
  } else {
    openScoreInMemory(createBlankScore(8));
  }
}

init();
