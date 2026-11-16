---
name: orchestrate
description: 複数のエージェントを順番に実行し、複雑なタスクを完了。/orchestrate で実行。
---

# /orchestrate - エージェント連携

複数のエージェントを順番に実行し、複雑な開発タスクを効率的に完了する。

## コマンド

```
/orchestrate feature <説明>   - 新機能の実装
/orchestrate bugfix <説明>    - バグ修正
/orchestrate refactor <説明>  - リファクタリング
/orchestrate security <説明>  - セキュリティレビュー
/orchestrate custom <エージェント...> <説明>  - カスタムワークフロー
```

## 定義済みワークフロー

### 🚀 feature (新機能)

```
planner → tdd-guide → code-reviewer → security-reviewer
```

1. **planner**: 実装計画を策定
2. **tdd-guide**: テストを先に作成
3. **code-reviewer**: コードレビュー
4. **security-reviewer**: セキュリティチェック

### 🐛 bugfix (バグ修正)

```
explorer → tdd-guide → code-reviewer
```

1. **explorer**: 問題箇所を特定
2. **tdd-guide**: 再現テストを作成 → 修正
3. **code-reviewer**: 修正をレビュー

### 🔧 refactor (リファクタリング)

```
architect → code-reviewer → tdd-guide
```

1. **architect**: リファクタリング方針を設計
2. **code-reviewer**: 変更をレビュー
3. **tdd-guide**: テストでリグレッションがないことを確認

### 🔒 security (セキュリティ)

```
security-reviewer → code-reviewer → architect
```

1. **security-reviewer**: 脆弱性を検出
2. **code-reviewer**: 修正をレビュー
3. **architect**: アーキテクチャレベルの改善を提案

## ハンドオフドキュメント

エージェント間で引き継ぐ情報:

```markdown
## ハンドオフ: planner → tdd-guide

### コンテキスト
買い物リストの共有機能を実装中

### 完了した作業
- 実装計画を策定
- 影響ファイルを特定
- API設計を完了

### 変更ファイル
- src/app/api/share/route.ts (新規)
- src/components/ShareModal.tsx (新規)
- src/infrastructure/db/drizzle/schema.ts (修正)

### 未解決事項
- エラーハンドリングの詳細
- 招待メールの文面

### 次のステップ
1. ShareModal のユニットテストを作成
2. /api/share のAPIテストを作成
3. 共有フローのE2Eテストを作成
```

## 出力フォーマット

```
╔════════════════════════════════════════════════════════╗
║              オーケストレーションレポート               ║
╠════════════════════════════════════════════════════════╣
║ ワークフロー: feature                                  ║
║ タスク: 買い物リスト共有機能                           ║
╠════════════════════════════════════════════════════════╣

📋 planner (完了)
   ✅ 実装計画を策定
   ✅ 4フェーズに分解
   ⏱️ 所要時間: 5分

🧪 tdd-guide (完了)
   ✅ 12件のテストを作成
   ✅ カバレッジ: 85%
   ⏱️ 所要時間: 15分

👀 code-reviewer (完了)
   ✅ レビュー完了
   ⚠️ 2件の警告
   ⏱️ 所要時間: 3分

🔒 security-reviewer (完了)
   ✅ 脆弱性なし
   ⏱️ 所要時間: 2分

╠════════════════════════════════════════════════════════╣
║ 変更ファイル: 8件                                      ║
║ テスト: 12 passed, 0 failed                           ║
║ カバレッジ: 85%                                        ║
║ セキュリティ: ✅ OK                                    ║
╠════════════════════════════════════════════════════════╣
║ 判定: ✅ SHIP (マージ可能)                             ║
╚════════════════════════════════════════════════════════╝
```

## 判定基準

### ✅ SHIP (マージ可能)
- 全エージェントが正常完了
- Criticalな問題なし
- テストがすべてパス

### ⚠️ NEEDS WORK (要修正)
- 警告が残っている
- カバレッジが目標未達
- 軽微な問題あり

### ❌ BLOCKED (ブロック)
- 重大な問題を検出
- テスト失敗
- セキュリティ脆弱性

## カスタムワークフロー

```
/orchestrate custom "database-reviewer → architect" "スキーマ変更のレビュー"
```

独自のエージェント順序でワークフローを実行。

## 並列実行

独立したエージェントは並列に実行可能:

```
/orchestrate parallel "code-reviewer, security-reviewer" "最終チェック"
```
