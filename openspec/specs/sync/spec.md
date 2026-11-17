# sync Specification

## Purpose
ログイン中の端末のユーザー DB と、サーバーの同期（push・pull）を定める。この spec はまず所属グループのキャッシュを持ち、push・pull の本体は、触れる change で書き起こす。

## Requirements

### Requirement: 所属グループのキャッシュ

フラグが true の同期（push と pull）で pull が終わるたびに、システムは、`identity.getGroups` の結果でユーザー DB の `groups` を上書きしなければならない（MUST）。結果にないグループは消す。グループの一覧の取得に失敗しても、同期そのものは失敗にせず、前のキャッシュを残す。

#### Scenario: pull の後に所属グループでキャッシュを上書きする
- **WHEN** ユーザー DB の `groups` にグループ A と B があり、pull の後の `identity.getGroups` が A と C を返す
- **THEN** ユーザー DB の `groups` は A と C になり、名前とメンバー数がサーバーの値になる

#### Scenario: グループの一覧の取得に失敗しても同期は終わる
- **WHEN** pull の後の `identity.getGroups` がネットワークのエラーで失敗する
- **THEN** 同期は終わったものとして扱い（最終同期の時刻を記録する）、`groups` は前のまま

#### Scenario: push だけの同期（drain）ではグループを取りにいかない
- **WHEN** フラグが false で、未送信の操作を送り切る同期（drain）を行う
- **THEN** `identity.getGroups` は呼ばない

### Requirement: ローカルファーストのグループの一覧

ローカルファーストで、システムは、グループの一覧をユーザー DB の `groups` のキャッシュから出さなければならない（MUST）。グループの作成・参加・更新・脱退（tRPC。オンラインだけ）の後は、すぐに同期してキャッシュを新しくする。

#### Scenario: グループの一覧はキャッシュから出す
- **WHEN** ローカルファーストで、ユーザー DB の `groups` にグループ A がある
- **THEN** グループの一覧に A が、キャッシュのメンバー数とともに出る（tRPC の `identity.getGroups` は一覧のためには呼ばない）

#### Scenario: グループを作った後に同期して一覧に出す
- **WHEN** ローカルファーストで、グループを作る
- **THEN** 作成の成功の後に同期が走り、同期の後の一覧に新しいグループが出る
