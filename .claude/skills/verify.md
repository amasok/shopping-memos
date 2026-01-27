---
name: verify
description: PR前の総合検証。ビルド、型チェック、リント、テスト、セキュリティを一括チェック。/verify で実行。
tools: ["Bash", "Read", "Grep"]
---

# /verify - 総合検証

PR作成前にコードベース全体の健全性を検証する。

## コマンド

```
/verify         - 全チェックを実行（デフォルト）
/verify quick   - ビルドと型チェックのみ
/verify pre-commit - コミット前チェック
/verify pre-pr  - PR前の完全チェック（セキュリティスキャン含む）
```

## 検証フェーズ

### Phase 1: ビルド
```bash
npm run build
```
失敗した場合は即座に停止。

### Phase 2: 型チェック
```bash
npx tsc --noEmit
```

### Phase 3: リント
```bash
npm run lint
```

### Phase 4: テスト
```bash
npm test -- --coverage
```
カバレッジ80%以上を目標。

### Phase 5: セキュリティスキャン
```bash
# console.log の検出
grep -r "console\\.log" src/ --include="*.ts" --include="*.tsx" | grep -v "// debug"

# 依存関係の脆弱性
npm audit --audit-level=high

# シークレットの検出
grep -rE "(api_key|secret|password)\s*[:=]\s*['\"][^'\"]+['\"]" src/
```

### Phase 6: Git状態確認
```bash
git status
git diff --stat HEAD~1
```

## 出力フォーマット

```
╔════════════════════════════════════════╗
║         検証レポート                    ║
╠════════════════════════════════════════╣
║ ビルド:     ✅ PASS                    ║
║ 型チェック:  ✅ PASS                    ║
║ リント:     ✅ PASS                    ║
║ テスト:     ✅ 42 passed, 0 failed     ║
║ カバレッジ:  ✅ 85.3%                   ║
║ セキュリティ: ⚠️ 2 warnings            ║
║ console.log: ⚠️ 3 found               ║
╠════════════════════════════════════════╣
║ PR準備状況: ⚠️ 要確認                  ║
╚════════════════════════════════════════╝

要対応:
1. [WARN] console.log が3箇所残っています
   - src/lib/api.ts:23
   - src/components/Debug.tsx:5
   - src/components/Debug.tsx:12

2. [WARN] npm audit で2件の警告
   - lodash: 中程度の脆弱性
```

## 判定基準

### ✅ PR可能
- 全チェックがPASS
- Critical/Highの問題なし

### ⚠️ 要確認
- Warningのみ
- console.logが残っている
- カバレッジが80%未満

### ❌ PR不可
- ビルド失敗
- 型エラーあり
- テスト失敗
- Criticalセキュリティ問題

## クイックモード

```bash
# /verify quick の実行内容
npm run build && npx tsc --noEmit
```

ビルドと型チェックのみで高速に確認。開発中に頻繁に実行。

## CI/CD連携

GitHub Actionsで同等のチェックを実行:

```yaml
# .github/workflows/verify.yml
name: Verify
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test -- --coverage
      - run: npm audit --audit-level=high
```
