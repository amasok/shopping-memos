---
name: learn
description: 問題解決のパターンを抽出し、再利用可能なスキルとして保存。/learn で実行。
tools: ["Read", "Write", "Glob"]
---

# /learn - パターン学習

セッション中に解決した問題から、再利用可能なパターンを抽出して保存する。

## コマンド

```
/learn              - 現在のセッションからパターンを抽出
/learn list         - 保存済みパターン一覧
/learn show <名前>   - 特定パターンの詳細表示
```

## 抽出対象のパターン

### 1. エラー解決パターン
- 何が壊れていたか
- なぜ壊れていたか
- どう直したか

### 2. デバッグテクニック
- 効果的だった診断方法
- 使用したツールの組み合わせ

### 3. ワークアラウンド
- ライブラリの癖
- バージョン固有の問題
- 回避策

### 4. プロジェクトパターン
- コードベースの規約
- アーキテクチャ上の決定

## パターン抽出ワークフロー

1. **セッションレビュー**
   - 解決した問題を振り返る
   - 特に困難だった箇所を特定

2. **パターン特定**
   - 再利用価値があるか評価
   - 一般化できるか確認

3. **ドキュメント作成**
   - 問題、解決策、例を記述

4. **ユーザー確認**
   - 保存前に内容を確認

5. **スキルファイル保存**
   - `.claude/skills/learned/` に保存

## スキルファイルテンプレート

```markdown
---
name: パターン名
description: 簡潔な説明
tags: [error, nextjs, drizzle]
learned_at: 2024-01-27
---

# パターン名

## 問題
[どのような問題が発生したか]

## 原因
[なぜ発生したか]

## 解決策
[どう解決したか]

## 例

### Before (問題のあるコード)
\`\`\`typescript
// 問題のあるコード
\`\`\`

### After (修正後)
\`\`\`typescript
// 修正後のコード
\`\`\`

## 適用条件
- [このパターンを適用すべき状況]

## 関連
- [関連するドキュメントやリンク]
```

## フィルタリング基準

### ✅ 保存すべき
- 30分以上かかった問題の解決
- ドキュメントに記載されていない情報
- プロジェクト固有の重要な決定
- 再発しそうな問題

### ❌ 保存しない
- 単純なタイポの修正
- 一度きりの問題
- すでに文書化されている内容
- 汎用性のないコード

## 保存例

### Drizzle N+1問題の解決

```markdown
---
name: drizzle-n-plus-one
description: DrizzleでN+1問題を解決するinArrayパターン
tags: [drizzle, performance, database]
learned_at: 2024-01-27
---

# Drizzle N+1問題の解決

## 問題
買い物リストを取得する際、各リストのアイテムを
個別にクエリしてしまいN+1問題が発生。

## 原因
リストを取得後、ループ内でアイテムを取得していた。

## 解決策
リストIDを集めて `inArray` で1回のクエリで関連データを取得。

## 例

### Before
\`\`\`typescript
const lists = await db.select().from(shoppingLists)
for (const list of lists) {
  const rows = await db.select().from(listItems).where(eq(listItems.listId, list.id))
}
\`\`\`

### After
\`\`\`typescript
const lists = await db.select().from(shoppingLists)
const rows = await db
  .select()
  .from(listItems)
  .where(inArray(listItems.listId, lists.map((l) => l.id)))
\`\`\`

## 適用条件
- 1対多のリレーションを持つデータを取得する時
- ループ内でクエリを実行している時

## 関連
- https://orm.drizzle.team/docs/operators#inarray
```

## 保存先

```
.claude/skills/learned/
├── drizzle-n-plus-one.md
├── nextjs-server-client-boundary.md
└── auth-session-handling.md
```
