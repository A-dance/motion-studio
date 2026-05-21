# UI 参考モック（ユーザー提示）

> イメージ: **左 = 3D アバター（今のカウント）** / **右 = 振り付けメモ（シーケンス全体）**

参照画像: [ui-mockup-reference.png](./ui-mockup-reference.png)

---

## 画面構成

```
┌─────────────────────┬──────────────────────────────────┐
│  Avatar             │  Pose Memo (Sequence View)       │
│  Count 2            │  Choreography: ○○ (Verse 1)     │
│                     │  [1][2●][3][4][5 EMPTY]         │
│  3D人形 + 角度表示   │  Description + [FLOW PREVIEW]   │
│                     │  Pose image (Count 2)           │
│                     │  Notes & Feedback               │
│                     │  Sequence Flow (次のステップ)    │
└─────────────────────┴──────────────────────────────────┘
```

---

## 要素 ↔ データ（譜面 JSON）

| UI | JSON / 機能 | いま |
|----|-------------|------|
| `Count N` ヘッダ | `counts[].index` / `count_display` | あり |
| 3D アバター | `counts[].pose` → 3D IK | マネキンあり・アバター未 |
| 関節角度（-30° 等） | ポーズから算出 or 手入力 | **未** |
| 振り付けタイトル | `score.title` / `source.label` | **未**（path のみ） |
| カウント列サムネ | `counts[]` + サムネ画像 or 3D スナップ | 16 グリッドあり・ラベル簡素 |
| `CURRENT` ハイライト | UI 状態 `selectedCount` | あり |
| `EMPTY` スロット | 未登録カウント | **未** |
| Description | `counts[].description` | **未**（`sheet_label` のみ） |
| FLOW PREVIEW | カウント間モーフ（`drawMotionPreview`） | サイドパネルのみ |
| Pose image | 登録ポーズの静止画 or 3D キャプチャ | **未** |
| Notes & Feedback | `counts[].memo` | **未** |
| Sequence Flow | `counts[].transition` or 次カウントへのメモ | **未** |

### 譜面 JSON 拡張案（v4）

```json
{
  "title": "K-Pop Fundamentals (Verse 1)",
  "version": 4,
  "counts": [
    {
      "index": 2,
      "count_display": "2&",
      "time_sec": 0.5,
      "description": "Shoulder pop and low stance transition (2 &)",
      "memo": "Shift weight quickly on '&' count. Keep arms symmetrical.",
      "transition": "Smooth transition into Count 3 right foot step.",
      "pose": { "...": [] },
      "angles": { "left_elbow": -30, "right_elbow": -20 }
    }
  ]
}
```

`angles` は任意（3D から自動算出でも可）。

---

## 人間 / 自動（この UI 前提）

| 人間 | アプリ |
|------|--------|
| サムネを見てカウントを選ぶ | 列表示・CURRENT・EMPTY |
| Description / Notes / Flow を書く | テキスト保存 |
| ポーズを決める（自分で） | 3D ドラッグ登録（動画参照なし） |
| 角度の意味を読む | 関節角の表示（補助） |

---

## 実装フェーズ（モック準拠）

| 順 | 内容 |
|----|------|
| 1 | レイアウト: 左 Avatar / 右 Memo の 2 ペイン |
| 2 | 右: カウント列 + **memo / description / transition** 編集・保存 |
| 3 | 左: 選択カウントの 3D アバター（IK） |
| 4 | FLOW PREVIEW を右ペインに統合 |
| 5 | 関節角度オーバーレイ（オプション） |
| 6 | サムネ・Pose image（3D スナップ or 静止画） |

実装: `web/index.html` + `web/js/main.js` + `web/js/studio.js`（2025 新規作り直し）

---

## コンセプトとの一致

[CONCEPT.md](../CONCEPT.md) v2「振り付けメモ + 3D 自習」と一致。  
動画読取アプリではなく **シーケンスエディタ + 練習ビューア** として設計する。
