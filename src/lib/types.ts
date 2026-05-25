// ─── ポーズ・データ型 ───────────────────────────────────────
export type Vec3 = [number, number, number];
export type Pose = Record<string, Vec3>;

// ─── アノテーションアイテム ─────────────────────────────────
export interface BaseItem {
  id:    string;
  type:  "arrow" | "spin" | "text";
  x:     number;
  y:     number;
}

export interface ArrowItem extends BaseItem {
  type:  "arrow";
  angle: number;
  power: number;
  bend:  number;
  tilt:  number;
}

export interface SpinItem extends BaseItem {
  type:     "spin";
  angle:    number;
  power:    number;
  tilt:     number;
  arcStart: number;
  arcEnd:   number;
}

export interface TextItem extends BaseItem {
  type:     "text";
  text:     string;
  fontSize: number;
}

export type AnnotItem = ArrowItem | SpinItem | TextItem;

// ─── 楽曲構造 ───────────────────────────────────────────────
/** 手先・足先の方向オフセット（ラジアン）。[pitch, roll] */
export type EndRot = [number, number];

export interface Count {
  n:       number;
  pose:    Pose;
  items:   AnnotItem[];
  bodyYaw: number;
  headYaw: number;
  /** 手先・足先の向き。キー: "handL" | "handR" | "footL" | "footR" */
  endRot?: Record<string, EndRot>;
  /** FK ボーン回転（P/Y/R 度数）。キー: 関節ID, 値: [pitchX, yawY, rollZ] */
  boneRot?: Record<string, [number, number, number]>;
}

export interface Phrase {
  id:     string;
  label:  string;
  counts: Count[];
}

export interface Work {
  id:      string;
  name:    string;
  phrases: Phrase[];
}

// ─── Three.js ステージ API ──────────────────────────────────
export type ViewPreset = "front" | "diagonal" | "side";

export interface StageAPI {
  render(pose: Pose, opts?: {
    bodyYaw?: number;
    headYaw?: number;
    selectedJoint?: string | null;
    endRot?: Record<string, EndRot>;
  }): void;
  hitTestJoint(normX: number, normY: number): string | null;
  getDraggedPos(jointId: string, normX: number, normY: number, useHorizontalPlane?: boolean): Vec3 | null;
  orbitStart(normX: number, normY: number): void;
  orbitMove(normX: number, normY: number): void;
  orbitEnd(): void;
  resize(w: number, h: number): void;
  applyViewPreset(preset: ViewPreset): void;
  dispose(): void;
}
