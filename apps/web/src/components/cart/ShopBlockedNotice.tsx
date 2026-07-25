import Link from 'next/link';

/**
 * 無料会員 (FREE) / 未認証がカート・お支払いページにアクセスした際に表示する案内。
 * 物販 (EC) はスタンダード以上のプラン限定。
 */
export function ShopBlockedNotice() {
  return (
    <div className="rounded-md bg-brand-50 p-6 text-center text-sm text-brand-700">
      <p className="text-base font-semibold">
        物販（ショップ）はスタンダード以上のプラン限定です
      </p>
      <p className="mt-2 text-brand-600">
        無料会員の方は商品をご購入いただけません。
        <br />
        プランをアップグレードすると、ショップをご利用いただけます。
      </p>
      <Link
        href="/plans"
        className="mt-4 inline-block rounded-md bg-brand-600 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        プランを見る
      </Link>
    </div>
  );
}
