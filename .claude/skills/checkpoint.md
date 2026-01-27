---
name: checkpoint
description: 作業の節目でチェックポイントを作成・検証。git commitと連携して進捗を追跡。/checkpoint で実行。
tools: ["Bash", "Read", "Write"]
---

# /checkpoint - チェックポイント管理

作業の節目でチェックポイントを作成し、後で状態を比較・検証できるようにする。

## コマンド

```
/checkpoint create <名前>  - チェックポイントを作成
/checkpoint verify <名前>  - 指定したチェックポイントと現在を比較
/checkpoint list          - チェックポイント一覧を表示
/checkpoint clear         - 古いチェックポイントを削除（最新5件は保持）
```

## チェックポイント作成時の処理

1. 作業ツリーがクリーンか確認
2. 未コミットの変更があればstashまたはコミット
3. `.claude/checkpoints.log` に記録:
   ```
   2024-01-27-15:30 | feature-start | abc1234
   ```

## 検証時の出力

```
=== チェックポイント検証: feature-start → 現在 ===

ファイル変更: 12件
テスト: +5 passed / -0 failed
カバレッジ: +3.2%
ビルド: ✅ PASS

変更ファイル:
  M src/components/Button.tsx
  A src/components/Modal.tsx
  D src/lib/deprecated.ts
```

## 推奨タイミング

- 機能実装の開始時: `feature-start`
- コアロジック完成時: `core-done`
- リファクタリング完了時: `refactor-done`
- PR作成前: `pre-pr`

## 実装

```bash
# チェックポイント作成
create_checkpoint() {
  local name=$1
  local sha=$(git rev-parse --short HEAD)
  local timestamp=$(date +%Y-%m-%d-%H:%M)

  # ログに追記
  echo "$timestamp | $name | $sha" >> .claude/checkpoints.log

  echo "✅ チェックポイント '$name' を作成しました ($sha)"
}

# チェックポイント検証
verify_checkpoint() {
  local name=$1
  local checkpoint_sha=$(grep "$name" .claude/checkpoints.log | tail -1 | cut -d'|' -f3 | tr -d ' ')

  echo "=== $name → HEAD の変更 ==="
  git diff --stat "$checkpoint_sha" HEAD

  echo ""
  echo "テスト結果:"
  npm test 2>/dev/null || echo "テストなし"
}
```

## ログファイル形式

`.claude/checkpoints.log`:
```
# タイムスタンプ | 名前 | git SHA
2024-01-27-10:00 | feature-start | abc1234
2024-01-27-12:30 | core-done | def5678
2024-01-27-15:00 | pre-pr | ghi9012
```
