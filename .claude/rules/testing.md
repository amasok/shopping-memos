# テスト規約

## 必須ルール

**プロダクトコードを追加・変更したら、対応するテストも書く。テストなしのコードはマージしない。**

| 変更内容 | 必要なテスト |
|---------|-------------|
| 新規API/関数 | ユニットテスト必須 |
| バリデーション | 正常系・異常系テスト |
| ビジネスロジック | ユニットテスト必須 |
| UIコンポーネント | 振る舞いテスト推奨 |
| バグ修正 | 再発防止テスト必須 |

- カバレッジは 80% 以上を維持する（`npm run test:coverage`）
- テストが失敗したら**実装を直す**。テストを直すのはテスト自体にバグがある場合だけ
- テスト名は期待する動作を書く（例: `空の名前でバリデーションエラーを返す`）。`test1` や `should work` は不可

## TDD

1. RED: 失敗するテストを書く
2. GREEN: テストを通す最小限の実装を書く
3. REFACTOR: テストを通したまま改善する
4. VERIFY: カバレッジ 80% 以上を確認する

## 配置

- ユニット / 統合: 対象の隣の `__tests__/`（例: `src/shared/schemas/__tests__/item.test.ts`）
- E2E: `e2e/*.spec.ts`（ログインが必要なものは `e2e/auth/`）

## E2E の実行（#142）

- push の前に `npm run test:e2e:local` で全部（chromium・chromium-auth・Mobile Chrome・offline）を流す。Docker の postgres に worktree ごとの DB を作り直し、本番ビルドを空いているポートで動かす。`.env` は使わない
- 一部だけ流すときは `npm run test:e2e:local -- e2e/ogp-preview.spec.ts`（引数は playwright test に渡す。offline は流さない）
- tester は結果（件数）を報告に書き、リーダーは PR の本文に書く。CI の E2E は main へのリリースのときだけ動く最後の確認

コード例・モックの書き方は `testing-patterns` スキル、TDD の進め方は `tdd-guide` エージェントを参照。
