/**
 * /super-admin/birthday — 誕生日メール管理 (SUPER_ADMIN 限定)
 *
 * 機能:
 *  - 年ごと (2026 版など) のメールテンプレート編集 (件名・本文・画像)。
 *  - 「今日が誕生日」の会員一覧と、その年の送信状況の表示。
 *  - 任意の月日を指定してのプレビュー確認。
 *  - 個別送信 / 未送信者への一斉送信。
 *
 * 実際の対話処理 (テンプレ保存・送信・対象者取得) はクライアントコンポーネント
 * (BirthdayMailClient) が API を叩いて行う。初期の年一覧のみサーバーで用意する。
 */
import type { Metadata } from 'next';
import { listBirthdayTemplates, jstToday } from '@/lib/birthday-mail';
import { BirthdayMailClient } from './birthday-client';

export const metadata: Metadata = { title: '誕生日メール | Super Admin' };
export const dynamic = 'force-dynamic';

export default async function BirthdayMailPage() {
  const templates = await listBirthdayTemplates();
  const today = jstToday();

  // 年セレクタの選択肢: 既存テンプレートの年 + 今年・来年 を重複なくまとめる。
  const yearSet = new Set<number>(templates.map((t) => t.year));
  yearSet.add(today.year);
  yearSet.add(today.year + 1);
  const years = [...yearSet].sort((a, b) => b - a);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">誕生日メール</h1>
        <p className="mt-1 text-sm text-slate-500">
          年ごとにお祝いメールを設定すると、毎日決まった時刻（既定は 12:00）に
          今日が誕生日の会員へ自動で送信されます。手動送信や未送信の確認もできます。
        </p>
        <p className="mt-1 text-xs text-amber-600">
          ※ 誕生日メールは有料会員（スタンダード / プレミアム）限定の特典です。無料会員は対象一覧に表示されません。
        </p>
      </header>

      <BirthdayMailClient
        years={years}
        defaultYear={today.year}
        today={today}
        templateSummaries={templates.map((t) => ({
          year: t.year,
          enabled: t.enabled,
          hasImage: Boolean(t.imageUrl),
        }))}
      />
    </div>
  );
}
