/**
 * /tokushoho — 特定商取引法に基づく表記 (公開ページ)
 *
 * 運営会社: UMG株式会社。参考: dreamvision.space/legal をベースに、
 * ReiRieRoom (ファンクラブ会員制サブスク: 無料 / スタンダード月額 / プレミアム年額) に合わせて改稿。
 *
 * ※ 事業者情報 (所在地・運営責任者・連絡先) は参考サイトの UMG株式会社 表記を暫定転記している。
 *    本番公開前に最新の正式情報へ差し替えること。
 */
import type { Metadata } from 'next';
import {
  LegalPage,
  LegalSection,
  LegalP,
  LegalList,
  LegalDefinitionTable,
} from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記',
  description: 'ReiRieRoom における特定商取引法に基づく表記です。',
};

export default function TokushohoPage() {
  return (
    <LegalPage
      title="特定商取引法に基づく表記"
      updatedAt="2026年7月25日"
      lead={
        <p>
          「特定商取引に関する法律」第11条に基づき、オンラインファンクラブサービス「ReiRieRoom」の
          販売条件を以下のとおり表示します。
        </p>
      }
    >
      <LegalSection title="事業者情報">
        <LegalDefinitionTable
          rows={[
            { label: '事業者名（販売業者）', value: 'UMG株式会社' },
            { label: '運営責任者', value: '佐々木 一平' },
            {
              label: '所在地',
              value: (
                <>
                  〒150-0041
                  <br />
                  東京都渋谷区神南１丁目１０番８号 エフビル３０１号室
                </>
              ),
            },
            {
              label: 'お問い合わせ',
              value: (
                <>
                  <a
                    href="/contact"
                    className="font-semibold text-twilight-rose underline"
                  >
                    お問い合わせフォーム
                  </a>
                  よりご連絡ください。
                  <br />
                  受付時間：10:00〜18:00（土日祝日も対応。営業時間外のお問い合わせは翌営業日以降の対応となります）
                  <br />
                  通常1〜2営業日以内にご返信いたします。
                </>
              ),
            },
          ]}
        />
        <LegalP>
          ※ 電話番号については、ご請求があれば遅滞なく開示いたします。上記お問い合わせフォームよりお申し付けください。
        </LegalP>
      </LegalSection>

      <LegalSection title="販売価格">
        <LegalP>各会員プランのご案内ページに表示された価格（すべて税込）</LegalP>
        <LegalList
          items={[
            '無料プラン：¥0',
            'スタンダードプラン：¥666 / 月（月額・自動更新）',
            'プレミアムプラン：¥7,920 / 年（年額・自動更新）',
          ]}
        />
        <LegalP>
          ※ 表示価格はすべて日本円（JPY）・消費税込みの金額です。
          <br />
          ※ 料金・プラン内容は変更される場合があります。最新の内容はプラン紹介ページをご確認ください。
          <br />
          ※ クレジットカード決済手数料は販売価格に含まれております。
        </LegalP>
      </LegalSection>

      <LegalSection title="商品代金以外に必要な料金">
        <LegalList
          items={[
            'インターネット接続料金（お客様のご契約プロバイダーとの契約に基づきます）',
            'モバイルデータ通信をご利用の場合の通信料（動画視聴時は大量のデータ通信が発生します。Wi-Fi 環境でのご利用を推奨します）',
          ]}
        />
      </LegalSection>

      <LegalSection title="支払方法">
        <LegalP>
          クレジットカード決済（Stripe 決済システムを利用）
          <br />
          利用可能カード：Visa / Mastercard / American Express / JCB / Diners Club / Discover
        </LegalP>
      </LegalSection>

      <LegalSection title="支払時期">
        <LegalList
          items={[
            '新規のお申込み時：お申込み手続完了時に即時決済されます。',
            '更新時（自動更新）：スタンダードプランは毎月の更新日、プレミアムプランは毎年の更新日に、登録の支払手段へ課金されます。',
          ]}
        />
      </LegalSection>

      <LegalSection title="サービスの提供時期">
        <LegalP>
          お申込み（決済）完了後、直ちに契約中のプランに応じた会員特典・コンテンツをご利用いただけます。ライブ配信は各配信の開始時刻より視聴可能です。
        </LegalP>
        <LegalP>
          プレミアムプランの会報誌は年2回、当社が定める時期に、マイページ登録の住所へ発送します。
        </LegalP>
      </LegalSection>

      <LegalSection title="解約・返品・返金ポリシー">
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
          本サービスはデジタルコンテンツを含む継続課金型（サブスクリプション）の会員サービスです。
          <strong>お申込み・更新完了後の返品・キャンセルおよび日割り返金は、原則としてお受けできません。</strong>
          ご契約前に、必ずプラン内容・料金・更新サイクルをご確認ください。
        </p>

        <p className="mt-3 font-semibold text-slate-700">解約について</p>
        <LegalList
          items={[
            'いつでもマイページから解約できます。',
            '解約後は、当該課金期間の終了日まで引き続き特典・コンテンツをご利用いただけます。',
            '解約により、次回更新分の課金は行われません。既にお支払い済みの期間の料金は返金されません。',
          ]}
        />

        <p className="mt-4 font-semibold text-slate-700">返金対応を行う場合</p>
        <LegalList
          items={[
            '当社都合によりサービスの提供が長期間不可能となった場合：状況に応じて返金いたします。',
            'システムの重大な不具合により長期間サービスを利用できなかった場合：状況に応じて一部または全額返金いたします。',
            'システムエラーにより二重課金が発生した場合：重複分を返金いたします。',
            'お客様の意図しない決済が行われた場合：決済後24時間以内かつ未利用の場合に限り、全額返金を検討いたします。',
          ]}
        />

        <p className="mt-4 font-semibold text-slate-700">返金対応を行わない場合</p>
        <LegalList
          items={[
            'お客様都合による解約（予定変更、気が変わった等）',
            'お客様の視聴環境・インターネット接続の問題',
            '推奨動作環境を満たしていない端末での利用',
            '既にコンテンツ・特典を利用した後の契約期間分',
            '会員登録住所の不備・誤りにより会報誌等が届かなかった場合',
          ]}
        />

        <p className="mt-4 font-semibold text-slate-700">返金申請の手順</p>
        <LegalList
          items={[
            <>
              <a href="/contact" className="font-semibold text-twilight-rose underline">
                お問い合わせフォーム
              </a>
              より「返金申請」としてご連絡ください。
            </>,
            '必要情報：登録メールアドレス／お名前（アカウント名）／会員番号／課金日時／返金希望理由',
            '審査期間：申請受付後、2〜3営業日以内に審査結果をメールで通知します。',
            '返金方法・時期：承認後、購入時のクレジットカードへ返金します。カード会社の処理により、明細反映まで時間がかかる場合があります。',
          ]}
        />
        <LegalP>
          本返金ポリシーは、特定商取引法、消費者契約法および電子消費者契約法に基づき定めています。
        </LegalP>
      </LegalSection>

      <LegalSection title="特別な提供条件">
        <LegalList
          items={[
            '本サービスは会員本人のみが利用できます。アカウント・視聴権・特典の第三者への譲渡、貸与、共有は禁止されています。',
            'コンテンツの録画、録音、スクリーンショット、転載等は著作権法により禁止されています。',
            '各プランで利用できるコンテンツ・特典は、契約中のプランおよび契約が有効な期間に限られます。',
            'グッズ販売・チケット申込等、個別の物販・申込には別途の条件・費用が適用される場合があります。詳細は各ページをご確認ください。',
          ]}
        />
      </LegalSection>

      <LegalSection title="動作環境">
        <LegalP>
          推奨ブラウザ：Google Chrome / Safari / Firefox / Microsoft Edge（いずれも最新版）
        </LegalP>
        <LegalList
          items={[
            '推奨通信速度：下り 5Mbps 以上（HD 画質は 10Mbps 以上を推奨）',
            '安定したインターネット接続（有線接続または Wi-Fi を推奨）',
          ]}
        />
        <LegalP>
          上記環境を満たしていても、ネットワーク状況やデバイスの性能により正常に動作しない場合があります。
        </LegalP>
      </LegalSection>

      <LegalSection title="準拠法・管轄">
        <LegalP>
          本取引は日本法に準拠し、本サービスに関して紛争が生じた場合、東京地方裁判所を第一審の専属的合意管轄裁判所とします。
        </LegalP>
      </LegalSection>
    </LegalPage>
  );
}
