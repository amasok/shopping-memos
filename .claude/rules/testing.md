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

- push の前に `npm run test:e2e:local` で全部（chromium・chromium-auth・Mobile Chrome・offline）を流す。Docker の postgres に実行ごとの DB（ブランチ名・worktree のハッシュ・実行 ID）を作って終わったら消し、本番ビルドを空いているポートで動かす。`.env` は使わない。ゲストモードは並列、ログイン済み（chromium-auth）は 1 ワーカーで流す。同じ worktree での同時実行はロックで止まる（.next などを共有するため。別の worktree なら同時に流せる）
- 一部だけ流すときは `npm run test:e2e:local -- e2e/ogp-preview.spec.ts`（引数は playwright test に渡す。offline は流さない）。ログイン済み（`e2e/auth`）を流すときは `--project=chromium-auth --workers=1` を付ける（同じユーザーを共有するので、並列だと干渉する）
- tester は結果（件数）を報告に書き、リーダーは PR の本文に書く。CI の E2E は main へのリリースのときだけ動く最後の確認

## 実 DB のテスト（#151）

- `npm run test:db` で `src/**/*.db.test.ts` を全部流す。docker の postgres に一時 DB を作り、migrate して、終わったら消す。CI では流さない（通常の `test:run` ではスキップされる）

コード例・モックの書き方は `testing-patterns` スキル、TDD の進め方は `tdd-guide` エージェントを参照。
