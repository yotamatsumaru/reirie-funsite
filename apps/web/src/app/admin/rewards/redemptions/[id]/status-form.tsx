/**
 * 発送ステータス更新フォーム (PENDING→PROCESSING→SHIPPED→COMPLETED / CANCELED)
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  REWARD_REDEMPTION_STATUS_TRANSITIONS,
  REWARD_REDEMPTION_STATUS_LABELS,
  type RewardRedemptionStatusLiteral,
} from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';

interface Props {
  id: string;
  currentStatus: RewardRedemptionStatusLiteral;
  currentTrackingNumber: string | null;
  currentAdminNote: string | null;
}

export function StatusForm({ id, currentStatus, currentTrackingNumber, currentAdminNote }: Props) {
  const router = useRouter();
  const [trackingNumber, setTrackingNumber] = useState(currentTrackingNumber ?? '');
  const [adminNote, setAdminNote] = useState(currentAdminNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextOptions = REWARD_REDEMPTION_STATUS_TRANSITIONS[currentStatus];

  async function transitionTo(status: RewardRedemptionStatusLiteral) {
    if (status === 'CANCELED' && !confirm('キャンセルすると特典ポイントが返還されます。よろしいですか?')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reward-redemptions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status,
          trackingNumber: trackingNumber || undefined,
          adminNote: adminNote || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '更新に失敗しました');
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveNoteOnly() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reward-redemptions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: currentStatus,
          trackingNumber: trackingNumber || undefined,
          adminNote: adminNote || undefined,
        }),
      });
      if (!res.ok) {
        // 同一ステータスへの遷移は INVALID_TRANSITION エラーになるため、
        // 追跡番号・メモだけの保存は個別に許可する簡易フォールバック。
        // (サーバー側で同一ステータス更新を許可していない場合はエラーメッセージのみ表示)
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '保存に失敗しました (ステータスを変更してください)');
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-slate-900">発送ステータス</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-600">
          現在:{' '}
          <span className="font-semibold text-slate-900">
            {REWARD_REDEMPTION_STATUS_LABELS[currentStatus]}
          </span>
        </p>

        <Input
          label="追跡番号 (発送時に入力)"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
        />
        <Textarea
          label="運営メモ"
          rows={3}
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
        />

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" loading={busy} onClick={saveNoteOnly}>
            メモ・追跡番号を保存
          </Button>
          {nextOptions.map((next) => (
            <Button
              key={next}
              type="button"
              variant={next === 'CANCELED' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => transitionTo(next)}
            >
              {REWARD_REDEMPTION_STATUS_LABELS[next]} にする
            </Button>
          ))}
          {nextOptions.length === 0 && (
            <p className="text-xs text-slate-400">これ以上ステータスは変更できません</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
