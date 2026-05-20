/** 譜面 JSON の読み込み・16カウント楽譜・骨格データ解決 */
import { COUNTS_PER_PHRASE } from "./constants.js";

export function countDisplayLabel(n) {
  const eight = Math.ceil(n / 2);
  return n % 2 === 0 ? `${eight}&` : String(eight);
}

export function enrichCount(c, globalIndex, countsPerPhrase = COUNTS_PER_PHRASE) {
  const idx = c.index ?? globalIndex + 1;
  const z = idx - 1;
  const phrase_index = c.phrase_index ?? Math.floor(z / countsPerPhrase) + 1;
  const count_in_phrase = c.count_in_phrase ?? (z % countsPerPhrase) + 1;
  const display = c.count_display ?? countDisplayLabel(count_in_phrase);
  const phrase_label = c.phrase_label ?? `${phrase_index}×16`;

  let beat_role = c.beat_role ?? null;
  let beat_role_ja = c.beat_role_ja ?? "";
  if (!beat_role) {
    if (count_in_phrase === 1) { beat_role = "ichi"; beat_role_ja = "イ"; }
    else if (count_in_phrase === 3) { beat_role = "ni"; beat_role_ja = "ニ"; }
    else if (count_in_phrase === 9) { beat_role = "ichi"; beat_role_ja = "イ"; }
    else if (count_in_phrase === 11) { beat_role = "ni"; beat_role_ja = "ニ"; }
  }

  return {
    ...c,
    index: idx,
    phrase_index,
    phrase_label,
    count_in_phrase,
    count_display: display,
    eight_block: Math.floor((count_in_phrase - 1) / 8) + 1,
    beat_role,
    beat_role_ja,
    sheet_label: c.sheet_label ?? `${phrase_label} · ${display}`,
  };
}

export function buildPhrases(counts) {
  const phrases = [];
  for (let i = 0; i < counts.length; i += COUNTS_PER_PHRASE) {
    const chunk = counts.slice(i, i + COUNTS_PER_PHRASE);
    if (!chunk.length) continue;
    const phrase_index = Math.floor(i / COUNTS_PER_PHRASE) + 1;
    phrases.push({
      phrase_index,
      label: `${phrase_index}×16`,
      label_ja: `第${phrase_index}節 · 16カウント`,
      counts: chunk,
    });
  }
  return phrases;
}

async function readJsonResponse(res, label) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  if (text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")) {
    throw new Error(
      `${label}: HTML が返りました（API 未対応のサーバーかも）。\n` +
        "serve_preview.py を再起動してください。"
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${label}: JSON 解析失敗 (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data.error || `${label} (${res.status})`);
  }
  return data;
}

export async function fetchJson(url, label = "API") {
  const res = await fetch(url);
  return readJsonResponse(res, label);
}

export async function fetchJsonPost(url, body, label = "API") {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonResponse(res, label);
}

export async function loadScoreJson(path) {
  const url = "/" + path.replace(/^\//, "");
  const raw = await fetchJson(url, `譜面 ${path}`);
  if (!raw.counts?.length) {
    throw new Error(`譜面 JSON に counts[] がありません: ${path}`);
  }
  const per = raw.audio?.counts_per_phrase || COUNTS_PER_PHRASE;
  const counts = raw.counts.map((c, i) => enrichCount(c, i, per));
  return {
    score: { ...raw, counts },
    phrases: buildPhrases(counts),
    frames: raw.frames?.length ? raw.frames : null,
  };
}

export function nearestCountIndex(counts, timeSec) {
  let best = 0;
  let bestD = Infinity;
  counts.forEach((c, i) => {
    const d = Math.abs(c.time_sec - timeSec);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function poseHasJoints(pose) {
  if (!pose) return false;
  return Object.values(pose).some((v) => v && v.length >= 2);
}

/** フレーム列から指定秒に最も近い骨格 */
export function poseAtFrameTime(frames, timeSec) {
  if (!frames?.length) return null;
  let best = frames[0];
  for (const f of frames) {
    if (Math.abs(f.time_sec - timeSec) < Math.abs(best.time_sec - timeSec)) best = f;
  }
  return best.pose ?? null;
}

/** カウントに紐づく骨格（counts[].pose を優先） */
export function poseForCount(count, frames) {
  if (poseHasJoints(count?.pose)) return count.pose;
  if (count?.time_sec != null) return poseAtFrameTime(frames, count.time_sec);
  return null;
}

export function poseAtTime(frames, counts, timeSec) {
  const i = nearestCountIndex(counts, timeSec);
  const fromCount = poseForCount(counts[i], frames);
  if (fromCount) return fromCount;
  return poseAtFrameTime(frames, timeSec);
}
