import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { OGPPreview } from "../OGPPreview"

afterEach(() => vi.unstubAllGlobals())

const URL_RAKUTEN = "https://item.rakuten.co.jp/book/17793463/"

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function renderPreview(props: Partial<React.ComponentProps<typeof OGPPreview>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OGPPreview url={URL_RAKUTEN} {...props} />
    </QueryClientProvider>
  )
}

describe("OGPPreview: 取得できなかったときの表示 (#140)", () => {
  it.each([
    ["422（Amazon・OGP なし・相手の 403 など）", () => Promise.resolve(jsonResponse(422, { error: "Failed to fetch URL" }))],
    ["500（タイムアウトなど）", () => Promise.resolve(jsonResponse(500, { error: "Request timed out" }))],
    ["通信エラー", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("fallback=\"link\" で %s のときは、ドメインと URL のリンクだけのカードを出す", async (_label, impl) => {
    stubFetch(impl)
    renderPreview({ fallback: "link" })

    const card = await screen.findByTestId("ogp-link-fallback")
    expect(card).toHaveAttribute("href", URL_RAKUTEN)
    expect(card).toHaveAttribute("target", "_blank")
    expect(card).toHaveAttribute("rel", expect.stringContaining("noopener"))
    expect(card).toHaveTextContent("item.rakuten.co.jp")
    expect(card).toHaveTextContent(URL_RAKUTEN)
    expect(screen.queryByTestId("ogp-preview")).toBeNull()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("既定（ホーム・買い物リスト）では、失敗したときに何も出さない", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(422, { error: "x" })))
    const { container } = renderPreview()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(screen.queryByTestId("ogp-link-fallback")).toBeNull()
  })

  it("取得できたときは、fallback=\"link\" でも通常のカードを出す", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, { url: URL_RAKUTEN, title: "本のタイトル" })))
    renderPreview({ fallback: "link" })

    expect(await screen.findByTestId("ogp-preview")).toHaveTextContent("本のタイトル")
    expect(screen.queryByTestId("ogp-link-fallback")).toBeNull()
  })

  it("チェック済みのときは、リンクだけのカードも薄くして打ち消し線を付ける", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(422, { error: "x" })))
    renderPreview({ fallback: "link", checked: true })

    const card = await screen.findByTestId("ogp-link-fallback")
    expect(card.className).toContain("opacity-50")
    expect(screen.getByText("item.rakuten.co.jp").className).toContain("line-through")
  })
})
