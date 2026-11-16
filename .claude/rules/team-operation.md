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
- チームメイトどうしは名前を指定した SendMessage でやりとりする

## push・PR・マージ
- チームメイトは push や PR 作成をしない。ローカルブランチにコミットしたら、tester → reviewer（ローカル差分でレビュー）の順に受け渡す
- LGTM の後、リーダーが push・PR 作成・develop へのマージを行う
- main（本番）へのリリースはユーザーの確認が必要

## 報告
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

- 月の上限を超えないよう、CI は PR で確認し、develop への push では migrate-develop だけを動かす（Test・Build・E2E は動かさない）。Mobile Chrome の E2E は main への PR と main への push だけ
- develop へのマージは関連 PR をまとめる（Vercel と同じ）。PR への push は最小限にする（push のたびに Test・Build・E2E が走る）。直しはまとめてから push する
- docs/・.claude/・*.md だけの変更では CI が動かない（AGENTS.md と CLAUDE.md は #122 の検査のため動く）。docs だけの PR はチェックが付かないので、`gh pr checks` の結果でマージを判定する場合は「チェックなし」を失敗と取り違えない
- SW のライフサイクル E2E（sw-e2e.yml）は SW 関連のファイルの変更と手動実行だけ。依存（Serwist など）を更新したら手動で実行する
