"use client";

import React, { useState, useRef, useEffect, useCallback, useReducer } from "react";
import {
  STAND_POSE, clonePose, makeWork, makePhrase, makeCount,
  hasContent, saveWork, loadWork, phraseLabel, applyChainIK,
  rotateJointChildren, JOINT_LABELS,
} from "@/lib/pose";
import { createStage, nextHeadYaw } from "@/lib/stage";
import {
  createItem, drawAnnotCanvas, hitTestItems,
  dragItemTip, dragItemRotate, dragItemArcStart, dragItemBendCP,
} from "@/lib/items";
import type { Work, Count, AnnotItem, ArrowItem, SpinItem, StageAPI, ViewPreset } from "@/lib/types";
import s from "./StudioApp.module.css";

const COUNTS = 16;

const BODY_DIRS = [
  { label: "正", yaw: 0,   preset: "front"    as ViewPreset },
  { label: "斜", yaw: 45,  preset: "diagonal" as ViewPreset },
  { label: "横", yaw: 90,  preset: "side"     as ViewPreset },
  { label: "後", yaw: 180, preset: "front"    as ViewPreset },
];

// 手先・足先の関節 ID セット（endRot 向き調整モード用）
const END_JOINTS = new Set(["handL","handR","footL","footR","wristL","wristR","ankleL","ankleR"]);

// P/Y/R 入力パネルを表示する関節一覧
const BONE_ROT_JOINTS = new Set([
  "head","neck",
  "shldrL","shldrR","elbowL","elbowR","wristL","wristR","handL","handR",
  "hip","hipL","hipR","kneeL","kneeR","ankleL","ankleR","footL","footR",
]);

export default function StudioApp() {
  // ── 状態 ─────────────────────────────────────────────
  const workRef      = useRef<Work>(makeWork());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const [phraseIdx,      setPhraseIdx]      = useState(0);
  const [countIdx,       setCountIdx]       = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedJoint,  setSelectedJoint]  = useState<string | null>(null);
  const [editItemId,     setEditItemId]     = useState<string | null>(null);
  const [inlinePos,      setInlinePos]      = useState({ x: 0, y: 0 });
  const [saveMsgVisible, setSaveMsgVisible] = useState(false);
  const [addFb,          setAddFb]          = useState("");
  // 手/足の四角が「向き調整モード」かどうか（ダブルクリックで切替）
  const [endRotJoint,    setEndRotJoint]    = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────
  const viewport3dRef  = useRef<HTMLDivElement>(null);
  const annotCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageWrapRef   = useRef<HTMLDivElement>(null);
  const stageRef       = useRef<StageAPI | null>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const dragKindRef   = useRef<string | null>(null);
  const dragJointRef  = useRef<string | null>(null);
  const dragItemIdRef = useRef<string | null>(null);
  const saveTimerRef  = useRef<ReturnType<typeof setTimeout>>(undefined);
  const addFbTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── ヘルパー ──────────────────────────────────────────
  const current     = useCallback((): Count => workRef.current.phrases[phraseIdx].counts[countIdx], [phraseIdx, countIdx]);
  const getItemById = useCallback((id: string | null): AnnotItem | null =>
    id ? current().items.find(i => i.id === id) ?? null : null, [current]);

  // ── Three.js 初期化 ──────────────────────────────────
  useEffect(() => {
    if (!viewport3dRef.current) return;
    stageRef.current = createStage(viewport3dRef.current);
    return () => { stageRef.current?.dispose(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── localStorage → workRef ───────────────────────────
  useEffect(() => {
    const saved = loadWork();
    if (saved) { workRef.current = saved; rerender(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── annotCanvas リサイズ ──────────────────────────────
  useEffect(() => {
    const wrap = stageWrapRef.current;
    if (!wrap || !annotCanvasRef.current) return;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!annotCanvasRef.current || w < 1 || h < 1) return;
      annotCanvasRef.current.width  = w;
      annotCanvasRef.current.height = h;
      stageRef.current?.resize(w, h);
      doRender();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 描画 ─────────────────────────────────────────────
  function doRender() {
    const c = current();
    stageRef.current?.render(c.pose, {
      bodyYaw: c.bodyYaw, headYaw: c.headYaw,
      selectedJoint, endRot: c.endRot,
    });
    if (annotCanvasRef.current) drawAnnotCanvas(annotCanvasRef.current, c.items, selectedItemId);
  }
  useEffect(() => { doRender(); });

  // ── 保存 ─────────────────────────────────────────────
  function scheduleSave() {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveWork(workRef.current), 800);
  }
  function mutate(fn: () => void) { fn(); scheduleSave(); rerender(); }

  // ── ポインター正規化 ─────────────────────────────────
  function stageNorm(ev: React.PointerEvent | React.MouseEvent) {
    const r = stageWrapRef.current!.getBoundingClientRect();
    return { x: (ev.clientX-r.left)/r.width, y: (ev.clientY-r.top)/r.height };
  }

  // ── ポインターダウン ─────────────────────────────────
  const onPointerDown = useCallback((ev: React.PointerEvent) => {
    if (ev.target === inlineInputRef.current) return;
    closeInlineEdit(true);

    const { x, y } = stageNorm(ev);
    const canvas    = annotCanvasRef.current;
    if (!canvas) return;

    // 1. 2D アノテーション
    const hit = hitTestItems(current().items, x, y, canvas);
    if (hit) {
      const p = hit.part;
      dragKindRef.current   = p === "tip" || p === "arc-end" ? "item-tip"
        : p === "rotate"    ? "item-rotate"
        : p === "arc-start" ? "item-arc-start"
        : p === "bend-cp"   ? "item-bend-cp"
        : "item-move";
      dragItemIdRef.current = hit.item.id;
      setSelectedItemId(hit.item.id);
      setSelectedJoint(null);
      ev.preventDefault();
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      return;
    }

    // 2. 3D ジョイント / ギズモリング / 手足の四角形
    const hitId = stageRef.current?.hitTestJoint(x, y);
    if (hitId) {
      if (hitId === "_nose") {
        mutate(() => { const c = current(); c.headYaw = nextHeadYaw(c.headYaw); });
        return;
      }

      const isShape   = hitId.endsWith("_rot");
      const jointId   = isShape ? hitId.slice(0, -4) : hitId;

      if (isShape && endRotJoint === jointId) {
        dragKindRef.current  = "end-rot";
        dragJointRef.current = jointId;
      } else if (isShape) {
        dragKindRef.current  = "joint-h";
        dragJointRef.current = jointId;
      } else {
        dragKindRef.current  = "joint-v";
        dragJointRef.current = jointId;
      }

      setSelectedJoint(hitId);
      setSelectedItemId(null);
      ev.preventDefault();
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      return;
    }

    // 3. 背景 → カメラオービット
    setSelectedItemId(null);
    setSelectedJoint(null);
    dragKindRef.current = "orbit";
    stageRef.current?.orbitStart(x, y);
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, phraseIdx, countIdx, endRotJoint]);

  // ── ポインタームーブ ─────────────────────────────────
  const onPointerMove = useCallback((ev: React.PointerEvent) => {
    const kind = dragKindRef.current;
    if (!kind) return;
    const { x, y } = stageNorm(ev);
    const canvas    = annotCanvasRef.current;

    if (kind === "orbit") { stageRef.current?.orbitMove(x, y); return; }

    // 向き調整ドラッグ
    if (kind === "end-rot" && dragJointRef.current) {
      const jointId = dragJointRef.current;
      const c = current();
      if (!c.endRot) c.endRot = {};
      const cur = c.endRot[jointId] ?? [0, 0];
      c.endRot[jointId] = [
        Math.max(-Math.PI * 0.9, Math.min(Math.PI * 0.9, cur[0] + ev.nativeEvent.movementY * 0.018)),
        cur[1] + ev.nativeEvent.movementX * 0.018,
      ];
      stageRef.current?.render(c.pose, { bodyYaw: c.bodyYaw, headYaw: c.headYaw, selectedJoint: dragJointRef.current + "_rot", endRot: c.endRot });
      scheduleSave();
      return;
    }

    // IK ドラッグ
    // joint-h → 水平面（形ドラッグ：前後左右）
    // joint-v → カメラ平面（球ドラッグ：上下左右）
    if ((kind === "joint-h" || kind === "joint-v") && dragJointRef.current) {
      const useH   = kind === "joint-h";
      const newPos = stageRef.current?.getDraggedPos(dragJointRef.current, x, y, useH);
      if (newPos) {
        const c  = current();
        c.pose   = applyChainIK(c.pose, dragJointRef.current, newPos);
        stageRef.current?.render(c.pose, { bodyYaw: c.bodyYaw, headYaw: c.headYaw, selectedJoint: dragJointRef.current, endRot: c.endRot });
        scheduleSave();
      }
      return;
    }

    const item = current().items.find(i => i.id === dragItemIdRef.current);
    if (!item || !canvas) return;
    if      (kind === "item-tip")       dragItemTip(item as ArrowItem, x, y, canvas);
    else if (kind === "item-rotate")    dragItemRotate(item as ArrowItem, x, y, canvas);
    else if (kind === "item-arc-start") dragItemArcStart(item as SpinItem, x, y, canvas);
    else if (kind === "item-bend-cp")   dragItemBendCP(item as ArrowItem, x, y, canvas);
    else if (kind === "item-move") {
      item.x = Math.max(0.05, Math.min(0.95, x));
      item.y = Math.max(0.05, Math.min(0.92, y));
    }
    drawAnnotCanvas(canvas, current().items, selectedItemId);
    scheduleSave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, selectedItemId]);

  const onPointerUp = useCallback((ev: React.PointerEvent) => {
    if (dragKindRef.current === "orbit") stageRef.current?.orbitEnd();
    dragKindRef.current   = null;
    dragJointRef.current  = null;
    dragItemIdRef.current = null;
    try { (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ダブルクリック ────────────────────────────────────
  const onDblClick = useCallback((ev: React.MouseEvent) => {
    const canvas = annotCanvasRef.current;
    if (!canvas) return;
    const { x, y } = stageNorm(ev);

    // テキストアイテムの編集
    const hit = hitTestItems(current().items, x, y, canvas);
    if (hit?.item.type === "text") {
      ev.preventDefault();
      setSelectedItemId(hit.item.id);
      setEditItemId(hit.item.id);
      setInlinePos({ x: ev.clientX, y: ev.clientY });
      setTimeout(() => { inlineInputRef.current?.focus(); inlineInputRef.current?.select(); }, 0);
      return;
    }

    // 手/足の四角形ダブルクリック → 向き調整モード切替
    const hitId = stageRef.current?.hitTestJoint(x, y);
    if (hitId?.endsWith("_rot")) {
      const jointId = hitId.slice(0, -4);
      if (END_JOINTS.has(jointId)) {
        setEndRotJoint(prev => prev === jointId ? null : jointId);
        ev.preventDefault();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  function closeInlineEdit(commit: boolean) {
    if (!editItemId) return;
    if (commit && inlineInputRef.current) {
      mutate(() => {
        const item = current().items.find(i => i.id === editItemId);
        if (item && item.type === "text") item.text = inlineInputRef.current!.value || item.text;
      });
    }
    setEditItemId(null);
  }

  // ── 削除 ─────────────────────────────────────────────
  function deleteSelected() {
    if (!selectedItemId) return;
    mutate(() => { current().items = current().items.filter(i => i.id !== selectedItemId); });
    setSelectedItemId(null);
  }

  // ── キーボード ────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if ((ev.target as HTMLElement).matches("input, textarea")) return;
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        const delta = ev.key === "ArrowRight" ? 1 : -1;
        setSelectedItemId(null); setSelectedJoint(null); setEndRotJoint(null);
        setCountIdx(ci => Math.max(0, Math.min(COUNTS-1, ci+delta)));
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && selectedItemId) {
        ev.preventDefault(); deleteSelected();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId, phraseIdx, countIdx]);

  // ── ポーズ操作 ────────────────────────────────────────
  function resetPose() {
    mutate(() => {
      const c = current();
      c.pose = clonePose(STAND_POSE);
      c.bodyYaw = 0; c.headYaw = 0;
      c.endRot = {}; c.boneRot = {};
    });
    setEndRotJoint(null);
  }

  function applyBodyDir(dir: typeof BODY_DIRS[number]) {
    mutate(() => { current().bodyYaw = dir.yaw; });
    stageRef.current?.applyViewPreset(dir.preset);
  }

  function copyCountForward() {
    if (countIdx >= COUNTS-1) return;
    const src = current();
    mutate(() => {
      const dst    = workRef.current.phrases[phraseIdx].counts[countIdx+1];
      dst.pose     = clonePose(src.pose);
      dst.bodyYaw  = src.bodyYaw;
      dst.headYaw  = src.headYaw;
      dst.endRot   = src.endRot  ? { ...src.endRot  } : {};
      dst.boneRot  = src.boneRot ? { ...src.boneRot } : {};
    });
    setCountIdx(ci => ci+1);
    setSelectedItemId(null); setSelectedJoint(null); setEndRotJoint(null);
  }

  // ── FK ボーン回転 ─────────────────────────────────────
  /**
   * 選択中の関節に P/Y/R の新しい絶対角度（度）を適用する。
   * 内部では「前回との差分（delta）」を子孫関節に FK で伝播する。
   */
  function applyBoneRot(jointId: string, axis: "x" | "y" | "z", newDeg: number) {
    mutate(() => {
      const c = current();
      if (!c.boneRot) c.boneRot = {};
      const [p, y, r] = c.boneRot[jointId] ?? [0, 0, 0];
      let deltaDeg: number;
      let next: [number, number, number];
      if (axis === "x") { deltaDeg = newDeg - p; next = [newDeg, y, r]; }
      else if (axis === "y") { deltaDeg = newDeg - y; next = [p, newDeg, r]; }
      else { deltaDeg = newDeg - r; next = [p, y, newDeg]; }

      if (Math.abs(deltaDeg) > 0.001) {
        c.pose = rotateJointChildren(c.pose, jointId, axis, deltaDeg);
      }
      c.boneRot[jointId] = next;
    });
  }

  /** 選択関節の boneRot カウンターをゼロに戻す（ポーズ位置は変えない） */
  function resetBoneRot(jointId: string) {
    mutate(() => {
      const c = current();
      if (c.boneRot) delete c.boneRot[jointId];
    });
  }

  // ── アイテム追加 ──────────────────────────────────────
  function addItem(type: AnnotItem["type"], extra: Partial<AnnotItem> = {}, msg: string) {
    const item = createItem(type, 0.5, type === "text" ? 0.35 : 0.6, extra);
    mutate(() => { current().items.push(item); });
    setSelectedItemId(item.id);
    setAddFb(msg);
    clearTimeout(addFbTimerRef.current);
    addFbTimerRef.current = setTimeout(() => setAddFb(""), 2500);
  }

  function updateItemProp(key: string, value: number) {
    const item = getItemById(selectedItemId);
    if (!item) return;
    mutate(() => { (item as unknown as Record<string, unknown>)[key] = value; });
  }

  // ── フレーズ操作 ──────────────────────────────────────
  function addPhrase() {
    mutate(() => { workRef.current.phrases.push(makePhrase(workRef.current.phrases.length)); });
    setPhraseIdx(workRef.current.phrases.length-1);
    setCountIdx(0); setSelectedItemId(null); setSelectedJoint(null); setEndRotJoint(null);
  }
  function deletePhrase(pi: number) {
    if (!confirm(`フレーズ ${workRef.current.phrases[pi].label} を削除しますか？`)) return;
    mutate(() => { workRef.current.phrases.splice(pi, 1); });
    setPhraseIdx(prev => Math.min(prev, workRef.current.phrases.length-1));
  }
  function navigateTo(pi: number, ci: number) {
    setPhraseIdx(pi); setCountIdx(ci);
    setSelectedItemId(null); setSelectedJoint(null); setEndRotJoint(null);
  }

  // ── 作品名 / 保存 ────────────────────────────────────
  function handleSave() {
    saveWork(workRef.current);
    setSaveMsgVisible(true);
    setTimeout(() => setSaveMsgVisible(false), 2500);
  }
  function handleNew() {
    if (!confirm("現在の内容を破棄して新しい作品を始めますか？")) return;
    workRef.current = makeWork();
    setPhraseIdx(0); setCountIdx(0); setSelectedItemId(null); setSelectedJoint(null); setEndRotJoint(null);
    rerender();
  }

  // ── 派生値 ───────────────────────────────────────────
  const c         = current();
  const selItem   = getItemById(selectedItemId);
  const isArrow   = selItem?.type === "arrow";
  const isSpin    = selItem?.type === "spin";
  const hasArrow  = isArrow || isSpin;
  const curPhrase = workRef.current.phrases[phraseIdx];

  // 関節編集パネル用（_rot サフィックスを除去して実 ID を得る）
  const editJointId  = selectedJoint
    ? selectedJoint.replace(/_rot$/, "")
    : null;
  const showBoneEdit = editJointId !== null && BONE_ROT_JOINTS.has(editJointId);

  // ── JSX ──────────────────────────────────────────────
  return (
    <div className={s.app}>

      {/* ヘッダー */}
      <header className={s.header}>
        <h1 className={s.brand}>Dance <span>Sequence</span> Note</h1>
        <div className={s.workControls}>
          <input className={s.workNameInput}
            defaultValue={workRef.current.name}
            placeholder="作品名…"
            onChange={(e) => { workRef.current.name = e.target.value; scheduleSave(); }}
          />
          <button className={s.btnHd} onClick={handleSave}>💾</button>
          <button className={s.btnHd} onClick={handleNew}>＋</button>
        </div>
      </header>

      <main className={s.main}>

        {/* 3D ステージ */}
        <section className={s.panelStage}>
          <div className={s.stageTopBar}>
            <span className={s.countBadge}>{curPhrase.label} – {countIdx+1}</span>
            {endRotJoint && (
              <span className={s.rotModeTag}>
                🔄 {endRotJoint} 向き調整中 — もう一度ダブルクリックで解除
              </span>
            )}
            {!endRotJoint && (
              <span className={s.stageHint}>
                球ドラッグ: 上下左右 &nbsp;·&nbsp; 形ドラッグ: 前後左右 &nbsp;·&nbsp;
                形ダブルクリック: 向き調整 &nbsp;·&nbsp; 🔴 鼻: 頭向き
              </span>
            )}
          </div>
          <div className={s.stageWrap} ref={stageWrapRef}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}    onPointerCancel={onPointerUp}
            onDoubleClick={onDblClick}
          >
            <div ref={viewport3dRef} className={s.viewport3d} />
            <canvas ref={annotCanvasRef} className={s.annotCanvas} />
          </div>
          <p className={s.stageFoot}>
            <kbd>←</kbd><kbd>→</kbd> カウント移動 &nbsp;·&nbsp;
            テキストを<strong>ダブルクリック</strong>で編集 &nbsp;·&nbsp;
            <kbd>Delete</kbd> 削除
          </p>
        </section>

        {/* 右パネル */}
        <section className={s.panelCtrl}>

          {/* フレーズ / カウント */}
          <div className={s.cb}>
            <div className={s.cbHead}>
              <span className={s.cbTitle}>フレーズ</span>
              <button className={s.btnXsLink} onClick={addPhrase}>＋追加</button>
            </div>
            <div className={s.phraseTimeline}>
              {workRef.current.phrases.map((phrase, pi) => (
                <div key={phrase.id} className={s.phraseRow}>
                  <span className={s.phraseLabel}>{phrase.label}</span>
                  <div className={s.phraseCounts}>
                    {phrase.counts.map((cnt, ci) => (
                      <React.Fragment key={ci}>
                        {ci === 8 && <span className={s.countDivider} />}
                        <button
                          className={`${s.countChip}${pi===phraseIdx && ci===countIdx ? " "+s.active : ""}${hasContent(cnt) ? " "+s.hasPose : ""}`}
                          onClick={() => navigateTo(pi, ci)}
                        >{ci+1}</button>
                      </React.Fragment>
                    ))}
                  </div>
                  {workRef.current.phrases.length > 1 && (
                    <button className={s.btnPhraseDel} onClick={() => deletePhrase(pi)}>×</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ポーズ管理 */}
          <div className={s.cb}>
            <div className={s.cbHead}>
              <span className={s.cbTitle}>ポーズ</span>
              <span className={s.cbBtns}>
                <button className={s.btnXs} onClick={resetPose}>🔄</button>
                <button className={s.btnXs} onClick={copyCountForward}>次→</button>
              </span>
            </div>
            <div className={s.dirRow}>
              {BODY_DIRS.map((d) => (
                <button key={d.label} className={`${s.btnDir}${c.bodyYaw === d.yaw ? " "+s.activDir : ""}`}
                  onClick={() => applyBodyDir(d)}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className={s.dirHint}>🔴 鼻クリックで頭の向きを切替</p>
          </div>

          {/* 関節調整（関節選択時のみ） */}
          {showBoneEdit && editJointId && (() => {
            const br = c.boneRot?.[editJointId] ?? [0, 0, 0];
            const axes: { label: string; axis: "x"|"y"|"z"; idx: 0|1|2 }[] = [
              { label: "P", axis: "x", idx: 0 },
              { label: "Y", axis: "y", idx: 1 },
              { label: "R", axis: "z", idx: 2 },
            ];
            return (
              <div className={s.cb}>
                <div className={s.cbHead}>
                  <span className={s.cbTitle}>
                    🦴 {JOINT_LABELS[editJointId] ?? editJointId}
                  </span>
                  <button className={s.btnXs}
                    title="このカウンターをリセット（ポーズは変えない）"
                    onClick={() => resetBoneRot(editJointId)}>0
                  </button>
                </div>
                <div className={s.pyrRow}>
                  {axes.map(({ label, axis, idx }) => (
                    <div key={axis} className={s.pyrCell}>
                      <span className={s.pyrLabel}>{label}</span>
                      <input
                        type="number"
                        step="1"
                        min={-180}
                        max={180}
                        className={s.pyrInput}
                        key={`${phraseIdx}-${countIdx}-${editJointId}-${axis}`}
                        defaultValue={Math.round(br[idx])}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (Number.isFinite(v)) applyBoneRot(editJointId, axis, v);
                        }}
                      />
                      <span className={s.pyrDeg}>°</span>
                    </div>
                  ))}
                </div>
                <p className={s.pyrHint}>子関節が連動します</p>
              </div>
            );
          })()}

          {/* アイテム追加 */}
          <div className={s.cb}>
            <div className={s.cbHead}>
              <span className={s.cbTitle}>追加</span>
              {addFb && <span className={s.addFb}>{addFb}</span>}
            </div>
            <div className={s.addToolbar}>
              <button className={s.btnAdd} title="進む矢印" onClick={() => addItem("arrow", { bend: 0 }, "矢印を追加")}>
                <svg viewBox="0 0 24 24"><line x1="5" y1="19" x2="19" y2="8" stroke="#c8a038" strokeWidth="2.8" strokeLinecap="round"/><polygon points="19,8 12,8 19,15" fill="#c8a038"/></svg>
                矢印
              </button>
              <button className={s.btnAdd} title="回転の矢印" onClick={() => addItem("spin", {}, "回転を追加")}>
                <svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 7 4" stroke="#4888b8" strokeWidth="2.6" strokeLinecap="round" fill="none"/><polygon points="19,8 15,4 23,6" fill="#4888b8"/></svg>
                回転
              </button>
              <button className={s.btnAdd} title="文字メモ（ダブルクリックで編集）"
                onClick={() => addItem("text", { text: "メモ" }, "テキスト追加")}>
                <svg viewBox="0 0 24 24"><text x="5" y="18" fontFamily="sans-serif" fontSize="15" fontWeight="700" fill="#be8898">T</text></svg>
                文字
              </button>
            </div>
          </div>

          {/* 矢印調整 */}
          {hasArrow && (
            <div className={s.cb}>
              <div className={s.cbHead}>
                <span className={s.cbTitle}>矢印</span>
                <button className={s.btnDel} onClick={deleteSelected}>🗑</button>
              </div>
              <div className={s.sp}>
                <label>角度<span>{Math.round((selItem as ArrowItem|SpinItem).angle)}°</span></label>
                <input type="range" min={0} max={359} value={(selItem as ArrowItem|SpinItem).angle}
                  onChange={(e) => updateItemProp("angle", Number(e.target.value))} />
              </div>
              <div className={s.sp}>
                <label>大きさ<span>{Math.round((selItem as ArrowItem|SpinItem).power*100)}%</span></label>
                <input type="range" min={15} max={100} value={Math.round((selItem as ArrowItem|SpinItem).power*100)}
                  onChange={(e) => updateItemProp("power", Number(e.target.value)/100)} />
              </div>
              {isArrow && (
                <div className={s.sp}>
                  <label>曲がり<span>{Math.round((selItem as ArrowItem).bend??0)}</span></label>
                  <input type="range" min={-100} max={100} value={(selItem as ArrowItem).bend??0}
                    onChange={(e) => updateItemProp("bend", Number(e.target.value))} />
                </div>
              )}
            </div>
          )}

          {/* フッター */}
          <div className={s.cbFoot}>
            {saveMsgVisible && <span className={s.saveMsg}>✓ 保存</span>}
          </div>
        </section>
      </main>

      {/* インライン編集 */}
      {editItemId && (
        <div className={s.inlineEdit} style={{ left: inlinePos.x, top: inlinePos.y }}>
          <input ref={inlineInputRef} className={s.inlineInput}
            defaultValue={(getItemById(editItemId) as {text?:string})?.text ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Enter")  closeInlineEdit(true);
              if (e.key === "Escape") closeInlineEdit(false);
            }}
            onBlur={() => closeInlineEdit(true)}
          />
        </div>
      )}
    </div>
  );
}
