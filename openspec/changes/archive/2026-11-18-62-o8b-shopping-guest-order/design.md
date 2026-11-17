# Design: ゲストのリストとリストの商品の並び

## Context

`src/hooks/data/shoppingQueries.ts`（O8）の `queryLists` / `queryListItems` は `order: "server" | "guest"` を取り、guest では並べ替えない。

## Goals / Non-Goals

**Goals:** ゲストの並びをサーバーと同じ作成日時の古い順にする（確認事項の提案どおりのとき）

**Non-Goals:** 履歴の並び、サーバーの並び

## Decisions

- `order` の引数をなくし、常に `createdAt` の昇順にする。`62-o7b-catalog-guest-alignment` も同じ判断なら、`catalogQueries.ts` と一緒に `order` をなくす

## Risks / Trade-offs

- [E2E がゲストの並びに頼っている] → `e2e/shopping.spec.ts`・`list-creation.spec.ts` を確かめる。今の並びは ID の順で決まっていないので、頼っていないはず

## Migration Plan

DB の変更はない。通常の develop へのマージで出す。
