'use client';

/**
 * 新規登録完了ページ。
 * 登録後に「アカウント作成完了 + 確認メール送信」を明示し、次の導線を示す。
 * クエリ: ?email=...&emailSent=1|0
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export function SignupCompleteClient() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const emailSent = params.get('emailSent') !== '0';

  return (
    <div className="space-y-6 text-center">
      <div className="text-5xl">🎉</div>
      <div>
        <h1 className="text-2xl font-bold text-slate-800">ご登録ありがとうございます</h1>
        <p className="mt-2 text-sm text-slate-600">アカウントの作成が完了しました。</p>
      </div>

      {emailSent ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 text-left">
          <p className="text-sm font-semibold text-brand-800">
            📩 確認メールを送信しました
          </p>
          <p className="mt-2 text-sm text-brand-700">
            {email ? (
              <>
                <span className="font-medium break-all">{email}</span> 宛に確認メールをお送りしました。
              </>
            ) : (
              'ご登録のメールアドレス宛に確認メールをお送りしました。'
            )}
            <br />
            メール内のボタンからメールアドレスの確認を完了してください。
          </p>
          <p className="mt-3 text-xs text-brand-600/80">
            ※ メールが届かない場合は、迷惑メールフォルダもご確認ください。数分待っても届かない場合は、ログイン後に再送できます。
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-left">
          <p className="text-sm font-semibold text-amber-800">
            ⚠️ 確認メールの送信に失敗しました
          </p>
          <p className="mt-2 text-sm text-amber-700">
            アカウントは作成されています。ログイン後、マイページから確認メールを再送できます。
          </p>
        </div>
      )}

      <div className="space-y-3">
        <Link href="/signin">
          <Button className="w-full" size="lg">
            ログインへ進む
          </Button>
        </Link>
        <Link href="/" className="block text-sm text-slate-500 hover:underline">
          トップページへ戻る
        </Link>
      </div>
    </div>
  );
}
