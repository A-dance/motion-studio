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
export interface Count {
  n:       number;
  pose:    Pose;
  items:   AnnotItem[];
  bodyYaw: number;
  headYaw: number;
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
  render(pose: Pose, opts?: { bodyYaw?: number; headYaw?: number; selectedJoint?: string | null }): void;
  hitTestJoint(normX: number, normY: number): string | null;
  getDraggedPos(jointId: string, normX: number, normY: number): Vec3 | null;
  orbitStart(normX: number, normY: number): void;
  orbitMove(normX: number, normY: number): void;
  orbitEnd(): void;
  resize(w: number, h: number): void;
  applyViewPreset(preset: ViewPreset): void;
  dispose(): void;
}
