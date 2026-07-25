'use client';

/**
 * 会員番号 一括採番 UI (SUPER_ADMIN)。
 *
 * 会員番号は登録時 (signup) と会員カード表示時に採番されるが、その導線を通って
 * いない既存ユーザーには番号が付いていない。このパネルから、番号なしユーザー全員へ
 * 登録が古い順に会員番号を一括採番できる (何度実行しても既存番号は変わらない)。
 *
 * 実行は /api/super-admin/member-numbers/backfill (POST) 経由。
 */
import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

export type MemberNumberStats = {
  total: number;
  withNumber: number;
  missing: number;
};

export function MemberNumberClient({ initial }: { initial: MemberNumberStats }) {
  const [stats, setStats] = useState<MemberNumberStats>(initial);
  const [busy, setBusy] = useState(false);

  async function runBackfill() {
    if (busy) return;
    if (stats.missing === 0) {
      toast.info('未採番のユーザーはいません');
      return;
    }
    if (
      !window.confirm(
        `会員番号が未採番のユーザー ${stats.missing} 名に、登録が古い順で会員番号を採番します。\nよろしいですか？（既に番号を持つ会員の番号は変わりません）`,
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/member-numbers/backfill', {
        method: 'POST',
      });
      const data = (await res.json().catch(() => null)) as
        | { assigned: number; alreadyHad: number; message?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? '採番に失敗しました');
      }
      toast.success(data?.message ?? '会員番号を採番しました');

      // 最新の採番状況を取り直す
      const statRes = await fetch('/api/super-admin/member-numbers/backfill', {
        method: 'GET',
      });
      if (statRes.ok) {
        setStats((await statRes.json()) as MemberNumberStats);
      }
    } catch (e) {
      toast.error((e as Error).message, '採番エラー');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="text-xl">🎫</span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">会員番号</h2>
            <p className="text-xs text-slate-500">
              番号が付いていない会員へ一括で採番します（全プラン対象）
            </p>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 px-3 py-2.5">
            <p className="text-xs font-medium text-slate-500">会員総数</p>
            <p className="mt-1 text-xl font-bold text-slate-900">
              {stats.total.toLocaleString()}
              <span className="ml-1 text-xs font-normal text-slate-500">名</span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 px-3 py-2.5">
            <p className="text-xs font-medium text-slate-500">採番済み</p>
            <p className="mt-1 text-xl font-bold text-emerald-600">
              {stats.withNumber.toLocaleString()}
              <span className="ml-1 text-xs font-normal text-slate-500">名</span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 px-3 py-2.5">
            <p className="text-xs font-medium text-slate-500">未採番</p>
            <p
              className={`mt-1 text-xl font-bold ${
                stats.missing > 0 ? 'text-amber-600' : 'text-slate-400'
              }`}
            >
              {stats.missing.toLocaleString()}
              <span className="ml-1 text-xs font-normal text-slate-500">名</span>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            新規登録ユーザーには登録時に自動で会員番号が付与されます。ここでは、それ以前に
            登録して番号が付いていない既存会員へまとめて採番できます。
          </p>
          <button
            type="button"
            onClick={runBackfill}
            disabled={busy || stats.missing === 0}
            className="shrink-0 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? '採番中…'
              : stats.missing === 0
                ? '未採番なし'
                : `未採番 ${stats.missing} 名に採番`}
          </button>
        </div>
      </CardBody>
    </Card>
  );
}
