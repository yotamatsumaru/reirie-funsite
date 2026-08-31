'use client';

/**
 * ユーザー詳細ページ用: 運営によるメールアドレス変更パネル
 *
 * 【この機能の位置づけ】
 * 通常、メールアドレスの変更は会員本人がマイページから行う (新アドレス宛の
 * 確認コードを入力して確定する) 。こちらはその手続きが取れない場合の救済策。
 *   - 旧アドレスを解約済みでログインできない
 *   - キャリアメールの受信拒否で確認コードが届かない
 * といったケースで、お問い合わせを受けた運営が代行する。
 *
 * 【誤操作・なりすまし対策】
 * メールアドレスはログイン ID そのものなので、間違ったアドレスに変えると
 * 本人がログインできなくなる。そのため
 *   - 入力したアドレスをもう一度確認させる二重確認
 *   - 変更理由の入力を必須にする (後から経緯を追えるように)
 *   - 実行前に「誰を・何から・何に」変えるかを明示した確認ダイアログ
 * を用意している。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/stores/ui-store';

export function EmailChangePanel({
  userId,
  currentEmail,
  readOnly = false,
}: {
  userId: string;
  currentEmail: string;
  /** スタッフ管理者など閲覧のみの場合 true。 */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = newEmail.trim().toLowerCase();
  const normalizedConfirm = confirmEmail.trim().toLowerCase();
  // 打ち間違いをそのまま確定させないための二重確認。
  const emailsMatch = normalized.length > 0 && normalized === normalizedConfirm;
  const isSameAsCurrent = normalized === currentEmail.trim().toLowerCase();
  const canSubmit =
    emailsMatch && !isSameAsCurrent && reason.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    // メールアドレスはログイン ID。取り返しがつかない操作なので、
    // 変更前後を明示したうえで最終確認を取る。
    const ok = window.confirm(
      [
        'この会員のログイン用メールアドレスを変更します。',
        '',
        `変更前: ${currentEmail}`,
        `変更後: ${normalized}`,
        '',
        '変更後は、新しいメールアドレスでのみログインできるようになります。',
        '入力内容に誤りがないか、もう一度ご確認ください。',
      ].join('\n'),
    );
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/users/${userId}/email`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newEmail: normalized, reason: reason.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        noticeSent?: boolean;
      };
      if (!res.ok) {
        setError(j.error?.message ?? '変更に失敗しました');
        return;
      }
      toast.success(
        j.noticeSent === false
          ? 'メールアドレスを変更しました（変更前アドレスへの通知は送信できませんでした）'
          : 'メールアドレスを変更しました',
      );
      setOpen(false);
      setNewEmail('');
      setConfirmEmail('');
      setReason('');
      router.refresh();
    } catch {
      setError('通信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  if (readOnly) {
    return (
      <p className="text-sm text-slate-500">
        メールアドレスの変更は SUPER_ADMIN のみ実行できます。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-700">{currentEmail}</span>
        </div>
        {!open && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            変更する
          </Button>
        )}
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        通常は会員ご本人にマイページから変更していただいてください。こちらは
        「旧アドレスが使えずログインできない」「確認コードが届かない」など、
        ご本人が手続きできない場合の代行用です。
      </p>

      {open && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-800">
              メールアドレスはログイン ID を兼ねています。誤ったアドレスに変更すると、
              ご本人がログインできなくなります。必ずお問い合わせ内容と照合してください。
            </p>
          </div>

          <Input
            label="新しいメールアドレス"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="new@example.com"
          />
          <Input
            label="新しいメールアドレス（確認のためもう一度）"
            type="email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder="new@example.com"
            error={
              normalizedConfirm.length > 0 && !emailsMatch
                ? 'メールアドレスが一致しません'
                : undefined
            }
          />
          <Input
            label="変更理由（監査ログに記録されます）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: お問い合わせ「登録のメールアドレス変えたい」対応のため"
          />

          {isSameAsCurrent && normalized.length > 0 && (
            <p className="text-sm text-rose-600">現在のメールアドレスと同じです</p>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleSubmit()}
              loading={submitting}
              disabled={!canSubmit}
            >
              メールアドレスを変更
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setNewEmail('');
                setConfirmEmail('');
                setReason('');
                setError(null);
              }}
              disabled={submitting}
            >
              キャンセル
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
