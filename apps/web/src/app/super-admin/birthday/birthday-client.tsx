'use client';

/**
 * 誕生日メール管理のクライアント UI。
 *
 *  - 年セレクタ + テンプレート編集フォーム (件名・本文・画像・有効フラグ)。
 *  - 対象者 (今日 or 任意月日が誕生日) の一覧と送信状況。
 *  - 個別送信 / 未送信者への一斉送信。
 *
 * すべての読み書きは /api/super-admin/birthday/* を叩いて行う。
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/ui-store';
import {
  DEFAULT_BIRTHDAY_MAIL_SUBJECT,
  DEFAULT_BIRTHDAY_MAIL_BODY,
  BIRTHDAY_MAIL_PLACEHOLDERS,
} from '@idol/shared';

type Today = { year: number; month: number; day: number };

type TemplateSummary = { year: number; enabled: boolean; hasImage: boolean };

type Template = {
  year: number;
  subject: string;
  body: string;
  imageUrl: string | null;
  enabled: boolean;
} | null;

type Recipient = {
  id: string;
  email: string;
  displayName: string | null;
  preferredName: string | null;
  fullName: string | null;
  birthDate: string;
  sent: boolean;
  sentAt: string | null;
  emailSent: boolean;
};

type RecipientsResponse = {
  today: Today;
  target: { month: number; day: number };
  recipients: Recipient[];
  summary: { total: number; sent: number; unsent: number };
};

function recipientName(r: Recipient): string {
  return r.preferredName?.trim() || r.displayName?.trim() || r.fullName?.trim() || '(名前未設定)';
}

export function BirthdayMailClient({
  years,
  defaultYear,
  today,
  templateSummaries,
}: {
  years: number[];
  defaultYear: number;
  today: Today;
  templateSummaries: TemplateSummary[];
}) {
  const [year, setYear] = useState(defaultYear);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 対象者一覧
  const [month, setMonth] = useState(today.month);
  const [day, setDay] = useState(today.day);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [summary, setSummary] = useState<RecipientsResponse['summary'] | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);

  // --- テンプレート読み込み ---------------------------------------------
  const loadTemplate = useCallback(async (y: number) => {
    setLoadingTpl(true);
    try {
      const res = await fetch(`/api/super-admin/birthday/template?year=${y}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      const t: Template = data.template;
      if (t) {
        setSubject(t.subject);
        setBody(t.body);
        setEnabled(t.enabled);
        setImageUrl(t.imageUrl);
      } else {
        // 未作成の年: 既定文面をたたき台として提示
        setSubject(DEFAULT_BIRTHDAY_MAIL_SUBJECT);
        setBody(DEFAULT_BIRTHDAY_MAIL_BODY);
        setEnabled(true);
        setImageUrl(null);
      }
    } catch {
      toast.error('テンプレートの読み込みに失敗しました');
    } finally {
      setLoadingTpl(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplate(year);
  }, [year, loadTemplate]);

  // --- テンプレート保存 -------------------------------------------------
  async function saveTemplate() {
    setSavingTpl(true);
    try {
      const res = await fetch('/api/super-admin/birthday/template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, subject, body, enabled }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error?.message ?? '保存に失敗しました');
      }
      toast.success(`${year}年のテンプレートを保存しました`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSavingTpl(false);
    }
  }

  // --- 画像アップロード -------------------------------------------------
  async function uploadImage(file: File) {
    setUploading(true);
    try {
      // 画像を差し込む前にテンプレを存在させる必要があるため、先に保存する。
      await fetch('/api/super-admin/birthday/template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, subject, body, enabled }),
      });
      const form = new FormData();
      form.set('year', String(year));
      form.set('file', file);
      const res = await fetch('/api/super-admin/birthday/template', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error?.message ?? 'アップロードに失敗しました');
      }
      const data = await res.json();
      setImageUrl(data.template?.imageUrl ?? null);
      toast.success('画像をアップロードしました');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'アップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  }

  async function removeImage() {
    if (!confirm('画像を削除しますか？')) return;
    try {
      const res = await fetch(`/api/super-admin/birthday/template?year=${year}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      setImageUrl(null);
      toast.success('画像を削除しました');
    } catch {
      toast.error('画像の削除に失敗しました');
    }
  }

  // --- 対象者一覧 -------------------------------------------------------
  const loadRecipients = useCallback(
    async (y: number, m: number, d: number) => {
      setLoadingRec(true);
      try {
        const res = await fetch(
          `/api/super-admin/birthday/recipients?year=${y}&month=${m}&day=${d}`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error();
        const data: RecipientsResponse = await res.json();
        setRecipients(data.recipients);
        setSummary(data.summary);
      } catch {
        toast.error('対象者の取得に失敗しました');
      } finally {
        setLoadingRec(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadRecipients(year, month, day);
  }, [year, month, day, loadRecipients]);

  // --- 送信 -------------------------------------------------------------
  async function sendOne(userId: string) {
    setSendingId(userId);
    try {
      const res = await fetch('/api/super-admin/birthday/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, userIds: [userId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? '送信に失敗しました');
      const r = data.result;
      if (r.sent > 0) toast.success('送信しました');
      else if (r.skipped > 0) toast.info('既に送信済みです');
      else if (r.failed > 0) toast.error(`送信に失敗しました: ${r.errors?.[0]?.message ?? ''}`);
      await loadRecipients(year, month, day);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setSendingId(null);
    }
  }

  async function sendBulk() {
    const unsent = recipients.filter((r) => !(r.sent && r.emailSent));
    if (unsent.length === 0) {
      toast.info('未送信の対象者がいません');
      return;
    }
    if (!confirm(`未送信の ${unsent.length} 名に誕生日メールを一斉送信します。よろしいですか？`)) {
      return;
    }
    setBulkSending(true);
    try {
      const res = await fetch('/api/super-admin/birthday/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }), // userIds 省略 = 今日の未送信全員
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? '送信に失敗しました');
      const r = data.result;
      toast.success(`一斉送信完了: 送信 ${r.sent} / スキップ ${r.skipped} / 失敗 ${r.failed}`);
      await loadRecipients(year, month, day);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setBulkSending(false);
    }
  }

  const isToday = month === today.month && day === today.day;

  return (
    <div className="space-y-6">
      {/* 年セレクタ */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-slate-700">対象年</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年版
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            年ごとに文面・画像を切り替えられます。
          </span>
          {templateSummaries.find((t) => t.year === year)?.enabled === false && (
            <Badge tone="warning">この年は無効</Badge>
          )}
        </CardBody>
      </Card>

      {/* テンプレート編集 */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">{year}年版 メール内容</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          {loadingTpl ? (
            <p className="text-sm text-slate-500">読み込み中…</p>
          ) : (
            <>
              <Input
                label="件名"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                hint="差し込み変数が使えます"
              />
              <Textarea
                label="本文"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
              />
              <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold">差し込み変数</p>
                <ul className="mt-1 space-y-0.5">
                  {BIRTHDAY_MAIL_PLACEHOLDERS.map((p) => (
                    <li key={p.token}>
                      <code className="rounded bg-white px-1 py-0.5 text-brand-700">{p.token}</code>
                      {' — '}
                      {p.description}
                    </li>
                  ))}
                </ul>
              </div>

              {/* 画像 */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700">ヘッダー画像 (任意)</p>
                {imageUrl ? (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl}
                      alt="誕生日メール画像"
                      className="max-h-56 w-auto rounded-lg border border-slate-200"
                    />
                    <div>
                      <Button variant="ghost" onClick={removeImage} type="button">
                        画像を削除
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">画像は未設定です。</p>
                )}
                <label className="inline-block">
                  <span className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                    {uploading ? 'アップロード中…' : imageUrl ? '画像を差し替える' : '画像をアップロード'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadImage(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                <p className="text-xs text-slate-400">
                  JPEG / PNG / WebP / GIF、8MB 以内。横長の画像がメール上部にきれいに表示されます。
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                この年のメールを有効にする（無効中は送信できません）
              </label>

              <div className="flex gap-2">
                <Button onClick={saveTemplate} loading={savingTpl} type="button">
                  内容を保存
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* 対象者一覧 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {isToday ? '本日が誕生日の会員' : `${month}月${day}日 が誕生日の会員`}
            </h2>
            <div className="flex items-center gap-2 text-sm">
              <label className="text-slate-600">確認日</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-2 py-1"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
              <select
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-2 py-1"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}日</option>
                ))}
              </select>
              {!isToday && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setMonth(today.month);
                    setDay(today.day);
                  }}
                >
                  今日に戻す
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {summary && (
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge tone="gray">対象 {summary.total} 名</Badge>
              <Badge tone="success">送信済み {summary.sent} 名</Badge>
              <Badge tone="warning">未送信 {summary.unsent} 名</Badge>
            </div>
          )}

          <div>
            <Button
              onClick={sendBulk}
              loading={bulkSending}
              disabled={!summary || summary.unsent === 0}
              type="button"
            >
              未送信の {summary?.unsent ?? 0} 名に一斉送信
            </Button>
          </div>

          {loadingRec ? (
            <p className="text-sm text-slate-500">読み込み中…</p>
          ) : recipients.length === 0 ? (
            <p className="text-sm text-slate-500">対象の会員はいません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="py-2 pr-3">会員</th>
                    <th className="py-2 pr-3">メール</th>
                    <th className="py-2 pr-3">状況</th>
                    <th className="py-2 pr-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r) => {
                    const done = r.sent && r.emailSent;
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium text-slate-800">
                          {recipientName(r)}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{r.email}</td>
                        <td className="py-2 pr-3">
                          {done ? (
                            <Badge tone="success">送信済み</Badge>
                          ) : r.sent && !r.emailSent ? (
                            <Badge tone="danger">送信失敗</Badge>
                          ) : (
                            <Badge tone="warning">未送信</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Button
                            variant={done ? 'ghost' : 'primary'}
                            type="button"
                            loading={sendingId === r.id}
                            onClick={() => sendOne(r.id)}
                          >
                            {done ? '再送' : '送信'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
