'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

export function ManageSubscriptionButtons({ hasActiveSub }: { hasActiveSub: boolean }) {
  const [loading, setLoading] = useState<string | null>(null);

  const subscribe = async (plan: 'STANDARD' | 'PREMIUM', interval: 'MONTH' | 'YEAR') => {
    setLoading(`${plan}-${interval}`);
    try {
      const res = await fetch('/api/subscriptions/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planType: plan, billingInterval: interval }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? 'チェックアウトに失敗しました');
      }
      const j = await res.json();
      window.location.href = j.url;
    } catch (e) {
      toast.error((e as Error).message);
      setLoading(null);
    }
  };

  const portal = async () => {
    setLoading('portal');
    try {
      const res = await fetch('/api/subscriptions/portal', { method: 'POST' });
      if (!res.ok) throw new Error('ポータルを開けませんでした');
      const j = await res.json();
      window.location.href = j.url;
    } catch (e) {
      toast.error((e as Error).message);
      setLoading(null);
    }
  };

  if (hasActiveSub) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={portal} loading={loading === 'portal'}>
          支払い情報・解約を管理
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => subscribe('STANDARD', 'MONTH')} loading={loading === 'STANDARD-MONTH'}>
        STANDARD 月額
      </Button>
      <Button
        variant="secondary"
        onClick={() => subscribe('PREMIUM', 'MONTH')}
        loading={loading === 'PREMIUM-MONTH'}
      >
        PREMIUM 月額
      </Button>
      <Button
        variant="outline"
        onClick={() => subscribe('PREMIUM', 'YEAR')}
        loading={loading === 'PREMIUM-YEAR'}
      >
        PREMIUM 年額
      </Button>
    </div>
  );
}
