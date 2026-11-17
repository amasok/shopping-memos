# Gitワークフロー

## コミットメッセージ形式

```
<type>: <description>

[optional body]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### タイプ一覧

| タイプ | 説明 | 例 |
|--------|------|-----|
| `feat` | 新機能 | `feat: 買い物リスト共有機能を追加` |
| `fix` | バグ修正 | `fix: アイテム削除時のエラーを修正` |
| `refactor` | リファクタリング | `refactor: API呼び出しを共通化` |
| `docs` | ドキュメント | `docs: README にセットアップ手順を追加` |
| `test` | テスト | `test: 共有機能のユニットテストを追加` |
| `chore` | 雑務 | `chore: 依存関係を更新` |
| `perf` | パフォーマンス | `perf: リスト取得クエリを最適化` |
| `ci` | CI/CD | `ci: GitHub Actions ワークフローを追加` |

### 良いコミットメッセージ

```
feat: 家族招待機能を追加

- 招待リンクの生成
- メール送信機能
- 招待承認フロー

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### 悪いコミットメッセージ

```
fix: バグ修正
update
WIP
```

## Push前の必須チェック

**リモートにpushする前に、以下のチェックを必ず実行すること。**

```bash
# 1. Lint（必須）
npm run lint

# 2. テスト（必須）
npm run test:run

# 3. ビルド（必須）
npm run build
```

すべてパスしない場合はpushしないこと。CIで失敗するとマージがブロックされる。

## ブランチ戦略

```
main (本番)
  └── develop (開発)
        ├── feature/add-sharing    # 新機能
        ├── fix/item-delete-error  # バグ修正
        └── refactor/api-cleanup   # リファクタリング
```

### ブランチ命名規則

```
feature/<機能名>     # 新機能
fix/<バグ名>         # バグ修正
refactor/<対象>      # リファクタリング
docs/<対象>          # ドキュメント
```

## プルリクエスト

### PR作成前のチェック

```bash
# 全コミットの差分を確認（最新だけでなく全体）
git diff main...HEAD

# ビルド確認
npm run build

# テスト実行
npm test

# リント
npm run lint
```

### PRテンプレート

```markdown
## 概要
[変更の概要を1-2文で]

## 変更内容
- 変更点1
- 変更点2

## テスト計画
- [ ] ユニットテスト
- [ ] 統合テスト
- [ ] 手動テスト

## スクリーンショット（UIの場合）
[該当する場合は添付]
```

### PRのルール

- **最新コミットだけでなく全コミットをレビュー**
- 1つのPRは1つの目的
- PRは小さく保つ（500行以下が理想）
- WIPはドラフトPRとして作成

## 機能実装フロー

```
0. 仕様 (OpenSpec の change。feature-design.md)
   - 振る舞いが変わるなら change（proposal・specs）を作り、ユーザーの承認を得る
   - 承認の前にコードを書かない（自明なバグ修正・依存の更新・振る舞いを変えないリファクタは不要）

1. 計画 (planner エージェント)
   - 実装計画を策定（change があれば design.md・tasks.md に書く）
   - 依存関係を特定
   - フェーズに分割

2. TDD (tdd-guide エージェント)
   - RED: 失敗するテストを書く
   - GREEN: テストを通す
   - REFACTOR: コードを改善
   - カバレッジ80%以上

3. レビュー (code-reviewer エージェント)
   - Critical/High は必須対応
   - Medium は可能な限り対応

4. コミット
   - Conventional Commits 形式
   - 適切な粒度で分割
   - change があれば、tester に渡す前に archive してコミットする（feature-design.md）
```

チームでの受け渡し（tester → reviewer → リーダー）は team-operation.md を参照。

## やってはいけないこと

- ❌ `main` への直接プッシュ
- ❌ `--force` プッシュ（特にmain/develop）
- ❌ 巨大なコミット（1000行以上）
- ❌ 意味のないコミットメッセージ
- ❌ `.env` や認証情報のコミット
- ❌ `--no-verify` でフックをスキップ
