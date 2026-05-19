## Phase 0: ローカルで動画 → ダンス譜面 JSON を生成する

### 目的

ダンス動画から譜面（カウント × 棒人間ポーズ）を **ローカル** で生成する。公開・クラウドは後回し。

### タスク

- [ ] ローカル環境（venv + `pip install -r requirements.txt`）
- [ ] `scripts/generate_score.py` で mp4 から JSON を生成
- [ ] 出力 `data/output/*_score.json` の `counts[]` に各拍の `pose` があることを確認
- [ ] `LOCAL.md` の手順どおり動くこと

### 受け入れ条件

- 指定したローカル mp4 から譜面 JSON が生成できる
- BPM と各カウントの `time_sec` / `pose` が含まれる

### 参照

- `dance app/README.md`
- `dance app/LOCAL.md`
