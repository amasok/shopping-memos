import { describe, it, expect, vi, afterEach } from "vitest"
import {
  generateInviteCode,
  inviteCodeExpiresAt,
  isInviteCodeExpired,
  normalizeInviteCode,
  INVITE_CODE_CHARS,
  INVITE_CODE_LENGTH,
  INVITE_CODE_EXPIRY_DAYS,
  INVITE_CODE_MAX_ATTEMPTS,
  INVITE_CODE_ATTEMPT_WINDOW_MS,
} from "../domain/entities/InviteCode"

afterEach(() => {
  vi.restoreAllMocks()
})

/** 先頭から順に bytes を返す getRandomValues（足りなければ 0 を返す） */
function fixedBytes(...sequence: number[][]) {
  let call = 0
  return (array: Uint8Array) => {
    const bytes = sequence[call++] ?? []
    array.set(bytes.slice(0, array.length))
    return array
  }
}

describe("定数 (#67)", () => {
  it("招待コードは8文字、有効期限は7日、試行は1時間に10回まで", () => {
    expect(INVITE_CODE_LENGTH).toBe(8)
    expect(INVITE_CODE_EXPIRY_DAYS).toBe(7)
    expect(INVITE_CODE_MAX_ATTEMPTS).toBe(10)
    expect(INVITE_CODE_ATTEMPT_WINDOW_MS).toBe(60 * 60 * 1000)
  })

  it("文字集合は31文字で、紛らわしい文字(0 O I L 1)と重複を含まない", () => {
    expect(INVITE_CODE_CHARS).toHaveLength(31)
    expect(new Set(INVITE_CODE_CHARS).size).toBe(31)
    for (const c of ["0", "O", "I", "L", "1"]) {
      expect(INVITE_CODE_CHARS).not.toContain(c)
    }
  })
})

describe("generateInviteCode", () => {
  it("8文字で、文字集合に含まれる文字だけを使う", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode()
      expect(code).toHaveLength(8)
      for (const c of code) expect(INVITE_CODE_CHARS).toContain(c)
    }
  })

  it("getRandomValues の値から決定的に生成する（バイト値 % 31 で文字を選ぶ）", () => {
    const code = generateInviteCode(fixedBytes([0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0]))

    expect(code).toBe(INVITE_CODE_CHARS.slice(0, 8))
  })

  it("31 で割った余りで文字を選ぶ（31→先頭、32→2番目）", () => {
    const code = generateInviteCode(fixedBytes([31, 32, 62, 63, 30, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0]))

    expect(code).toBe(
      [0, 1, 0, 1, 30, 0, 1, 2].map((i) => INVITE_CODE_CHARS[i]).join("")
    )
  })

  it("248 以上のバイトは偏りを避けるため捨てる", () => {
    // 248, 255 は捨てられ、残りの有効なバイトだけが使われる
    const code = generateInviteCode(fixedBytes([248, 255, 0, 250, 1, 251, 2, 252, 3, 253, 4, 254, 5, 249, 6, 7]))

    expect(code).toBe(INVITE_CODE_CHARS.slice(0, 8))
  })

  it("247 は使い、248 は捨てる（境界）", () => {
    const code = generateInviteCode(fixedBytes([247, 248, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))

    expect(code[0]).toBe(INVITE_CODE_CHARS[247 % 31])
    expect(code).toHaveLength(8)
  })

  it("捨てたバイトで足りなくなったら、getRandomValues を呼び直して埋める", () => {
    const getRandomValues = vi.fn(fixedBytes(new Array(16).fill(255), [0, 1, 2, 3, 4, 5, 6, 7]))

    const code = generateInviteCode(getRandomValues)

    expect(getRandomValues).toHaveBeenCalledTimes(2)
    expect(code).toBe(INVITE_CODE_CHARS.slice(0, 8))
  })

  it("Math.random を使わない", () => {
    const spy = vi.spyOn(Math, "random")

    generateInviteCode()

    expect(spy).not.toHaveBeenCalled()
  })

  it("既定では crypto.getRandomValues を使う", () => {
    const spy = vi.spyOn(crypto, "getRandomValues")

    generateInviteCode()

    expect(spy).toHaveBeenCalled()
  })

  it("毎回異なるコードを生成する", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateInviteCode()))

    expect(codes.size).toBe(100)
  })

  it("文字の出現に大きな偏りがない（31文字すべてが現れる）", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) for (const c of generateInviteCode()) seen.add(c)

    expect(seen.size).toBe(31)
  })
})

describe("inviteCodeExpiresAt / isInviteCodeExpired", () => {
  const issued = new Date("2026-01-01T00:00:00.000Z")

  it("発行から7日後を有効期限にする", () => {
    expect(inviteCodeExpiresAt(issued).toISOString()).toBe("2026-01-08T00:00:00.000Z")
  })

  it("有効期限の前なら期限切れではない", () => {
    const expiresAt = inviteCodeExpiresAt(issued)

    expect(isInviteCodeExpired(expiresAt, new Date("2026-01-07T23:59:59.999Z"))).toBe(false)
  })

  it("有効期限ちょうどから期限切れとして扱う", () => {
    const expiresAt = inviteCodeExpiresAt(issued)

    expect(isInviteCodeExpired(expiresAt, expiresAt)).toBe(true)
    expect(isInviteCodeExpired(expiresAt, new Date("2026-01-08T00:00:00.001Z"))).toBe(true)
  })

  it("now を省略すると現在時刻で判定する", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"))
    try {
      expect(isInviteCodeExpired(new Date("2026-01-01T00:00:00Z"))).toBe(true)
      expect(isInviteCodeExpired(new Date("2026-03-01T00:00:00Z"))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("normalizeInviteCode", () => {
  it("前後の空白を除き、大文字にする", () => {
    expect(normalizeInviteCode("  abc234xy \n")).toBe("ABC234XY")
  })

  it("途中の空白は残す（別のコードとして扱われ、一致しない）", () => {
    expect(normalizeInviteCode("ab cd")).toBe("AB CD")
  })
})
