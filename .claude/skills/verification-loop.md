---
name: verification-loop
description: 継続的な検証ループ。15分ごとまたは大きな変更後に自動実行。品質を継続的に担保。
tools: ["Bash", "Read", "Grep"]
---

# 検証ループ

開発中の継続的な品質チェック。15分ごと、または大きな変更後に実行。

## 実行タイミング

- ⏱️ 15分ごとの定期実行
- 📝 関数/コンポーネント完成後
- 🔄 大きな変更後
- 📤 コミット前

## 6フェーズ検証

### Phase 1: ビルド検証

```bash
npm run build
```

**判定:**
- ✅ PASS: ビルド成功
- ❌ FAIL: 即座に修正が必要

### Phase 2: 型チェック

```bash
npx tsc --noEmit
```

**判定:**
- ✅ PASS: 型エラーなし
- ❌ FAIL: 型エラーを修正

### Phase 3: リントチェック

```bash
npm run lint
```

**判定:**
- ✅ PASS: エラーなし
- ⚠️ WARN: 警告のみ（許容）
- ❌ FAIL: エラーあり

### Phase 4: テスト実行

```bash
npm test -- --coverage --passWithNoTests
```

**判定:**
- ✅ PASS: 全テスト成功、カバレッジ80%以上
- ⚠️ WARN: カバレッジ80%未満
- ❌ FAIL: テスト失敗

### Phase 5: セキュリティスキャン

```bash
# console.log の検出
grep -r "console\\.log" src/ --include="*.ts" --include="*.tsx" | wc -l

# シークレットの検出
grep -rE "(password|secret|api_key)\s*[:=]\s*['\"][^'\"]+['\"]" src/ --include="*.ts" --include="*.tsx"

# 依存関係の脆弱性
npm audit --audit-level=high
```

**判定:**
- ✅ PASS: 問題なし
- ⚠️ WARN: console.log残存
- ❌ FAIL: シークレット検出、高脆弱性

### Phase 6: 差分レビュー

```bash
git diff --stat
git diff HEAD~1 --name-only
```

**確認項目:**
- 意図しない変更がないか
- エラーハンドリングの漏れ
- エッジケースの考慮

## 出力フォーマット

```
╔════════════════════════════════════════════════════════╗
║               検証ループレポート                        ║
║               2024-01-27 15:30                          ║
╠════════════════════════════════════════════════════════╣
║ Phase 1: ビルド        ✅ PASS                         ║
║ Phase 2: 型チェック     ✅ PASS                         ║
║ Phase 3: リント        ✅ PASS                         ║
║ Phase 4: テスト        ✅ 24 passed (85.3%)            ║
║ Phase 5: セキュリティ   ⚠️ console.log: 2件            ║
║ Phase 6: 差分          ✅ 5 files changed              ║
╠════════════════════════════════════════════════════════╣
║ 総合判定: ⚠️ 要確認                                    ║
╚════════════════════════════════════════════════════════╝

要対応:
1. [WARN] console.log が2件残っています
   - src/lib/api.ts:45
   - src/components/Debug.tsx:12

次のアクション:
- console.log を削除またはloggerに置換
- その後、再度 /verify を実行
```

## 継続的チェックポイント

### 関数完成時

```
関数 `formatPrice` を実装完了

□ 検証ループ実行
  ✅ ビルド: PASS
  ✅ 型: PASS
  ✅ テスト: PASS (カバレッジ +5%)

→ チェックポイント作成: /checkpoint create format-price-done
```

### コンポーネント完成時

```
コンポーネント `ItemCard` を実装完了

□ 検証ループ実行
  ✅ ビルド: PASS
  ✅ 型: PASS
  ⚠️ テスト: カバレッジ 72%

→ テスト追加が必要
→ /test-coverage improve src/components/ItemCard.tsx
```

## CI/CD連携

```yaml
# .github/workflows/verify-loop.yml
name: Verification Loop

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install
        run: npm ci

      - name: Build
        run: npm run build

      - name: Type Check
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test -- --coverage

      - name: Security Audit
        run: npm audit --audit-level=high

      - name: Check console.log
        run: |
          count=$(grep -r "console\.log" src/ --include="*.ts" --include="*.tsx" | wc -l)
          if [ "$count" -gt 0 ]; then
            echo "::warning::Found $count console.log statements"
          fi
```

## 検証頻度ガイド

| 状況 | 頻度 |
|------|------|
| 通常開発 | 15分ごと |
| 複雑な機能実装 | 変更ごと |
| リファクタリング | 各ステップ後 |
| バグ修正 | 修正後即座に |
| コミット前 | 必須 |
| PR作成前 | 必須（full） |

---

**原則: 小さく頻繁に検証。問題は早期発見・早期修正。**
