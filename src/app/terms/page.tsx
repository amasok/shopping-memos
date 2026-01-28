import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { PageContainer } from "@/components/ui"

export default function TermsOfServicePage() {
  return (
    <AppLayout showBottomNav={false}>
      <Header title="利用規約" showBackButton backHref="/settings" />
      <PageContainer>
        <div className="prose prose-sm max-w-none">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500 mb-6">最終更新日: 2025年1月28日</p>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">1. はじめに</h2>
              <p className="text-gray-700 leading-relaxed">
                本利用規約（以下「本規約」）は、「買い物メモ」（以下「本アプリ」）の
                利用条件を定めるものです。ユーザーは、本アプリを利用することにより、
                本規約に同意したものとみなされます。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">2. サービスの内容</h2>
              <p className="text-gray-700 leading-relaxed">
                本アプリは、買い物リストの作成・管理・共有機能を提供します。
                ユーザーは、個人での利用またはグループでの共有利用が可能です。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">3. アカウント</h2>
              <p className="text-gray-700 leading-relaxed">
                本アプリはゲストモード（ログインなし）でも利用可能です。
                Googleアカウントでログインすることで、データの同期やグループ機能が
                利用できます。ユーザーは、自身のアカウント情報の管理に責任を持ちます。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">4. 禁止事項</h2>
              <p className="text-gray-700 leading-relaxed mb-3">
                ユーザーは、以下の行為を行ってはなりません：
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-2">
                <li>法令または公序良俗に違反する行為</li>
                <li>本アプリの運営を妨害する行為</li>
                <li>他のユーザーに迷惑をかける行為</li>
                <li>不正アクセスやセキュリティを侵害する行為</li>
                <li>本アプリを商業目的で無断利用する行為</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">5. 免責事項</h2>
              <p className="text-gray-700 leading-relaxed">
                本アプリは「現状有姿」で提供されます。開発者は、本アプリの利用により
                生じた損害について、法令で許容される範囲で責任を負いません。
                データの損失やサービスの中断に備え、重要なデータは別途バックアップを
                取ることを推奨します。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">6. サービスの変更・終了</h2>
              <p className="text-gray-700 leading-relaxed">
                開発者は、事前の通知なく本アプリの内容を変更、または提供を終了する
                ことがあります。重要な変更がある場合は、可能な限り事前にお知らせします。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">7. 知的財産権</h2>
              <p className="text-gray-700 leading-relaxed">
                本アプリに関する著作権その他の知的財産権は、開発者に帰属します。
                ユーザーが作成したデータの著作権は、ユーザーに帰属します。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">8. 規約の変更</h2>
              <p className="text-gray-700 leading-relaxed">
                本規約は、必要に応じて変更されることがあります。
                変更後の規約は、本アプリ上で公開された時点から効力を生じます。
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">9. 準拠法・管轄</h2>
              <p className="text-gray-700 leading-relaxed">
                本規約は日本法に準拠します。本アプリに関する紛争については、
                東京地方裁判所を第一審の専属的合意管轄裁判所とします。
              </p>
            </section>
          </div>
        </div>
      </PageContainer>
    </AppLayout>
  )
}
