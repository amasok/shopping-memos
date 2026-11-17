import { escapeHtml } from "./escape"

/** 送るメールの中身。宛先は送信の側で決める */
export interface EmailContent {
  subject: string
  text: string
  html: string
}

export const SUBJECT_PREFIX = "【買い物メモ】"

const FOOTER = "このメールは送信専用です。返信はできません。"

/** 段落を本文に組み立てる。段落はプレーンテキストで受け取り、HTML ではエスケープする */
export function buildContent(subject: string, paragraphs: string[], highlight?: string): EmailContent {
  const textParts = highlight === undefined ? paragraphs : [paragraphs[0], highlight, ...paragraphs.slice(1)]
  const text = [...textParts, FOOTER].join("\n\n")

  const htmlParagraphs = paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
  if (highlight !== undefined) {
    htmlParagraphs.splice(
      1,
      0,
      `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${escapeHtml(highlight)}</p>`
    )
  }
  const html = [
    `<!doctype html><html lang="ja"><body style="font-family:sans-serif;line-height:1.6">`,
    ...htmlParagraphs,
    `<p style="color:#666;font-size:12px">${escapeHtml(FOOTER)}</p>`,
    `</body></html>`,
  ].join("")

  return { subject: `${SUBJECT_PREFIX}${subject}`, text, html }
}
