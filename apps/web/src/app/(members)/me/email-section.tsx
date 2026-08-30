'use client';

/**
 * マイページ内の「登録メールアドレス」セクション。
 *
 * 【2段階にしている理由】
 * メールアドレスはログイン ID 兼パスワードリセットの送信先のため、
 * 打ち間違えたまま確定させると本人がログインできなくなり、
 * リセットメールも届かないので自力では復旧できなくなる。
 * そこで「新しいアドレス宛に届いた確認コードを入力できたら確定」という
 * 流れにして、受信できることを必ず確かめてから切り替える。
 *
 * 画面の状態:
 *   idle    … 現在のアドレスを表示。「変更する」で form へ
 *   form    … 新アドレス + 現在のパスワードを入力して申請
 *   verify  … 新アドレスに届いた6桁コードを入力して確定
 */
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/stores/ui-store';

type Mode = 'idle' | 'form' | 'verify';

export function EmailSection({
  currentEmail,
  initialPendingEmail,
}: {
  currentEmail: string;
  /** サーバ側で「手続き中」と判定された新アドレス (期限切れなら null)。 */
  initialPendingEmail: string | null;
}) {
  const [email, setEmail] = useState(currentEmail);
  // 手続き途中でページを開き直しても続きから再開できるよう、初期状態を引き継ぐ。
  const [mode, setMode] = useState<Mode>(initialPendingEmail ? 'verify' : 'idle');
  const [pendingEmail, setPendingEmail] = useState<string | null>(initialPendingEmail);

  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function resetForm() {
    setNewEmail('');
    setPassword('');
    setCode('');
    setError(null);
  }

  async function handleRequest() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/me/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newEmail: newEmail.trim(), password }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        pendingEmail?: string;
      };
      if (!res.ok) {
        setError(j.error?.message ?? '変更の申請に失敗しました');
        return;
      }
      setPendingEmail(j.pendingEmail ?? newEmail.trim());
      setPassword('');
      setCode('');
      setMode('verify');
      toast.success('新しいメールアドレス宛に確認コードを送信しました');
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/me/email/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        email?: string;
      };
      if (!res.ok) {
        setError(j.error?.message ?? '確認に失敗しました');
        return;
      }
      setEmail(j.email ?? pendingEmail ?? email);
      setPendingEmail(null);
      setMode('idle');
      resetForm();
      // メールアドレスはログイン ID そのもの。変更後は新しいアドレスで
      // 入り直してもらう必要があるため、完了画面を出して案内する。
      setDone(true);
      toast.success('メールアドレスを変更しました');
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch('/api/me/email', { method: 'DELETE' });
      setPendingEmail(null);
      setMode('idle');
      resetForm();
      toast.success('変更手続きを取り消しました');
    } catch {
      setError('取り消しに失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  // --- 変更完了後の案内 ---
  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-emerald-900">
              メールアドレスを変更しました
            </p>
            <p className="text-sm leading-relaxed text-emerald-800">
              新しいメールアドレスは <span className="font-medium">{email}</span> です。
              <br />
              次回からは、こちらのメールアドレスでログインしてください。
            </p>
            <p className="text-xs text-emerald-700">
              念のため、変更前のメールアドレス宛にも変更完了のお知らせをお送りしました。
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void signOut({ callbackUrl: '/signin' })}
            >
              ログインし直す
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-700">{email}</span>
        </div>
        {mode === 'idle' && (
          <Button variant="secondary" size="sm" onClick={() => setMode('form')}>
            変更する
          </Button>
        )}
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        メールアドレスはログイン ID としても使用します。変更すると、次回からは新しい
        メールアドレスでログインしていただきます。
      </p>

      {/* --- 申請フォーム --- */}
      {mode === 'form' && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <Input
            label="新しいメールアドレス"
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="new@example.com"
            hint="このアドレス宛に確認コードをお送りします"
          />
          <Input
            label="現在のパスワード"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="ご本人確認のために入力をお願いしています"
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void handleRequest()}
              loading={submitting}
              disabled={newEmail.trim().length === 0 || password.length === 0}
            >
              確認コードを送信
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMode('idle');
                resetForm();
              }}
              disabled={submitting}
            >
              キャンセル
            </Button>
          </div>
        </div>
      )}

      {/* --- コード入力 --- */}
      {mode === 'verify' && (
        <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 p-4">
          <p className="text-sm text-slate-700">
            <span className="font-medium">{pendingEmail}</span> 宛に確認コードをお送りしました。
            <br />
            メールに記載された6桁の数字を入力してください。
          </p>
          <p className="text-xs text-slate-500">
            コードを入力するまで、登録メールアドレスは変更されません。
            メールが届かない場合は、迷惑メールフォルダもご確認ください。
          </p>
          <Input
            label="確認コード（6桁）"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="123456"
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void handleVerify()}
              loading={submitting}
              disabled={code.trim().length !== 6}
            >
              変更を確定する
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMode('form');
                setCode('');
                setError(null);
              }}
              disabled={submitting}
            >
              アドレスを入力し直す
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleCancel()}
              disabled={submitting}
            >
              手続きをやめる
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
