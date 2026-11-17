import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Badge } from "../Badge"
import { Button } from "../Button"
import { Checkbox } from "../Checkbox"
import { EmptyState } from "../EmptyState"
import { Input } from "../Input"
import { LoadingSpinner, LoadingPage } from "../LoadingSpinner"

describe("Badge", () => {
  it("variant ごとの色クラスを付ける", () => {
    render(<Badge variant="success">完了</Badge>)
    expect(screen.getByText("完了").className).toContain("bg-green-100")
  })

  it("variant を省略するとデフォルトの色になる", () => {
    render(<Badge>既定</Badge>)
    expect(screen.getByText("既定").className).toContain("bg-gray-200")
  })
})

describe("Button", () => {
  it("primary はテーマ色を背景にし、ホバーで切り替わり、外れると戻る", () => {
    render(<Button>保存</Button>)
    const btn = screen.getByRole("button", { name: "保存" })
    expect(btn.style.backgroundColor).toBe("var(--theme-primary)")
    fireEvent.mouseEnter(btn)
    expect(btn.style.backgroundColor).toBe("var(--theme-primary-hover)")
    fireEvent.mouseLeave(btn)
    expect(btn.style.backgroundColor).toBe("var(--theme-primary)")
  })

  it("disabled の primary はホバーしても背景が変わらない", () => {
    render(<Button disabled>保存</Button>)
    const btn = screen.getByRole("button")
    fireEvent.mouseEnter(btn)
    expect(btn.style.backgroundColor).toBe("var(--theme-primary)")
  })

  it("primary 以外は背景をテーマ色にせず、variant と size のクラスを付ける", () => {
    render(<Button variant="danger" size="lg">削除</Button>)
    const btn = screen.getByRole("button")
    expect(btn.style.backgroundColor).toBe("")
    expect(btn.className).toContain("bg-red-500")
    expect(btn.className).toContain("min-h-[56px]")
    fireEvent.mouseEnter(btn)
    expect(btn.style.backgroundColor).toBe("")
  })

  it("クリックで onClick を呼ぶ", () => {
    const onClick = vi.fn()
    render(<Button variant="ghost" size="sm" onClick={onClick}>x</Button>)
    fireEvent.click(screen.getByRole("button"))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe("Checkbox", () => {
  it("checked のときチェックアイコンとテーマ色を出し、変更を通知する", () => {
    const onChange = vi.fn()
    const { container } = render(<Checkbox name="a" label="牛乳" checked onChange={onChange} />)
    expect(container.querySelector("svg")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox"))
    expect(onChange).toHaveBeenCalled()
  })

  it("未チェックではアイコンを出さない", () => {
    const { container } = render(<Checkbox name="a" label="牛乳" checked={false} onChange={() => {}} />)
    expect(container.querySelector("svg")).not.toBeInTheDocument()
  })

  it("strikethrough 指定でチェック済みのラベルに取り消し線を付ける", () => {
    render(<Checkbox name="a" label="牛乳" checked strikethrough onChange={() => {}} />)
    expect(screen.getByText("牛乳").className).toContain("line-through")
  })

  it("disabled のとき操作不可のスタイルになる", () => {
    const { container } = render(<Checkbox name="a" disabled checked={false} onChange={() => {}} />)
    expect(container.querySelector("label")?.className).toContain("cursor-not-allowed")
  })
})

describe("EmptyState", () => {
  it("タイトル・説明・アイコン・アクションを表示する", () => {
    render(
      <EmptyState icon={<span>ICON</span>} title="空です" description="追加してください" action={<button>追加</button>} />
    )
    expect(screen.getByText("空です")).toBeInTheDocument()
    expect(screen.getByText("追加してください")).toBeInTheDocument()
    expect(screen.getByText("ICON")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "追加" })).toBeInTheDocument()
  })

  it("タイトルだけでも表示できる", () => {
    render(<EmptyState title="空です" />)
    expect(screen.getByTestId("empty-state")).toBeInTheDocument()
  })
})

describe("Input", () => {
  it("ラベルと入力を結び付ける", () => {
    render(<Input name="title" label="名前" />)
    expect(screen.getByLabelText("名前")).toBeInTheDocument()
  })

  it("error があると aria-invalid とエラー文言を出す", () => {
    render(<Input name="title" label="名前" error="必須です" />)
    expect(screen.getByLabelText("名前")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("必須です")).toBeInTheDocument()
  })
})

describe("LoadingSpinner", () => {
  it("size に応じたクラスを付ける", () => {
    const { container } = render(<LoadingSpinner size="lg" />)
    expect((container.firstChild as HTMLElement).className).toContain("h-12")
  })

  it("LoadingPage はスピナーを含む", () => {
    const { container } = render(<LoadingPage />)
    expect(container.querySelector(".animate-spin")).toBeInTheDocument()
  })
})
