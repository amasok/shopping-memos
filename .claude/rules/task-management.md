# タスク管理

## 基本方針

**タスク管理は GitHub Issues で行う。** Claude Code の TaskCreate/TaskUpdate ツールは使用しない。

## GitHub Issues の使い方

### Issue作成

```bash
gh issue create --title "タイトル" --label "ラベル" --body "本文"
```

### Issue一覧

```bash
gh issue list --state open
gh issue list --label "phase:1"
```

### Issue更新

```bash
gh issue close 1
gh issue reopen 1
gh issue edit 1 --add-label "in-progress"
```

### PRとの紐付け

PRの本文に `Closes #1` または `Fixes #1` を記載すると、マージ時に自動クローズされる。

```bash
gh pr create --title "feat: Zod導入" --body "Closes #1"
```

**注意**: Squashマージの場合、自動クローズが動作しないことがある。その場合はマージ後に手動で閉じる:

```bash
gh pr merge <番号> --squash --delete-branch
gh issue close <Issue番号> --comment "PR #<PR番号> でマージ済み"
```

## ラベル体系

| ラベル | 説明 |
|--------|------|
| `phase:1` 〜 `phase:4` | 実装フェーズ |
| `priority:high` | 高優先度 |
| `priority:medium` | 中優先度 |
| `backend` | バックエンド実装 |
| `bug` | バグ修正 |
| `enhancement` | 機能改善 |

## 依存関係の管理

**依存関係のあるIssueは、依存先がマージされてから実装を開始すること。**

### 依存関係の記載方法

Issue本文の先頭に依存関係セクションを追加:

```markdown
## 依存関係
- Depends on #8
- Depends on #9

---

## 概要
...
```

### 依存関係がない場合

```markdown
## 依存関係
なし（基盤Issue）

---
```

### 実装順序の決定

```
依存なし → 先に実装
依存あり → 依存先のPRがマージされてから実装開始
```

**並行実装は禁止。** 依存先がマージされていない状態で実装を始めると、コードの重複や手戻りが発生する。

## 作業フロー

```
1. Issue を確認
   gh issue list --state open

2. 作業開始時にラベル追加
   gh issue edit <番号> --add-label "in-progress"

3. ブランチ作成
   git checkout -b feature/issue-<番号>-<説明>

4. 実装 & コミット

5. PR作成（Issueを紐付け）
   gh pr create --title "feat: ..." --body "Closes #<番号>"

6. マージ
   gh pr merge <PR番号> --squash --delete-branch

7. Issueを手動で閉じる（自動クローズされなかった場合）
   gh issue close <番号> --comment "PR #<PR番号> でマージ済み"
```

## 禁止事項

- Claude Code の TaskCreate/TaskUpdate/TaskList ツールは使わない
- タスクをマークダウンファイルで管理しない（ドキュメントとしての参照用は可）
