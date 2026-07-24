import type { Metadata } from 'next';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'パスワードを忘れた方' };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">パスワードを忘れた方</h1>
      <ForgotPasswordForm />
    </div>
  );
}
