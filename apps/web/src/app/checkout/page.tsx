import type { Metadata } from 'next';
import { CheckoutForm } from '@/components/cart/CheckoutForm';

export const metadata: Metadata = { title: 'お支払い' };

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">お支払い</h1>
      <CheckoutForm />
    </div>
  );
}
