import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { OGPPreview, isDisplayableImageUrl } from "../OGPPreview"

afterEach(() => vi.unstubAllGlobals())

function renderWithImage(image: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ url: "https://example.com", title: "例", image }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <OGPPreview url="https://example.com" />
    </QueryClientProvider>
  )
}

describe("OGP 画像は https だけを表示する (#73-4)", () => {
  it.each([
    ["https://cdn.example/a.png", true],
    ["http://cdn.example/a.png", false],
    ["javascript:alert(1)", false],
    ["data:image/png;base64,AAAA", false],
    ["/relative.png", false],
    ["", false],
    [undefined, false],
  ])("%s → %s", (value, expected) => {
    expect(isDisplayableImageUrl(value)).toBe(expected)
  })

  it("https の画像は表示する", async () => {
    renderWithImage("https://cdn.example/a.png")
    expect(await screen.findByText("例")).toBeInTheDocument()
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example/a.png")
  })

  it("http の画像は（キャッシュに残っていても）読み込まない", async () => {
    renderWithImage("http://cdn.example/a.png")
    expect(await screen.findByText("例")).toBeInTheDocument()
    expect(screen.queryByRole("img")).toBeNull()
  })
})
