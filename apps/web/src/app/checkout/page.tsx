import type { Metadata } from 'next';
import { auth } from '@/auth';
import { canUseShop } from '@idol/shared';
import { CheckoutForm } from '@/components/cart/CheckoutForm';
import { ShopBlockedNotice } from '@/components/cart/ShopBlockedNotice';

export const metadata: Metadata = { title: 'お支払い' };
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const session = await auth();
  const shopBlocked = !canUseShop(session?.user?.plan);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">お支払い</h1>
      {shopBlocked ? <ShopBlockedNotice /> : <CheckoutForm />}
    </div>
  );
}
