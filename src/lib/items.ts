/**
 * items.ts — 2D アノテーションアイテム（矢印・回転・テキスト）
 *
 * テキストアイテムは Excel テキストボックス風（角丸白背景＋ボーダー）
 */
import type { AnnotItem, ArrowItem, SpinItem, TextItem } from "./types";

let idSeq = 1;
function uid() { return `item-${++idSeq}`; }

// ─── アイテム作成 ──────────────────────────────────────────
export function createItem(
  type: AnnotItem["type"],
  x = 0.5,
  y = 0.5,
  extra: Partial<AnnotItem> = {}
): AnnotItem {
  const base = { id: uid(), type, x, y };
  if (type === "arrow") {
    return { ...base, type: "arrow", angle: 45, power: 0.45, bend: 0, tilt: 0, ...extra } as ArrowItem;
  }
  if (type === "spin") {
    return { ...base, type: "spin", angle: 30, power: 0.4, tilt: 0, arcStart: -150, arcEnd: 150, ...extra } as SpinItem;
  }
  return { ...base, type: "text", text: "メモ", fontSize: 15, ...extra } as TextItem;
}

// ─── 描画ヘルパー ──────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r = 6) {
  ctx.save();
  ctx.fillStyle   = color;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function normAngle(a: number) { return ((a % 360) + 360) % 360; }

function tipXY(item: ArrowItem | SpinItem, w: number, h: number) {
  const cx = item.x * w;
  const cy = item.y * h;
  const r  = item.power * Math.min(w, h) * 0.28;
  const a  = (item.angle * Math.PI) / 180;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

// ベジェ制御点（曲がり矢印）
function bezierControl(item: ArrowItem, w: number, h: number) {
  const cx  = item.x * w;
  const cy  = item.y * h;
  const { x: ex, y: ey } = tipXY(item, w, h);
  const mx  = (cx + ex) / 2;
  const my  = (cy + ey) / 2;
  const dx  = ex - cx;
  const dy  = ey - cy;
  const len = Math.hypot(dx, dy);
  if (len < 4) return { cpx: mx, cpy: my };
  const nx = -dy / len;
  const ny =  dx / len;
  const b  = (item.bend ?? 0) * Math.min(w, h) * 0.002;
  return { cpx: mx + nx * b, cpy: my + ny * b };
}

// ─── 進む矢印（直線 or ベジェ） ────────────────────────────
function drawStraightArrow(ctx: CanvasRenderingContext2D, w: number, h: number, item: ArrowItem, selected: boolean) {
  const cx   = item.x * w;
  const cy   = item.y * h;
  const { x: ex, y: ey } = tipXY(item, w, h);
  const bend = item.bend ?? 0;
  const tiltFactor = Math.max(0.1, Math.abs(Math.cos(((item.tilt ?? 0) * Math.PI) / 180)));

  const grad = ctx.createLinearGradient(cx, cy, ex, ey);
  if (selected) {
    grad.addColorStop(0, "#fce090"); grad.addColorStop(0.5, "#e0a830"); grad.addColorStop(1, "#b07010");
  } else {
    grad.addColorStop(0, "#e8c870"); grad.addColorStop(0.5, "#c8a028"); grad.addColorStop(1, "#906010");
  }

  if (Math.abs(bend) > 1) {
    // 曲がり矢印（ベジェ）
    const { cpx, cpy } = bezierControl(item, w, h);
    const lw = (selected ? 11 : 9) * tiltFactor;
    const headAngle = Math.atan2(ey - cpy, ex - cpx);
    const hl  = 22;
    const hlen = Math.hypot(ex - cpx, ey - cpy);
    const ratio = hlen > hl ? (hlen - hl) / hlen : 0;
    const sex = cpx + (ex - cpx) * ratio;
    const sey = cpy + (ey - cpy) * ratio;

    ctx.save();
    ctx.shadowColor   = "rgba(100,60,0,0.3)";
    ctx.shadowBlur    = 6;
    ctx.shadowOffsetY = 2;
    ctx.strokeStyle   = grad;
    ctx.lineWidth     = lw;
    ctx.lineCap       = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cpx, cpy, sex, sey);
    ctx.stroke();
    ctx.shadowBlur = ctx.shadowOffsetY = 0;
    const hw = lw * 1.6 * tiltFactor;
    const nx = -Math.sin(headAngle) * tiltFactor;
    const ny =  Math.cos(headAngle) * tiltFactor;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(sex + nx * hw, sey + ny * hw);
    ctx.lineTo(sex - nx * hw, sey - ny * hw);
    ctx.lineTo(ex, ey);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (selected) {
      drawHandle(ctx, cx, cy, "#c9a962", 6);
      drawHandle(ctx, cpx, cpy, "#f0d060", 7);
      drawHandle(ctx, ex, ey, "#f0d060", 8);
      ctx.save();
      ctx.strokeStyle = "rgba(240,208,96,0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cpx, cpy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
  } else {
    // 直線矢印（ポリゴン）
    const dx  = ex - cx;
    const dy  = ey - cy;
    const len = Math.hypot(dx, dy);
    if (len < 6) return;
    const ux = dx / len; const uy = dy / len;
    const nx = -uy;      const ny =  ux;
    const bw = (selected ? 10 : 8)  * tiltFactor;
    const hw = (selected ? 20 : 16) * tiltFactor;
    const hl = Math.min(len * 0.38, 26);
    const sx = ex - ux * hl; const sy = ey - uy * hl;

    ctx.save();
    ctx.shadowColor   = "rgba(100,60,0,0.3)";
    ctx.shadowBlur    = selected ? 8 : 5;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle     = grad;
    ctx.beginPath();
    ctx.moveTo(cx + nx * bw * 0.55, cy + ny * bw * 0.55);
    ctx.lineTo(sx + nx * bw,        sy + ny * bw);
    ctx.lineTo(sx + nx * hw,        sy + ny * hw);
    ctx.lineTo(ex, ey);
    ctx.lineTo(sx - nx * hw,        sy - ny * hw);
    ctx.lineTo(sx - nx * bw,        sy - ny * bw);
    ctx.lineTo(cx - nx * bw * 0.55, cy - ny * bw * 0.55);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "rgba(255,245,180,0.55)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + nx * bw * 0.28, cy + ny * bw * 0.28);
    ctx.lineTo(sx + nx * bw * 0.48, sy + ny * bw * 0.48);
    ctx.stroke();
    ctx.restore();
    if (selected) {
      drawHandle(ctx, cx, cy, "#c9a962", 6);
      drawHandle(ctx, ex, ey, "#f0d060", 8);
    }
  }
}

// ─── 回転矢印 ─────────────────────────────────────────────
function drawSpinArrow(ctx: CanvasRenderingContext2D, w: number, h: number, item: SpinItem, selected: boolean) {
  const cx    = item.x * w;
  const cy    = item.y * h;
  const scale = item.power * Math.min(w, h) * 0.15;
  const tiltRad = ((item.tilt ?? 0) * Math.PI) / 180;
  const rx    = scale * 1.2;
  const ry    = scale * Math.max(0.12, Math.abs(Math.cos(tiltRad))) * 0.55;
  const startRad = (item.arcStart * Math.PI) / 180;
  const endRad   = (item.arcEnd   * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);

  const color = selected ? "#5898d8" : "#4888b8";
  ctx.shadowColor   = "rgba(30,60,130,0.35)";
  ctx.shadowBlur    = selected ? 8 : 5;
  ctx.shadowOffsetY = 2;
  ctx.strokeStyle   = color;
  ctx.lineWidth     = selected ? 4.5 : 3.5;
  ctx.lineCap       = "round";
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, tiltRad, startRad, endRad, false);
  ctx.stroke();

  ctx.shadowBlur = ctx.shadowOffsetY = 0;
  const tipAngle  = endRad;
  const tipX = Math.cos(tipAngle) * rx;
  const tipY = Math.sin(tipAngle) * ry;
  const tangentAngle = tipAngle + Math.PI / 2;
  const headLen = selected ? 13 : 10;
  const hnx = Math.cos(tangentAngle) * headLen;
  const hny = Math.sin(tangentAngle) * headLen;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX + hnx * 0.6, tipY + hny * 0.6);
  ctx.lineTo(tipX - hnx * 0.6, tipY - hny * 0.6);
  ctx.lineTo(tipX + Math.cos(tipAngle + Math.PI) * headLen, tipY + Math.sin(tipAngle + Math.PI) * headLen);
  ctx.closePath();
  ctx.fill();

  // 中心マーカー
  ctx.fillStyle = selected ? "rgba(88,152,216,0.5)" : "rgba(72,136,184,0.35)";
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  if (selected) {
    const arcStart = { x: cx + Math.cos(startRad) * rx, y: cy + Math.sin(startRad) * ry };
    const arcEnd   = { x: cx + Math.cos(endRad)   * rx, y: cy + Math.sin(endRad)   * ry };
    drawHandle(ctx, cx, cy, "#4888b8", 7);
    drawHandle(ctx, arcStart.x, arcStart.y, "#90c0e8", 6);
    drawHandle(ctx, arcEnd.x,   arcEnd.y,   "#4888b8", 8);
  }
}

// ─── テキストボックス（Excel 風） ────────────────────────
function drawTextItem(ctx: CanvasRenderingContext2D, w: number, h: number, item: TextItem, selected: boolean) {
  const cx       = item.x * w;
  const cy       = item.y * h;
  const fs       = item.fontSize ?? 15;
  const text     = item.text || "メモ";
  const padH     = 10;
  const padV     = 6;

  ctx.font = `500 ${fs}px "DM Sans", "Noto Sans JP", sans-serif`;
  const tw  = ctx.measureText(text).width;
  const bw  = tw + padH * 2;
  const bh  = fs + padV * 2;
  const rx  = cx - bw / 2;
  const ry  = cy - bh / 2;
  const r   = 4;

  ctx.save();

  // 影
  ctx.shadowColor   = "rgba(0,0,0,0.35)";
  ctx.shadowBlur    = selected ? 10 : 5;
  ctx.shadowOffsetY = selected ?  3 : 2;

  // 背景（Excel テキストボックス風: 薄い黄みのある白）
  ctx.fillStyle = selected ? "rgba(255,252,240,0.96)" : "rgba(248,244,230,0.90)";
  roundRect(ctx, rx, ry, bw, bh, r);
  ctx.fill();

  // ボーダー
  ctx.shadowBlur = ctx.shadowOffsetY = 0;
  ctx.strokeStyle = selected ? "#c8a038" : "rgba(160,140,90,0.65)";
  ctx.lineWidth   = selected ? 1.8 : 1;
  roundRect(ctx, rx, ry, bw, bh, r);
  ctx.stroke();

  // テキスト
  ctx.fillStyle    = "#2a1e08";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 ${fs}px "DM Sans", "Noto Sans JP", sans-serif`;
  ctx.fillText(text, cx, cy);

  // 選択時: 四隅のハンドル
  if (selected) {
    const corners = [
      [rx,      ry     ],
      [rx + bw, ry     ],
      [rx,      ry + bh],
      [rx + bw, ry + bh],
    ] as [number, number][];
    for (const [hx, hy] of corners) {
      ctx.fillStyle   = "#c8a038";
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth   = 1.2;
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ─── 全アイテム描画 ────────────────────────────────────────
export function drawAnnotCanvas(canvas: HTMLCanvasElement, items: AnnotItem[], selectedId: string | null) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return;
  const ctx = canvas.getContext("2d")!;
  const w   = canvas.width;
  const h   = canvas.height;
  ctx.clearRect(0, 0, w, h);
  for (const item of items) {
    const sel = item.id === selectedId;
    if      (item.type === "arrow") drawStraightArrow(ctx, w, h, item as ArrowItem, sel);
    else if (item.type === "spin")  drawSpinArrow(ctx, w, h, item as SpinItem, sel);
    else if (item.type === "text")  drawTextItem(ctx, w, h, item as TextItem, sel);
  }
}

// ─── ヒットテスト ──────────────────────────────────────────
function dist(ax: number, ay: number, bx: number, by: number) { return Math.hypot(bx - ax, by - ay); }

export function hitTestItems(
  items: AnnotItem[],
  normX: number,
  normY: number,
  canvas: HTMLCanvasElement
): { item: AnnotItem; part: string } | null {
  const w  = canvas.width;
  const h  = canvas.height;
  const mx = normX * w;
  const my = normY * h;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];

    if (item.type === "spin") {
      const si = item as SpinItem;
      const cx = si.x * w; const cy = si.y * h;
      const { x: ex, y: ey } = tipXY(si, w, h);
      const scale  = si.power * Math.min(w, h) * 0.15;
      const startX = cx + Math.cos((si.arcStart * Math.PI) / 180) * scale * 1.2;
      const startY = cy + Math.sin((si.arcStart * Math.PI) / 180) * scale * 0.55;
      if (dist(mx, my, ex, ey)     < 20) return { item, part: "arc-end" };
      if (dist(mx, my, startX, startY) < 18) return { item, part: "arc-start" };
      if (dist(mx, my, cx, cy)    < 22) return { item, part: "root" };
      continue;
    }

    if (item.type === "arrow") {
      const ai = item as ArrowItem;
      const cx  = ai.x * w; const cy = ai.y * h;
      const tip = tipXY(ai, w, h);
      if (dist(mx, my, tip.x, tip.y) < 18) return { item, part: "tip" };
      if (dist(mx, my, cx, cy)        < 22) return { item, part: "root" };
      if (Math.abs(ai.bend ?? 0) > 1) {
        const { cpx, cpy } = bezierControl(ai, w, h);
        if (dist(mx, my, cpx, cpy) < 20) return { item, part: "bend-cp" };
        const pts = [0.25, 0.5, 0.75].map((t) => ({
          x: (1-t)**2*cx + 2*(1-t)*t*cpx + t**2*tip.x,
          y: (1-t)**2*cy + 2*(1-t)*t*cpy + t**2*tip.y,
        }));
        if (pts.some((p) => dist(mx, my, p.x, p.y) < 16)) return { item, part: "shaft" };
      } else {
        const dx = tip.x - cx; const dy = tip.y - cy;
        const t  = Math.max(0, Math.min(1, ((mx-cx)*dx + (my-cy)*dy) / (dx*dx+dy*dy+0.01)));
        if (dist(mx, my, cx+dx*t, cy+dy*t) < 14) return { item, part: "shaft" };
      }
    }

    if (item.type === "text") {
      const ti = item as TextItem;
      if (dist(mx, my, ti.x * w, ti.y * h) < 60) return { item, part: "body" };
    }
  }
  return null;
}

// ─── ドラッグ関数 ──────────────────────────────────────────
export function dragItemTip(item: ArrowItem | SpinItem, normX: number, normY: number, canvas: HTMLCanvasElement) {
  if (item.type === "spin") {
    const w = canvas.width; const h = canvas.height;
    const dx = normX * w - item.x * w;
    const dy = normY * h - item.y * h;
    item.arcEnd = normAngle((Math.atan2(dy, dx) * 180) / Math.PI);
    return;
  }
  const w  = canvas.width; const h = canvas.height;
  const dx = normX * w - item.x * w;
  const dy = normY * h - item.y * h;
  item.angle = normAngle((Math.atan2(dy, dx) * 180) / Math.PI);
  item.power = Math.max(0.15, Math.min(1, Math.hypot(dx, dy) / (Math.min(w, h) * 0.28)));
}

export function dragItemRotate(item: ArrowItem | SpinItem, normX: number, normY: number, canvas: HTMLCanvasElement) {
  const w  = canvas.width; const h = canvas.height;
  const dx = normX * w - item.x * w;
  const dy = normY * h - item.y * h;
  item.angle = normAngle((Math.atan2(dy, dx) * 180) / Math.PI);
}

export function dragItemArcStart(item: SpinItem, normX: number, normY: number, canvas: HTMLCanvasElement) {
  const w  = canvas.width; const h = canvas.height;
  const dx = normX * w - item.x * w;
  const dy = normY * h - item.y * h;
  item.arcStart = normAngle((Math.atan2(dy, dx) * 180) / Math.PI);
}

export function dragItemBendCP(item: ArrowItem, normX: number, normY: number, canvas: HTMLCanvasElement) {
  const w  = canvas.width; const h = canvas.height;
  const cx = item.x * w; const cy = item.y * h;
  const { x: ex, y: ey } = tipXY(item, w, h);
  const mx = (cx + ex) / 2; const my = (cy + ey) / 2;
  const dx = ex - cx; const dy = ey - cy;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const nx = -dy / len; const ny = dx / len;
  const offset = (normX * w - mx) * nx + (normY * h - my) * ny;
  item.bend = Math.max(-100, Math.min(100, offset / (Math.min(w, h) * 0.002)));
}
