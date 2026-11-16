// zod を直接 import してよいのはこのファイルだけ（eslint.config.mjs の no-restricted-imports）
// eslint-disable-next-line no-restricted-imports
import { z } from "zod"

/**
 * アプリで使う zod（#71）
 *
 * Zod v4 は z.object を作るときに `new Function("")` で eval が使えるかを試し、
 * 使えれば検証関数を生成して速くする（JIT）。スキーマはクライアントでも読み込まれるため、
 * CSP の script-src に 'unsafe-eval' がないと違反になる（Report-Only では報告、強制にすると拒否）。
 * スキーマを作る前に JIT を止める必要があるので、zod はすべてこのファイル経由で使う
 */
z.config({ jitless: true })

export { z }
