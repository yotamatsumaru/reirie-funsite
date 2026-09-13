'use client';

/**
 * notify-panel — 会報誌の «住所記入のお願い» と «発送連絡» を送るパネル
 *
 * 【誤送信を防ぐための作り】
 * 相手は実在の会員全員なので、押し間違いが即事故になる。そのため
 *   - 送信前に確認ダイアログを出す (対象人数を明示する)
 *   - 「号のキー」を必須にする。これが二重送信防止の単位になる
 *   - 送信後の結果 (成功/失敗/スキップ) をその場に表示する
 *   - 送信中はボタンを無効化して二度押しを防ぐ
 * とした。加えてサーバー側でも DB の UNIQUE 制約で二重送信を防いでいる
 * (画面の対策だけに頼らない)。
 */

import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/stores/ui-store';

type Kind = 'ADDRESS_REMINDER' | 'SHIPPING_NOTICE';

type SendResult = {
  attempted: number;
  sent: number;
  failed: number;
  skippedAlreadySent: number;
  skippedNotTarget: number;
  errors: { email: string; message: string }[];
};

export function NotifyPanel({
  needsInfoCount,
  shippableCount,
}: {
  needsInfoCount: number;
  shippableCount: number;
}) {
  const [issueKey, setIssueKey] = useState('');
  const [issueLabel, setIssueLabel] = useState('');
  const [deadlineLabel, setDeadlineLabel] = useState('');
  const [shippedOnLabel, setShippedOnLabel] = useState('');
  const [arrivalLabel, setArrivalLabel] = useState('3〜5日程度');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState<Kind | null>(null);
  const [result, setResult] = useState<{ kind: Kind; data: SendResult } | null>(null);

  const send = async (kind: Kind) => {
    if (!issueKey.trim() || !issueLabel.trim()) {
      toast.error('号のキーと号の表示名を入力してください');
      return;
    }

    const count = kind === 'ADDRESS_REMINDER' ? needsInfoCount : shippableCount;
    const what =
      kind === 'ADDRESS_REMINDER'
        ? `住所が未入力の会員 ${count} 名に「ご登録のお願い」`
        : `発送可能な会員 ${count} 名に「発送のお知らせ」`;

    // 取り消せない操作なので必ず確認する
    if (
      !window.confirm(
        `${what}メールを送信します。\n\n号: ${issueLabel}（キー: ${issueKey}）\n\n` +
          'この操作は取り消せません。よろしいですか？',
      )
    ) {
      return;
    }

    setLoading(kind);
    setResult(null);
    try {
      const res = await fetch('/api/super-admin/newsletter/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          issueKey: issueKey.trim(),
          issueLabel: issueLabel.trim(),
          ...(kind === 'ADDRESS_REMINDER'
            ? { deadlineLabel: deadlineLabel.trim() || undefined }
            : {
                shippedOnLabel: shippedOnLabel.trim() || undefined,
                arrivalLabel: arrivalLabel.trim() || undefined,
                note: note.trim() || undefined,
              }),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '送信に失敗しました');
      }
      setResult({ kind, data: json as SendResult });
      toast.success(`${json.sent} 件送信しました`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-700">会報誌のメール連絡</h2>
      </CardHeader>
      <CardBody className="space-y-5">
        {/* --- 号の指定 (共通) --- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="号のキー（半角英数）"
            placeholder="2026-spring"
            value={issueKey}
            onChange={(e) => setIssueKey(e.target.value)}
            hint="二重送信防止に使う識別子です。号ごとに変えてください"
          />
          <Input
            label="号の表示名（会員に見えます）"
            placeholder="2026年 春号"
            value={issueLabel}
            onChange={(e) => setIssueLabel(e.target.value)}
          />
        </div>

        <div className="h-px bg-slate-100" />

        {/* --- ① 住所記入のお願い --- */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              ① 住所のご登録をお願いする
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              住所が未入力の会員（
              <span className={needsInfoCount > 0 ? 'font-semibold text-amber-600' : ''}>
                {needsInfoCount} 名
              </span>
              ）に、足りない項目を明記したメールを送ります。
              住所が揃っている会員には送りません。
            </p>
          </div>
          <div className="sm:max-w-xs">
            <Input
              label="登録期限の表示（任意）"
              placeholder="3月5日"
              value={deadlineLabel}
              onChange={(e) => setDeadlineLabel(e.target.value)}
              hint="「〜までにご登録ください」と本文に入ります"
            />
          </div>
          <Button
            onClick={() => void send('ADDRESS_REMINDER')}
            loading={loading === 'ADDRESS_REMINDER'}
            disabled={loading !== null || needsInfoCount === 0}
            variant="secondary"
          >
            {needsInfoCount === 0
              ? '対象なし（全員の住所が揃っています）'
              : `${needsInfoCount} 名にご登録のお願いを送る`}
          </Button>
        </div>

        <div className="h-px bg-slate-100" />

        {/* --- ② 発送連絡 --- */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">② 発送したことを知らせる</h3>
            <p className="mt-1 text-xs text-slate-500">
              発送可能な会員（
              <span className="font-semibold text-emerald-600">{shippableCount} 名</span>
              ）に発送完了のお知らせを送ります。
              住所が未入力で発送できなかった会員には送りません。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="発送日の表示（任意）"
              placeholder="未入力なら今日の日付"
              value={shippedOnLabel}
              onChange={(e) => setShippedOnLabel(e.target.value)}
            />
            <Input
              label="到着目安（任意）"
              placeholder="3〜5日程度"
              value={arrivalLabel}
              onChange={(e) => setArrivalLabel(e.target.value)}
              hint="書いておくと「届かない」問い合わせが減ります"
            />
          </div>
          <Input
            label="ひとこと添える（任意）"
            placeholder="今号は特別付録つきです。"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            onClick={() => void send('SHIPPING_NOTICE')}
            loading={loading === 'SHIPPING_NOTICE'}
            disabled={loading !== null || shippableCount === 0}
          >
            {shippableCount === 0
              ? '対象なし'
              : `${shippableCount} 名に発送のお知らせを送る`}
          </Button>
        </div>

        {/* --- 送信結果 --- */}
        {result && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-slate-800">
              {result.kind === 'ADDRESS_REMINDER'
                ? 'ご登録のお願い'
                : '発送のお知らせ'}
              の送信結果
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              <li>
                送信成功: <span className="font-semibold text-emerald-600">{result.data.sent}</span> 件
              </li>
              {result.data.failed > 0 && (
                <li>
                  送信失敗: <span className="font-semibold text-rose-600">{result.data.failed}</span> 件
                </li>
              )}
              {result.data.skippedAlreadySent > 0 && (
                <li>
                  この号で既に送信済みのためスキップ: {result.data.skippedAlreadySent} 件
                </li>
              )}
              {result.data.skippedNotTarget > 0 && (
                <li>対象外のためスキップ: {result.data.skippedNotTarget} 件</li>
              )}
            </ul>
            {result.data.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-rose-700">失敗した宛先</p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-rose-600">
                  {result.data.errors.map((e) => (
                    <li key={e.email}>
                      {e.email}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          ※ 同じ「号のキー」で二度送信しても、会員に届くのは 1 通だけです
          （サーバー側で重複を防いでいます）。
        </p>
      </CardBody>
    </Card>
  );
}
