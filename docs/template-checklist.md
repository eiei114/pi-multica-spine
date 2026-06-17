# Template Setup Checklist

このテンプレートから新しい Pi 拡張OSSを作った後に埋めること。

## Recommended flow

- [ ] Vault project notes を `4_Project/<ProjectName>/` に作る
- [ ] `CONTEXT.md` / `README.md` / `ROADMAP.md` / `Docs/` / `Issues/` / `Progress/` を揃える
- [ ] PRD を `4_Project/<ProjectName>/Docs/` に置く
- [ ] approved issue を `4_Project/<ProjectName>/Issues/` に切る
- [ ] OSS repo 側で実装する
- [ ] `npm run ci` / `npm test` / `npm pack --dry-run` を通す
- [ ] release 後に Vault へ learnings / release notes を戻す

## Repository

- [ ] GitHub repository name を決める
- [ ] GitHub About 欄を書く
- [ ] GitHub topics を設定する
  - [ ] `pi`
  - [ ] `pi-package`
  - [ ] `agent-skill`
  - [ ] `typescript`
- [ ] GitHub Settingsで `Template repository` をONにする
- [ ] Repository URL を `package.json` に反映する
- [ ] README の `OWNER/REPO` を実リポジトリに置き換える

## Package metadata

- [ ] `package.json` の `name` を変更する
- [ ] `description` を書く
- [ ] `author` を入れる
- [ ] `repository.url` を埋める
- [ ] `bugs.url` を埋める
- [ ] `homepage` を埋める
- [ ] `keywords` を見直す
- [ ] `LICENSE` の年・名前を更新する

## README placeholders

- [ ] `PACKAGE_DISPLAY_NAME` を置き換える
- [ ] `PACKAGE_NAME` を置き換える
- [ ] `OWNER/REPO` を置き換える
- [ ] one-line pitch を書く
- [ ] feature list を書く
- [ ] quick start command を実コマンドにする
- [ ] npm URL を確認する
- [ ] GitHub URL を確認する

## Pi package manifest

- [ ] `pi.extensions` に公開する拡張だけを残す
- [ ] `pi.skills` に公開する skill だけを残す
- [ ] 不要なら `prompts/` を消す
- [ ] 不要なら `themes/` を消す
- [ ] サンプル名を実名に変える

## Documentation

`docs/` は固定6ファイル必須ではない。README を正とし、価値がある doc だけ残す。

### Required root files (public)

- [ ] `README.md` — GitHub/npm の入口。Install / Quick start / Release / Security を含める
- [ ] `LICENSE`
- [ ] `SECURITY.md`
- [ ] `CHANGELOG.md`
- [ ] Release 手順が README と workflow で明確（Trusted Publishing 設定含む）

### Recommended public docs (keep when useful)

- [ ] `docs/examples.md` — 例が README に載り切らないとき
- [ ] `docs/release.md` — Trusted Publishing や release 手順の詳細が README だけでは足りないとき
- [ ] `docs/usage.md` — 使い方が README に載り切らないとき（必要なら新規作成）

### Optional maintainer docs

- [ ] `docs/template-checklist.md` — このファイル。成熟 repo では README からの主ナビにしない。不要なら削除可

### Post-generation cleanup (delete or merge template setup docs)

テンプレート生成直後の bootstrap 用。プロジェクト固有の価値がなければ削除し、必要な内容は README / `docs/release.md` / `docs/examples.md` に統合する。

- [ ] `docs/github-template.md` を削除するか、固有の手順だけ README / Vault に移す
- [ ] `docs/repository-settings.md` を削除するか、About/topics など必要分だけ README に移す
- [ ] `docs/typescript.md` を削除するか、TypeScript 方針は README Development に要約する
- [ ] README の Docs 節から、削除したファイルへのリンクを外す
- [ ] `package.json` の `files` から、削除した `docs/` パスを外す（残す doc だけ明示する）

## TypeScript

- [ ] `extensions/index.ts` を実装に合わせて更新する
- [ ] `extensions/hello.ts` が不要なら削除する
- [ ] 共通ロジックを `lib/` に切り出す
- [ ] `strict: true` を維持する
- [ ] custom tool parameters は TypeBox schema で定義する
- [ ] string choices は `StringEnum` helper を使う
- [ ] runtime dependency は `dependencies`、Pi提供packageは `peerDependencies` に置く
- [ ] `package.json.files` に公開対象だけを入れる
- [ ] 詳細はセットアップ中だけ `docs/typescript.md` を参照し、不要なら post-generation cleanup で削除

## GitHub Template repo

- [ ] `gh repo create --template OWNER/pi-extension-template` で作成できることを確認する
- [ ] public/privateどちらの作成例もdocsに載せる（`docs/github-template.md` を残す場合）

## CI / Release

- [ ] `npm run ci` が通る
- [ ] `npm pack --dry-run` が通る
- [ ] npm Trusted Publishing を設定する
- [ ] npm Trusted Publisher の workflow filename が `publish.yml` になっている
- [ ] `NPM_TOKEN` を使っていないことを確認する
- [ ] `auto-release.yml` が `main` の version bump から tag/release を作ることを確認する
- [ ] `publish.yml` が `workflow_dispatch` と `release.published` に対応していることを確認する
- [ ] 初回リリースで npm provenance が付いているか確認する

### Workflow handoff guard

- [ ] `.github/workflows/auto-release.yml` exists before first release
- [ ] `.github/workflows/publish.yml` exists before first release
- [ ] `auto-release.yml` has `permissions: actions: write` and `contents: write`
- [ ] `publish.yml` has `permissions: id-token: write` for npm Trusted Publishing
- [ ] Auto release explicitly hands off to publish: `gh workflow run publish.yml --ref "$TAG" -f ref="$TAG"`, or `publish.yml` has an equivalent `workflow_run` / `repository_dispatch` trigger
- [ ] Do not rely only on `push.tags` or `release.published` when the tag/release is created by `GITHUB_TOKEN`; that can leave npm unchanged after merge

## npm page

- [ ] npm package URL を README に追加する
- [ ] npm description が適切に表示されるか確認する
- [ ] provenance が付いているか確認する
- [ ] 不要なファイルが package に含まれていないか確認する（`npm pack --dry-run` で `docs/` の残し方も確認）

## Before first release

- [ ] サンプルコードを実機 Pi でロードする
- [ ] `pi install git:github.com/OWNER/REPO` を試す
- [ ] `pi -e .` を試す
- [ ] README のコマンドがコピペで動くか確認する
- [ ] CHANGELOG に `0.1.0` を書く
