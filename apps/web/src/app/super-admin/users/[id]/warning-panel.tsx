'use client';

/**
 * ユーザー詳細ページ用: 警告通知の発行フォーム + 履歴表示 (Client Component)
 *  - メール送信のみ (サイト内表示なし)。理由入力必須。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/ui-store';

export interface WarningItem {
  id: string;
  reason: string;
  emailSent: boolean;
  emailError: string | null;
  createdAt: string;
  issuedBy: { id: string; displayName: string | null; email: string } | null;
}

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

export function WarningPanel({
  userId,
  initialWarnings,
  readOnly = false,
}: {
  userId: string;
  initialWarnings: WarningItem[];
  /** スタッフ管理者など閲覧のみの場合 true。警告メール送信フォームを非表示にし、履歴のみ表示する。 */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [warnings, setWarnings] = useState(initialWarnings);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSend() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('警告理由を入力してください');
      return;
    }
    if (!confirm('このユーザーへ警告メールを送信しますか？')) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/super-admin/users/${userId}/warning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: trimmed }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        warning?: { id: string; reason: string; emailSent: boolean; emailError: string | null; createdAt: string };
      };
      if (!res.ok) {
        setError(json.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      if (json.warning) {
        setWarnings((prev) => [
          { ...json.warning!, issuedBy: null },
          ...prev,
        ]);
        toast.success(
          json.warning.emailSent
            ? '警告メールを送信しました'
            : '警告を記録しましたが、メール送信に失敗しました',
        );
        setReason('');
        router.refresh();
      }
    });
  }

  return (
    <div>
      {!readOnly && (
      <div className="mb-4">
        <label className="mb-1 block text-xs font-semibold text-slate-700">
          警告理由 (メール本文としてそのまま送信されます)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="例: コミュニティガイドラインに違反する投稿がありました。今後同様の行為が続く場合、アカウントを停止することがあります。"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
        />
        <div className="mt-2 flex items-center justify-between">
          {error ? (
            <span className="text-xs text-rose-600">{error}</span>
          ) : (
            <span className="text-xs text-slate-400">
              サイト内表示は行わずメール通知のみ送信します。
            </span>
          )}
          <Button onClick={handleSend} loading={pending} variant="secondary">
            警告メールを送信
          </Button>
        </div>
      </div>
      )}

      {warnings.length === 0 ? (
        <p className="text-sm text-slate-400">警告履歴はありません。</p>
      ) : (
        <ul className="space-y-3">
          {warnings.map((w) => (
            <li key={w.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{formatDateTime(w.createdAt)}</span>
                {w.emailSent ? (
                  <Badge tone="success">メール送信済み</Badge>
                ) : (
                  <Badge tone="danger">送信失敗{w.emailError ? `: ${w.emailError}` : ''}</Badge>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-800">{w.reason}</p>
              {w.issuedBy && (
                <p className="mt-1 text-[11px] text-slate-400">
                  発行者: {w.issuedBy.displayName ?? w.issuedBy.email}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
