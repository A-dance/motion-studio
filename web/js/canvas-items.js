/**
 * キャンバス上の自由配置アイテム（直線矢印・回転矢印・文字）
 */

let idSeq = 1;

export function newItemId() {
  idSeq += 1;
  return `item-${idSeq}`;
}

// ─── 曲がり矢印のベジェ制御点 ───────────────────────────
// bend: -100〜100。0=直線。正=左折れ、負=右折れ（矢印方向基準）
function bezierControl(item, w, h) {
  const cx  = item.x * w;
  const cy  = item.y * h;
  const { x: ex, y: ey } = tipXY(item, w, h);
  const mx  = (cx + ex) / 2;
  const my  = (cy + ey) / 2;
  const dx  = ex - cx;
  const dy  = ey - cy;
  const len = Math.hypot(dx, dy);
  if (len < 4) return { cpx: mx, cpy: my };
  // 法線方向（矢印に垂直）に bend 分だけオフセット
  const nx = -dy / len;
  const ny =  dx / len;
  const b  = (item.bend ?? 0) * Math.min(w, h) * 0.0020;
  return { cpx: mx + nx * b, cpy: my + ny * b };
}

/**
 * 曲がり矢印のコントロールポイントをドラッグで動かす
 * 制御点が矢印の垂線方向にどれだけずれているかを bend 値に変換する
 */
export function dragItemBendCP(item, normX, normY, canvas) {
  const w  = canvas.width;
  const h  = canvas.height;
  const cx = item.x * w;
  const cy = item.y * h;
  const { x: ex, y: ey } = tipXY(item, w, h);
  const mx = (cx + ex) / 2;
  const my = (cy + ey) / 2;
  const dx = ex - cx;
  const dy = ey - cy;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const nx = -dy / len;
  const ny =  dx / len;
  const dragX = normX * w;
  const dragY = normY * h;
  // ドラッグ点が法線方向にどれだけ離れているかを bend に変換
  const offset = (dragX - mx) * nx + (dragY - my) * ny;
  item.bend = Math.max(-100, Math.min(100, offset / (Math.min(w, h) * 0.002)));
}

export function createItem(type, x = 0.5, y = 0.5, extra = {}) {
  const base = {
    id: newItemId(),
    type,
    x,
    y,
    angle: 90,
    power: 0.45,
    arcStart: -35,
    arcEnd: 220,
    tilt: 0,
    text: "",
  };
  if (type === "text") {
    return { ...base, text: extra.text || "メモ", angle: 0, power: 0 };
  }
  if (type === "spin") {
    return { ...base, angle: extra.angle ?? 0, arcStart: extra.arcStart ?? -35, arcEnd: extra.arcEnd ?? 220, tilt: extra.tilt ?? 0 };
  }
  return { ...base, ...extra };
}

function scaleOf(item, w, h) {
  return item.power * Math.min(w, h) * 0.22;
}

/** 回転矢印：ローカル座標 → 画面座標 */
function spinWorld(item, lx, ly, w, h) {
  const s = scaleOf(item, w, h);
  const tilt = (item.tilt * Math.PI) / 180;
  const rot = (item.angle * Math.PI) / 180;
  let x = lx * s;
  let y = ly * s;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const xr = x * ct - y * st;
  const yr = x * st + y * ct;
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  return {
    x: item.x * w + xr * ca - yr * sa,
    y: item.y * h + xr * sa + yr * ca,
  };
}

function arcWorld(item, deg, w, h) {
  const rad = (deg * Math.PI) / 180;
  return spinWorld(item, Math.cos(rad) * 1.2, Math.sin(rad) * 0.55, w, h);
}

function tipXY(item, w, h) {
  if (item.type === "spin") return arcWorld(item, item.arcEnd, w, h);
  const rad = (item.angle * Math.PI) / 180;
  const len = item.power * Math.min(w, h) * 0.28;
  return {
    x: item.x * w + Math.cos(rad) * len,
    y: item.y * h + Math.sin(rad) * len,
  };
}

function normAngle(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

/** マウス位置 → 回転矢印のローカル角度（arcStart / arcEnd 用） */
function localAngleFromMouse(item, normX, normY, canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const rot = (-item.angle * Math.PI) / 180;
  const tilt = (-item.tilt * Math.PI) / 180;
  const dx = normX * w - item.x * w;
  const dy = normY * h - item.y * h;
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  let xr = dx * ca - dy * sa;
  let yr = dx * sa + dy * ca;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const lx = (xr * ct - yr * st) / (scaleOf(item, w, h) || 1);
  const ly = (xr * st + yr * ct) / (scaleOf(item, w, h) || 1);
  return normAngle((Math.atan2(ly / 0.55, lx / 1.2) * 180) / Math.PI);
}

function drawArrowHead(ctx, ex, ey, rad, color, size = 10) {
  const a1 = rad + Math.PI * 0.82;
  const a2 = rad - Math.PI * 0.82;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex + Math.cos(a1) * size, ey + Math.sin(a1) * size);
  ctx.lineTo(ex + Math.cos(a2) * size, ey + Math.sin(a2) * size);
  ctx.closePath();
  ctx.fill();
}

function drawHandle(ctx, x, y, color, r = 7) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * 立体感のある太い金色矢印（直線 or ベジェ曲線）
 *  - bend ≠ 0: 二次ベジェ曲線で折り曲げる
 *  - tilt(°): cos(tilt) で幅を圧縮 → 奥に傾いているように見える
 *  - グラデーション + ハイライトで金属感を出す
 */
export function drawStraightArrow(ctx, w, h, item, selected) {
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
    // ── 曲がり矢印: 二次ベジェ曲線で太ストローク描画 ──
    const { cpx, cpy } = bezierControl(item, w, h);
    const lw = (selected ? 11 : 9) * tiltFactor;
    // 矢頭の向き: ベジェ終端の接線 = P2 - CP の方向
    const headAngle = Math.atan2(ey - cpy, ex - cpx);
    // 矢頭の分だけ胴を短くする
    const hl  = 22;
    const hlen = Math.hypot(ex - cpx, ey - cpy);
    const ratio = hlen > hl ? (hlen - hl) / hlen : 0;
    const shaftEndX = cpx + (ex - cpx) * ratio;
    const shaftEndY = cpy + (ey - cpy) * ratio;

    ctx.save();
    ctx.shadowColor   = "rgba(100, 60, 0, 0.28)";
    ctx.shadowBlur    = 6;
    ctx.shadowOffsetY = 2;
    ctx.strokeStyle   = grad;
    ctx.lineWidth     = lw;
    ctx.lineCap       = "round";
    ctx.lineJoin      = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cpx, cpy, shaftEndX, shaftEndY);
    ctx.stroke();

    // 矢頭（三角ポリゴン）
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetY = 0;
    const hw = lw * 1.6 * tiltFactor;
    const nx = -Math.sin(headAngle) * tiltFactor;
    const ny =  Math.cos(headAngle) * tiltFactor;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(shaftEndX + nx * hw, shaftEndY + ny * hw);
    ctx.lineTo(shaftEndX - nx * hw, shaftEndY - ny * hw);
    ctx.lineTo(ex, ey);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (selected) {
      drawHandle(ctx, cx,  cy,  "#c9a962", 6);
      drawHandle(ctx, cpx, cpy, "#f0d060", 7); // コントロールポイント
      drawHandle(ctx, ex,  ey,  "#f0d060", 8);
      // 制御線（薄く）
      ctx.save();
      ctx.strokeStyle = "rgba(240,208,96,0.35)";
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cpx, cpy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

  } else {
    // ── 直線矢印: テーパー付きポリゴン ──
    const dx  = ex - cx;
    const dy  = ey - cy;
    const len = Math.hypot(dx, dy);
    if (len < 6) return;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny =  ux;
    const bw = (selected ? 10 : 8)  * tiltFactor;
    const hw = (selected ? 20 : 16) * tiltFactor;
    const hl = Math.min(len * 0.38, 26);
    const sx = ex - ux * hl;
    const sy = ey - uy * hl;

    ctx.save();
    ctx.shadowColor   = "rgba(100, 60, 0, 0.3)";
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
    ctx.closePath();
    ctx.fill();

    // ハイライト
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle   = "rgba(255, 245, 180, 0.55)";
    ctx.lineWidth     = 1.5;
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

/**
 * すっきりしたターン弧矢印（1重の楕円弧 + 矢頭）
 *  - tilt(°): cos(tilt) で Y半径を圧縮 → 斜め見下ろしに見える
 *  - 選択時: ハンドル（中心・先端・始点・回転）を表示
 */
export function drawSpinArrow(ctx, w, h, item, selected) {
  const cx       = item.x * w;
  const cy       = item.y * h;
  const scale    = scaleOf(item, w, h);
  const rot      = (item.angle    * Math.PI) / 180;
  const startRad = ((item.arcStart ?? -35)  * Math.PI) / 180;
  const endRad   = ((item.arcEnd   ?? 220)  * Math.PI) / 180;
  const tiltRad  = ((item.tilt     ?? 0)    * Math.PI) / 180;

  const rx = scale * 1.2; // X半径（そのまま）
  const ry = scale * 0.55; // Y半径（tilt は ellipse 自体の回転として表現）

  const color = selected ? "#3a8eb0" : "#5a9eb8";
  const lw    = selected ? 4 : 3;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  // メインの弧（グラデーションストローク）
  ctx.shadowColor = "rgba(50, 120, 160, 0.25)";
  ctx.shadowBlur  = selected ? 8 : 4;
  ctx.strokeStyle = color;
  ctx.lineWidth   = lw;
  ctx.lineCap     = "round";

  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, tiltRad, startRad, endRad, false);
  ctx.stroke();

  // 中央の薄い回転中心マーカー
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = selected ? "rgba(58,142,176,0.2)" : "rgba(90,158,184,0.12)";
  ctx.beginPath();
  ctx.ellipse(0, 0, scale * 0.38, scale * 0.15, tiltRad, 0, Math.PI * 2);
  ctx.fill();

  // 矢頭（先端の接線方向に合わせる）
  const ex = Math.cos(endRad) * rx;
  const ey = Math.sin(endRad) * ry;
  const tx = ex * Math.cos(tiltRad) - ey * Math.sin(tiltRad);
  const ty = ex * Math.sin(tiltRad) + ey * Math.cos(tiltRad);
  drawArrowHead(ctx, tx, ty, endRad + tiltRad + Math.PI / 2, color, selected ? 11 : 9);

  if (selected) {
    const rotPt      = spinWorld(item, 1.35, 0, w, h);
    const tipPt      = arcWorld(item, item.arcEnd, w, h);
    const startWorld = arcWorld(item, item.arcStart, w, h);

    ctx.restore(); // transform を戻してからハンドルをワールド座標で描く
    drawHandle(ctx, cx, cy, color, 7);
    drawHandle(ctx, rotPt.x, rotPt.y, "#8ad4f0", 8);
    drawHandle(ctx, tipPt.x, tipPt.y, "#c9a962", 8);
    drawHandle(ctx, startWorld.x, startWorld.y, "#a8d4e8", 7);
    return;
  }
  ctx.restore();
}

export function drawTextLabel(ctx, w, h, item, selected) {
  const x = item.x * w;
  const y = item.y * h;
  ctx.save();
  ctx.font = "600 15px DM Sans, Noto Sans JP, sans-serif";
  const pad = 8;
  const text = item.text || "メモ";
  const mw = ctx.measureText(text).width + pad * 2;
  const mh = 26;

  ctx.fillStyle = selected ? "rgba(255, 110, 180, 0.2)" : "rgba(255, 255, 255, 0.85)";
  ctx.strokeStyle = selected ? "#ff6eb4" : "#e8e2d8";
  ctx.lineWidth = selected ? 2 : 1;
  roundRect(ctx, x - pad, y - mh / 2, mw, mh, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#2a2622";
  ctx.fillText(text, x, y + 5);

  if (selected) {
    drawHandle(ctx, x, y, "#ff6eb4", 6);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, rw, rh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + rw, y, x + rw, y + rh, r);
  ctx.arcTo(x + rw, y + rh, x, y + rh, r);
  ctx.arcTo(x, y + rh, x, y, r);
  ctx.arcTo(x, y, x + rw, y, r);
  ctx.closePath();
}

export function drawAllItems(ctx, w, h, items, selectedId) {
  for (const item of items) {
    const sel = item.id === selectedId;
    if (item.type === "arrow") drawStraightArrow(ctx, w, h, item, sel);
    else if (item.type === "spin") drawSpinArrow(ctx, w, h, item, sel);
    else if (item.type === "text") drawTextLabel(ctx, w, h, item, sel);
  }
}

/**
 * annotCanvas に全アイテムを描画するユーティリティ
 * （app.js から直接呼ぶ用）
 */
export function drawAnnotCanvas(canvas, items, selectedId) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return;
  const ctx = canvas.getContext("2d");
  const w   = canvas.width;
  const h   = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawAllItems(ctx, w, h, items, selectedId);
}

function dist(mx, my, px, py) {
  return Math.hypot(px - mx, py - my);
}

export function hitTestItems(items, normX, normY, canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const mx = normX * w;
  const my = normY * h;

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];

    if (item.type === "spin") {
      const cx = item.x * w;
      const cy = item.y * h;
      const tip = arcWorld(item, item.arcEnd, w, h);
      const start = arcWorld(item, item.arcStart, w, h);
      const rotate = spinWorld(item, 1.35, 0, w, h);

      if (dist(mx, my, tip.x, tip.y) < 20) return { item, part: "arc-end" };
      if (dist(mx, my, start.x, start.y) < 18) return { item, part: "arc-start" };
      if (dist(mx, my, rotate.x, rotate.y) < 20) return { item, part: "rotate" };
      if (dist(mx, my, cx, cy) < 22) return { item, part: "root" };
      continue;
    }

    if (item.type === "arrow") {
      const tip = tipXY(item, w, h);
      const cx  = item.x * w;
      const cy  = item.y * h;
      if (dist(mx, my, tip.x, tip.y) < 18) return { item, part: "tip" };
      if (dist(mx, my, cx, cy)        < 22) return { item, part: "root" };
      // 曲がり矢印のコントロールポイント
      if (Math.abs(item.bend ?? 0) > 1) {
        const { cpx, cpy } = bezierControl(item, w, h);
        if (dist(mx, my, cpx, cpy) < 20) return { item, part: "bend-cp" };
      }
      // シャフト判定（ベジェの近似: 3点サンプリング）
      const samplePoints = Math.abs(item.bend ?? 0) > 1
        ? (() => {
            const { cpx, cpy } = bezierControl(item, w, h);
            return [0.25, 0.5, 0.75].map((t) => ({
              x: (1-t)**2 * cx + 2*(1-t)*t * cpx + t**2 * tip.x,
              y: (1-t)**2 * cy + 2*(1-t)*t * cpy + t**2 * tip.y,
            }));
          })()
        : (() => {
            const dx = tip.x - cx;
            const dy = tip.y - cy;
            const t  = Math.max(0, Math.min(1, ((mx - cx) * dx + (my - cy) * dy) / (dx * dx + dy * dy + 0.01)));
            return [{ x: cx + dx * t, y: cy + dy * t }];
          })();
      if (samplePoints.some((p) => dist(mx, my, p.x, p.y) < 16)) return { item, part: "shaft" };
    }

    if (item.type === "text") {
      const cx = item.x * w;
      const cy = item.y * h;
      if (dist(mx, my, cx, cy) < 56) return { item, part: "body" };
    }
  }
  return null;
}

export function dragItemTip(item, normX, normY, canvas) {
  if (item.type === "spin") {
    item.arcEnd = localAngleFromMouse(item, normX, normY, canvas);
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const cx = item.x * w;
  const cy = item.y * h;
  const dx = normX * w - cx;
  const dy = normY * h - cy;
  item.angle = normAngle((Math.atan2(dy, dx) * 180) / Math.PI);
  const len = Math.hypot(dx, dy);
  item.power = Math.max(0.15, Math.min(1, len / (Math.min(w, h) * 0.28)));
}

export function dragItemRotate(item, normX, normY, canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const dx = normX * w - item.x * w;
  const dy = normY * h - item.y * h;
  item.angle = normAngle((Math.atan2(dy, dx) * 180) / Math.PI);
}

export function dragItemArcStart(item, normX, normY, canvas) {
  item.arcStart = localAngleFromMouse(item, normX, normY, canvas);
}

export function dragItemTilt(item, normX, normY, canvas) {
  item.tilt = normAngle(localAngleFromMouse(item, normX, normY, canvas));
}
