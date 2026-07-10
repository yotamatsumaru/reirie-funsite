'use client';

/**
 * マイページ内の退会セクション。
 *  - 誤操作防止のため、現在のパスワード再入力 + 確認テキスト入力の二重確認を要求する。
 *  - 有効なサブスクリプションがある場合はその旨を警告表示する
 *    (実際のキャンセル処理は DELETE /api/me 側で自動的に行われる)。
 *  - 成功したら Auth.js のセッションをクリアしてトップページへ遷移する。
 */
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/stores/ui-store';

const CONFIRM_TEXT = '退会する';

export function WithdrawSection({ hasActiveSub }: { hasActiveSub: boolean }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.length > 0 && confirmText === CONFIRM_TEXT && !submitting;

  async function handleWithdraw() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(j.error?.message ?? '退会処理に失敗しました');
        setSubmitting(false);
        return;
      }
      toast.success('退会処理が完了しました。ご利用ありがとうございました。');
      await signOut({ callbackUrl: '/' });
    } catch {
      setError('通信エラーが発生しました。時間を置いて再度お試しください');
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-slate-400 underline hover:text-rose-600"
      >
        退会する
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
      <div>
        <p className="text-sm font-semibold text-rose-700">本当に退会しますか？</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li>退会すると、保有ポイント・特典ポイント・購入履歴などのデータは失われます。</li>
          <li>この操作は取り消せません。</li>
          {hasActiveSub && (
            <li className="font-semibold text-rose-700">
              現在有効な会員プランの契約があります。退会と同時に自動的に解約されます。
            </li>
          )}
        </ul>
      </div>

      <Input
        type="password"
        label="現在のパスワード"
        placeholder="パスワードを入力してください"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        disabled={submitting}
      />

      <Input
        label={`確認のため「${CONFIRM_TEXT}」と入力してください`}
        placeholder={CONFIRM_TEXT}
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        disabled={submitting}
      />

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex gap-2">
        <Button
          variant="danger"
          onClick={handleWithdraw}
          disabled={!canSubmit}
          loading={submitting}
        >
          退会する
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setPassword('');
            setConfirmText('');
            setError(null);
          }}
          disabled={submitting}
        >
          キャンセル
        </Button>
      </div>
    </div>
  );
}
