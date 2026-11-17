# Design: ゲストとログイン中のカタログの見え方をそろえる

## Context

動機は proposal.md の Why。O7（`62-o7-catalog-local-first`）で、端末の DB の読み取りは `src/hooks/data/catalogQueries.ts` の `queryItems` / `queryTags` にまとまり、並びだけが `order: "server" | "guest"` で分かれている。`app/items/new/page.tsx` は `lib/db` の `createItem` / `createTag` でゲスト DB に直接書き、`useLiveQuery(db.tags.orderBy("createdAt"))` で全部のタグを読んでいる。

## Goals / Non-Goals

**Goals:** ゲストの並びをサーバーと同じにし、hooks を通らない画面の書き込みをなくす（確認事項の提案どおりのとき）

**Non-Goals:** サーバーの並びの変更、`ItemForm` の変更

## Decisions

- D1. `catalogQueries.ts` の `order` の引数をなくし、常にサーバーの並び（商品は `createdAt` の昇順、タグは名前の順）にする。タグの名前の比較は O7 と同じ `localeCompare(…, "ja")`
- D2. `app/items/new/page.tsx` を消し、`src/lib/sw/config.ts` のプリキャッシュの一覧から `/items/new` を外す。消した後に `/items/new` を開くと Next.js の 404 になる（入り口がないので、ブックマークしている人だけ）。`lib/db/items.ts` の `createItem` と `lib/db/tags.ts` の `createTag` は、ほかから使われていなければ消す
- 確認事項 2 が案 b（hooks 経由）なら、D2 の代わりに `useTags` と `useItemMutations` / `useTagMutations` を使う形に書き換え、specs に「`/items/new` で作った商品は選んでいるグループに入る」の Requirement を足す

## Risks / Trade-offs

- [ゲストの商品の並びが逆になり、今の利用者が戸惑う] → ゲストは主な使い方ではない（確認事項 1 で確かめる）
- [E2E がゲストの並びに頼っている] → `e2e/item-management.spec.ts`・`tag-management.spec.ts` を確かめ、並びに頼る期待値を直す

## Migration Plan

DB の変更はない。通常の develop へのマージで出す。
