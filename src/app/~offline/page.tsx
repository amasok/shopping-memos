export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-bold">オフラインです</h1>
      <p className="text-sm text-gray-600">
        このページはまだ保存されていません。ネットワークに接続してからもう一度開いてください。
      </p>
    </main>
  )
}
