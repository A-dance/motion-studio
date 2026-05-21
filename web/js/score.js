/** 譜面 JSON — 読み込み・正規化（心臓部のデータ形） */
import { COUNTS_PER_PHRASE } from "./constants.js";

export function countDisplayLabel(n) {
  const eight = Math.ceil(n / 2);
  return n % 2 === 0 ? `${eight}&` : String(eight);
}

export function enrichCount(c, globalIndex, per = COUNTS_PER_PHRASE) {
  const idx = c.index ?? globalIndex + 1;
  const z = idx - 1;
  const phrase_index = c.phrase_index ?? Math.floor(z / per) + 1;
  const count_in_phrase = c.count_in_phrase ?? (z % per) + 1;
  const display = c.count_display ?? countDisplayLabel(count_in_phrase);
  return {
    ...c,
    index: idx,
    phrase_index,
    phrase_label: c.phrase_label ?? `${phrase_index}×16`,
    count_in_phrase,
    count_display: display,
    description: c.description ?? "",
    memo: c.memo ?? "",
    transition: c.transition ?? "",
  };
}

export function normalizeScore(raw) {
  if (!raw?.counts?.length) throw new Error("counts[] がありません");
  const per = raw.audio?.counts_per_phrase || COUNTS_PER_PHRASE;
  const counts = raw.counts.map((c, i) => enrichCount(c, i, per));
  return {
    ...raw,
    version: raw.version ?? 4,
    title: raw.title ?? "",
    counts,
  };
}

export function hasPose(pose) {
  return pose && Object.keys(pose).some((k) => pose[k]?.length >= 2);
}

export async function fetchJson(url) {
  const res = await fetch(url.startsWith("/") ? url : `/${url}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("HTML が返りました。serve_preview.py を起動してください。");
  }
  const data = JSON.parse(text);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function loadScore(path) {
  const rel = path.replace(/^\//, "");
  return normalizeScore(await fetchJson(`/${rel}`));
}

export function countTitle(c, i) {
  return c.count_display ?? c.label ?? String(i + 1);
}

/** 空のメモ帳（ポーズ未登録） */
export function createBlankScore(countTotal = 8) {
  const counts = Array.from({ length: countTotal }, (_, i) =>
    enrichCount(
      {
        index: i + 1,
        description: "",
        memo: "",
        transition: "",
      },
      i,
    ),
  );
  return {
    version: 4,
    title: "",
    audio: { bpm: 120, counts_per_phrase: COUNTS_PER_PHRASE },
    counts,
  };
}

export function downloadScore(score) {
  const blob = new Blob([JSON.stringify(score, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const name = (score.title || "motion_studio").replace(/\s+/g, "_");
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
