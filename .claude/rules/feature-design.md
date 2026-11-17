# 機能設計（OpenSpec）

## 原則

**振る舞いを変える実装の前に、OpenSpec の change（proposal と specs）を作り、ユーザーの承認を得てから実装に入ること。**

- 全体の設計（システムの構成・コンテキスト・目指す構造）は `docs/design-doc.md`
- 今の振る舞いの正は `openspec/specs/`、これから変える分は `openspec/changes/<change>/`
- `docs/features/*.md` は新しく作らない。既存のうち `offline-support.md` は、#62 の全体の設計・実装ステップ・リリース手順として #62 が終わるまで更新する（O7 以降の振る舞いの仕様は各 change の specs に書き、archive で `openspec/specs/` に入ったものを正とする）。ほかのもの（passkey-email-auth.md など）は参照用

## GitHub Issues と OpenSpec の使い分け

| 置き場所 | 書くこと |
|---------|---------|
| GitHub Issue | 何を・なぜ・優先度・依存・バグ報告・リリースの追跡。タスク管理の正（`task-management.md`） |
| `openspec/changes/<change>/` | Issue に着手するときに作る。振る舞いの仕様の差分（specs）・設計（design）・実装手順（tasks） |
| `openspec/specs/` | 今の振る舞いの正。change の archive で更新される。手で直接書き換えない |

### change が要るもの・要らないもの

- **要る**: 振る舞いが変わる、新機能、仕様があいまいなもの
- **要らない（Issue だけ）**: 自明なバグ修正、依存の更新、振る舞いを変えないリファクタ、docs
- 設計や手順は残したいが仕様の差分がないもの（ツールの導入など）は、change の `.openspec.yaml` に `skip_specs: true` を書き、`openspec archive <change> --skip-specs` で閉じる

## change の作り方

準備（端末ごとに 1 回）: `npm install -g @fission-ai/openspec@latest`（2.1 系、Node 22.20 以上）と `openspec config set telemetry.enabled false`。テレメトリはプロジェクト単位では切れない（2.1 時点。環境変数 `OPENSPEC_TELEMETRY=0` でも切れる）。スキルを更新するときは `openspec update`（`.agents/skills/openspec-*` が書き換わり、`.claude/skills/openspec-*` はそこへのリンク）

```bash
openspec new change <Issue番号>-<短い名前>   # 例: 62-o7-catalog-local-first
# または Claude Code で /openspec-propose（proposal・specs・design・tasks をまとめて作る）
openspec validate <change> --strict           # 書式の確認（--strict は警告も失敗にする）
openspec show <change>
```

- change 名の先頭に Issue 番号を付け、`proposal.md` の冒頭に Issue へのリンクを書く
- `specs/<capability>/spec.md` は差分で書く（`## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements`）。Requirement は `### Requirement:`、Scenario は `#### Scenario:` の下に `- **WHEN**` / `- **THEN**`
- **各 Scenario に対応するテストを 1 つ以上書く**（tester が Scenario ごとに確かめる）
- 既存の機能の spec がまだないときは、その機能に触れる change の中で、触れる範囲の今の振る舞いも書き起こす。一度に全部は書かない
- `tasks.md` は、その change の実装手順のチェックリストとしてだけ使う
- 書き方の細かい規則は `openspec/config.yaml` の `context` と `rules`（OpenSpec のスキルと `openspec instructions` が読み込む）

## フロー

```
1. Issue を確認し、change を作る（proposal・specs、必要なら design、tasks）
2. リーダーがユーザーに proposal と specs のレビューを依頼する
3. 承認後に実装開始（/openspec-apply-change。tasks.md の順に、テストを先に書く）
4. 実装の担当が archive してコミットする（tester に渡す前）
   - openspec list で、その change のタスクがすべて完了していることを確かめる（-y は未完了があっても続く）
   - develop を取り込んでから openspec archive <change> -y
   → change は openspec/changes/archive/YYYY-MM-DD-<change>/ に移り、差分が openspec/specs/ に取り込まれる
   - 同じ capability を別の change が先に変えていないか、specs/ の差分で確かめる（MODIFIED は Requirement ごと置き換えるので、git で衝突しなくても先の変更を消すことがある）
5. tester が Scenario ごとのテストと E2E を確かめ、reviewer が archive を含めてレビュー
6. リーダーが PR を作り、本文に `Closes #N` と change のパス（archive 後のパス）を書く
```

## やってはいけないこと

- ❌ 振る舞いを変えるのに change なしで実装を始める
- ❌ proposal・specs の承認前にコードを書く
- ❌ specs と異なる実装をする（変えるときは change の specs を先に直し、承認を取り直す）
- ❌ archive しないまま PR をマージする
- ❌ archive を tasks.md のタスクにする（必ず未完了が残り、未完了の確認が働かなくなる）
