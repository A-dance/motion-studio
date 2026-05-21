"use client";
/**
 * StudioLoader — Three.js と localStorage を使うコンポーネントは
 * SSR を完全スキップする必要があるため、ここで dynamic + ssr:false を適用する
 */
import dynamic from "next/dynamic";

const StudioApp = dynamic(() => import("@/components/StudioApp"), { ssr: false });

export default function StudioLoader() {
  return <StudioApp />;
}
