'use client';

/**
 * ユーザー詳細ページ用: プロモ/デモアカウントの付与・解除 (Client Component)
 *
 * プロモ有効期間中は「あっちむいてPUI」ミニゲームが
 *   ① 1日のプレイ回数が無制限
 *   ② 勝率が PREMIUM 相当に固定
 * になる。イベント配布用のデモアカウントを想定。
 *
 * PATCH /api/super-admin/users/[id] に { promoUntil: ISO日時 | null } を送る。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/ui-store';

/** 「無期限」相当として扱う遠い未来の日時 (2099-12-31) */
const FOREVER_ISO = '2099-12-31T14:59:59.000Z';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** promoUntil が「無期限」扱い (2099 年以降) かどうか */
function isForever(iso: string): boolean {
  return new Date(iso).getTime() >= new Date('2099-01-01T00:00:00.000Z').getTime();
}

/** N 日後の ISO 日時文字列を返す */
function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function PromoPanel({
  userId,
  initialPromoUntil,
  readOnly = false,
}: {
  userId: string;
  initialPromoUntil: string | null;
  /** スタッフ管理者など閲覧のみの場合 true。付与/解除ボタンを非表示にし、状態のみ表示する。 */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [promoUntil, setPromoUntil] = useState<string | null>(initialPromoUntil);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = promoUntil !== null && new Date(promoUntil).getTime() > Date.now();
  const expired = promoUntil !== null && !active;

  function submit(nextIso: string | null, confirmMessage: string) {
    if (!confirm(confirmMessage)) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/super-admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promoUntil: nextIso }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        ok?: boolean;
        user?: { promoUntil?: string | null };
        noChange?: boolean;
      };
      if (!res.ok) {
        setError(json.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      // noChange のときは既存値を維持、それ以外は送信値を反映
      const applied = json.noChange ? promoUntil : (json.user?.promoUntil ?? nextIso);
      setPromoUntil(applied ?? null);
      toast.success(
        nextIso === null
          ? 'プロモ/デモを解除しました'
          : 'プロモ/デモを付与しました',
      );
      router.refresh();
    });
  }

  function grantDays(days: number) {
    const iso = daysFromNowIso(days);
    submit(iso, `このユーザーにプロモ/デモを ${days} 日間付与しますか？\n(${formatDateTime(iso)} まで)`);
  }

  function grantForever() {
    submit(FOREVER_ISO, 'このユーザーに無期限のプロモ/デモを付与しますか？');
  }

  function revoke() {
    submit(null, 'このユーザーのプロモ/デモを解除しますか？');
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">現在の状態:</span>
        {active ? (
          <Badge tone="brand">
            {promoUntil && isForever(promoUntil)
              ? 'プロモ有効 (無期限)'
              : `プロモ有効 (〜${promoUntil ? formatDateTime(promoUntil) : ''})`}
          </Badge>
        ) : expired ? (
          <Badge tone="gray">
            プロモ期限切れ ({promoUntil ? formatDateTime(promoUntil) : ''})
          </Badge>
        ) : (
          <Badge tone="gray">通常アカウント</Badge>
        )}
      </div>

      <p className="mb-3 text-xs text-slate-500">
        プロモ/デモを付与すると、そのユーザーは「あっちむいてPUI」を
        <strong className="text-slate-700">回数無制限</strong>でプレイでき、
        勝率が<strong className="text-slate-700">PREMIUM 相当</strong>に固定されます。
        期限が切れると自動的に通常アカウントに戻ります。
      </p>

      {readOnly ? (
        <p className="text-xs text-slate-400">閲覧のみ（付与・解除はスーパー管理者のみ可能）</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => grantDays(1)} loading={pending} variant="outline" size="sm">
            1日付与
          </Button>
          <Button onClick={() => grantDays(7)} loading={pending} variant="outline" size="sm">
            7日付与
          </Button>
          <Button onClick={() => grantDays(30)} loading={pending} variant="outline" size="sm">
            30日付与
          </Button>
          <Button onClick={grantForever} loading={pending} variant="secondary" size="sm">
            無期限付与
          </Button>
          <Button
            onClick={revoke}
            loading={pending}
            variant="danger"
            size="sm"
            disabled={promoUntil === null}
          >
            解除
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
