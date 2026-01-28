import type { Metadata, Viewport } from "next"
import "./globals.css"
import { Providers } from "./providers"

export const metadata: Metadata = {
  title: "買い物メモ",
  description: "家族で共有できる買い物メモアプリ",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <body className="antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
