import type { Metadata } from 'next';
import { auth } from '@/auth';
import { canUseShop } from '@idol/shared';
import { CartView } from '@/components/cart/CartView';
import { ShopBlockedNotice } from '@/components/cart/ShopBlockedNotice';

export const metadata: Metadata = { title: 'カート' };
export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const session = await auth();
  const shopBlocked = !canUseShop(session?.user?.plan);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">カート</h1>
      {shopBlocked ? <ShopBlockedNotice /> : <CartView />}
    </div>
  );
}
