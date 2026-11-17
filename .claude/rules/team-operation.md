# チーム運用

## 体制
- チームメイト名は `<リポジトリのフォルダ名>-<役割>`（例: `shopping-memos-docs`）
- レビュー担当・テスト担当は、実装・設計の担当とは別のチームメイトにする。自分の変更を自分でレビューして完了にしない
- 人手が欲しいときはリーダーに SendMessage で作成を依頼する（自分ではチームメイトを作れない）

## 作業
- 並行して書き換えるときは必ず git worktree を使う。メインの作業フォルダは書き換えない
  `git worktree add ../<repo>-wt-<役割> -b <branch> develop`
- ちょっとした調査は名前なしのサブエージェントに任せる（Explore や quick-lookup / haiku）。返してほしい結論の形を指定する
- 同じブランチは 2 つの worktree で同時に checkout できないので、実装者と tester は同じ worktree を順番に使う
- チームメイトどうしは名前を指定した SendMessage で直接やりとりする。指摘・修正・再確認の往復はチームメイトどうしで済ませ、リーダーを経由しない
- レビュー担当も SendMessage を使える種類のエージェントで作る（code-reviewer・database-reviewer などの読み取り専用の種類は SendMessage が使えず、リーダーの中継が要るため。general-purpose などで作り、指示で「ファイルを書き換えない」と縛る）

## push・PR・マージ
- チームメイトは push や PR 作成をしない。ローカルブランチにコミットしたら、tester → reviewer（ローカル差分でレビュー）の順に受け渡す
- LGTM の後、リーダーが push・PR 作成・develop へのマージを行う
- main（本番）へのリリースはユーザーの確認が必要

## E2E はローカルで全部流す（#142）
- tester は、push の前に自分の worktree で `npm run test:e2e:local` を全部流し、報告に結果（プロジェクトごとの件数、失敗・スキップ）を書く。CI と同じ chromium・chromium-auth・Mobile Chrome・offline が、Docker の postgres の実行ごとの DB と、空いているポートで動く。ほかの人が使っている worktree では流さない（同じ worktree での同時実行はロックで止まる）
- リーダーは、PR の本文にその結果を書く。develop への PR では CI の E2E は動かない
- CI の E2E は、main へのリリース（main への PR と main への push）のときの最後の確認
- `npx playwright test` を直接流すときは、`E2E_PORT` を指定する。既定の 3000 で別の worktree の dev サーバーが動いていると、そのサーバーのコードに当たる

## 報告
- リーダーに報告するのは、(1) 作業が終わったとき（テストが全部通り、レビューが LGTM で、push・マージできる状態）と、(2) リーダーかユーザーの判断が必要なときだけ。途中経過や「待機します」の連絡はしない（トークン節約。2026-11-17 ユーザーの指示）
- 実装担当は、tester の結果と reviewer の LGTM がそろってから、まとめてリーダーに報告する
- リーダーも、判断が要らない途中の連絡には応答しない
- 話がループするとき（同じ指摘の往復、やる・やらないで揉める、直しても同じ失敗が続くなど）は、続けずにすぐリーダーを呼ぶ。リーダーで決められなければユーザーに聞く

リーダーへの報告は次の3点を短く。
1. 結論（PR URL など）
2. 変更したファイル
3. 残った課題

## トークン節約
- 大きいファイルは必要な範囲だけ読む（offset/limit、grep）
- コード全文を貼らない。パスと行番号で示す
- 報告は数行にする
- 同じ調査を繰り返さない。結果は相手に渡して共有する

## Vercel のデプロイ上限対策

- Vercel は main と develop だけデプロイする（`vercel.json` の `git.deploymentEnabled`）。PR ブランチのプレビューは作らない。ビルドを省略してもデプロイ数には数えられるため、デプロイ数を減らすにはマージ回数を減らす
- develop へのマージは関連 PR をまとめて行う。空コミットでの再デプロイはしない

## GitHub Actions の使用量

- 月の上限を超えないよう、CI は PR で確認し、develop への push では migrate-develop だけを動かす（Test・Build・E2E は動かさない）。E2E は main への PR と main への push だけ（#142）
- develop へのマージは関連 PR をまとめる（Vercel と同じ）。PR への push は最小限にする（push のたびに Test・Build・E2E が走る）。直しはまとめてから push する
- リポジトリは public（2026-11-17）。標準のランナーは無料だが、無駄に回さない方針は続ける（E2E はローカルが基本）
- ブランチ保護: develop は Test・Build、main は Test・Build・E2E Tests が通らないとマージできない（PR 必須、force push・削除は禁止）。必須チェックが必ず付くよう、CI は docs だけの変更でも動く。保護を迂回する `--admin` でのマージはしない
- fork からの PR のワークフローは、外部の人の分はすべて承認制
- 本番の migrate が失敗したら、Actions の画面か `gh run rerun <run id> --failed` で再実行する。やり直しを次の push に任せない
- SW のライフサイクル E2E（sw-e2e.yml）は SW 関連のファイルの変更と手動実行だけ（package.json は devDependencies を足しただけでも動いてしまうため対象にしない。#143）
- main へのリリースの PR では、`gh workflow run sw-e2e.yml --ref <branch>` で SW の E2E を手動で 1 回動かす（Dependabot で Next や Serwist を上げたものが含まれるとき）
