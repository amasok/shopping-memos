import { z } from "zod"

/**
 * Zod の JIT（`new Function` で検証関数を生成する高速化）を止める（#71）
 *
 * Zod v4 は z.object を作るときに `new Function("")` で eval が使えるかを試す。
 * スキーマはクライアント（DataMergeContext など）でも読み込まれるため、CSP の script-src に
 * 'unsafe-eval' がないと違反になる（Report-Only では報告、強制にすると拒否）。
 * スキーマを作る前に設定する必要があるので、z.object を作る各スキーマの先頭で import する
 */
z.config({ jitless: true })
