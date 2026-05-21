# GitHub に新リポジトリとして載せる手順

このフォルダは **`cursor` モノレポから切り出した Motion Studio 専用リポジトリ**です。  
ローカル Git の履歴（`dance app/` 配下のコミット）は `main` に引き継いでいます。

## 1. GitHub で空リポジトリを作る

例: `A-dance/motion-studio`（Private 推奨）

- **README / .gitignore / license は追加しない**（既にローカルにあるため）

## 2. リモートを付けて push

```bash
cd /Users/ayana/motion-studio

git remote add origin git@github.com:A-dance/motion-studio.git
git push -u origin main
```

SSH ではなく HTTPS の場合:

```bash
git remote add origin https://github.com/A-dance/motion-studio.git
git push -u origin main
```

## 3. Cursor で開き直す

- **File → Open Folder** → `/Users/ayana/motion-studio`
- 旧パス `cursor/dance app` は演習用モノレポ側。今後の開発はこちらを正とする。

## 4. 旧モノレポ（任意）

`cursor` リポジトリの `dance app/` は `MOVED.md` を参照。  
マージ済みなら、別 PR で `dance app/` 削除またはアーカイブしてよい。
