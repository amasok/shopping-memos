import { AppLayout } from "@/components/layouts/AppLayout"
import { Header } from "@/components/layouts/Header"
import { PageContainer } from "@/components/ui"

export default function PrivacyPolicyPage() {
  return (
    <AppLayout showBottomNav={false}>
      <Header title="プライバシーポリシー" showBackButton backHref="/settings" />
      <PageContainer>
        <div className="prose prose-sm max-w-none">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500 mb-6">最終更新日: 2025年1月28日</p>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">1. はじめに</h2>
              <p className="text-gray-700 leading-relaxed">
                「買い物メモ」（以下「本アプリ」）は、ユーザーのプライバシーを尊重し、
                個人情報の保護に努めます。本ポリシーでは、本アプリが収集する情報と
                その利用方法について説明します。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">2. 収集する情報</h2>
              <p className="text-gray-700 leading-relaxed mb-3">
                本アプリでは、以下の情報を収集します：
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-2">
                <li>
                  <strong>アカウント情報</strong>：Googleログイン時に取得する名前、
                  メールアドレス、プロフィール画像
                </li>
                <li>
                  <strong>アプリデータ</strong>：買いたいもの、タグ、買い物リスト、
                  購入履歴などのユーザーが作成したデータ
                </li>
                <li>
                  <strong>グループ情報</strong>：グループ名、メンバー情報
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">3. 情報の利用目的</h2>
              <p className="text-gray-700 leading-relaxed mb-3">
                収集した情報は、以下の目的で利用します：
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-2">
                <li>本アプリの機能提供（買い物リストの管理、同期）</li>
                <li>グループメンバー間でのデータ共有</li>
                <li>ユーザー認証とアカウント管理</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">4. 情報の共有</h2>
              <p className="text-gray-700 leading-relaxed">
                本アプリは、ユーザーの個人情報を第三者に販売、貸与、または共有しません。
                ただし、以下の場合を除きます：
              </p>
              <ul className="list-disc list-inside text-gray-700 space-y-2 mt-3">
                <li>ユーザーが参加するグループのメンバーへの共有データ</li>
                <li>法令に基づく開示要請があった場合</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">5. データの保存</h2>
              <p className="text-gray-700 leading-relaxed">
                ゲストモード（未ログイン）では、データはお使いのデバイスにのみ保存されます。
                ログイン後は、データはサーバーに安全に保存され、複数デバイス間で同期されます。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">6. データの削除</h2>
              <p className="text-gray-700 leading-relaxed">
                ユーザーはいつでもアカウントを削除し、サーバーに保存されたデータを
                完全に削除することができます。ゲストモードのデータは、ブラウザの
                データを消去することで削除できます。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">7. セキュリティ</h2>
              <p className="text-gray-700 leading-relaxed">
                本アプリは、ユーザーの情報を保護するために適切なセキュリティ対策を
                講じています。すべての通信はHTTPSで暗号化されています。
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-900 mb-3">8. ポリシーの変更</h2>
              <p className="text-gray-700 leading-relaxed">
                本ポリシーは、必要に応じて更新されることがあります。
                重要な変更がある場合は、アプリ内でお知らせします。
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-3">9. お問い合わせ</h2>
              <p className="text-gray-700 leading-relaxed">
                本ポリシーに関するご質問は、アプリの開発者までお問い合わせください。
              </p>
            </section>
          </div>
        </div>
      </PageContainer>
    </AppLayout>
  )
}
