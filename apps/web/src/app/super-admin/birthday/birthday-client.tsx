'use client';

/**
 * 誕生日メール管理のクライアント UI。
 *
 *  - 年セレクタ + テンプレート編集フォーム (件名・本文・画像・有効フラグ)。
 *  - 対象者 (今日 or 任意月日が誕生日) の一覧と送信状況。
 *  - 個別送信 / 未送信者への一斉送信。
 *  - 強制送信 (ForcedSendPanel) … 誕生日を過ぎた方・対象外の方への救済送信。
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
  BIRTHDAY_MAIL_MINUTE_STEP,
  DEFAULT_BIRTHDAY_MAIL_SCHEDULE,
  formatBirthdayMailTime,
  isBirthdayMailScheduleDue,
  type BirthdayMailSchedule,
  type BirthdayMailRunState,
} from '@idol/shared';
import { Clock, CheckCircle2, CircleSlash, AlertTriangle } from 'lucide-react';
import { ForcedSendPanel } from './forced-send-panel';

type Today = { year: number; month: number; day: number };

/** 自動送信の最終実行 status を日本語に。API の AutoSendStatus と対応。 */
const AUTO_SEND_STATUS_LABEL: Record<string, string> = {
  sent: '送信しました',
  'no-recipients': '対象者なし',
  disabled: '自動送信が無効',
  'not-due': '送信時刻前',
  'already-ran': '本日ぶんは実行済み',
  'no-template': 'テンプレート未設定',
  'template-disabled': 'テンプレートが無効',
  running: '実行中',
  error: 'エラー',
};

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

  // テスト送信
  const [testTo, setTestTo] = useState('');
  const [testName, setTestName] = useState('');
  const [testSending, setTestSending] = useState(false);

  // 対象者一覧
  const [month, setMonth] = useState(today.month);
  const [day, setDay] = useState(today.day);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [summary, setSummary] = useState<RecipientsResponse['summary'] | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);

  // 自動送信スケジュール
  const [schedule, setSchedule] = useState<BirthdayMailSchedule>({
    ...DEFAULT_BIRTHDAY_MAIL_SCHEDULE,
  });
  const [runState, setRunState] = useState<BirthdayMailRunState | null>(null);
  const [serverNow, setServerNow] = useState<{ hour: number; minute: number } | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

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

  // --- テスト送信 -------------------------------------------------------
  async function sendTest() {
    const to = testTo.trim();
    if (!to) {
      toast.warning('送信先のメールアドレスを入力してください');
      return;
    }
    setTestSending(true);
    try {
      const res = await fetch('/api/super-admin/birthday/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, to, name: testName.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'テスト送信に失敗しました');
      }
      toast.success(`${to} にテストメールを送信しました`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'テスト送信に失敗しました');
    } finally {
      setTestSending(false);
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

  // --- 自動送信スケジュール ---------------------------------------------
  const loadSchedule = useCallback(async () => {
    setLoadingSchedule(true);
    try {
      const res = await fetch('/api/super-admin/birthday/schedule', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSchedule(data.schedule);
      setRunState(data.runState ?? null);
      setServerNow(data.now ?? null);
    } catch {
      toast.error('自動送信設定の読み込みに失敗しました');
    } finally {
      setLoadingSchedule(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  /**
   * スケジュールを部分更新する。
   * トグルや時刻セレクタは「変更した瞬間に保存」する (保存ボタンの押し忘れで
   * 設定したつもりが反映されていない、という事故を防ぐ)。
   */
  const patchSchedule = useCallback(
    async (patch: Partial<BirthdayMailSchedule>) => {
      // 楽観更新: 失敗したらサーバー値で戻す。
      const prev = schedule;
      setSchedule({ ...prev, ...patch });
      setSavingSchedule(true);
      try {
        const res = await fetch('/api/super-admin/birthday/schedule', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error?.message ?? '保存に失敗しました');
        setSchedule(data.schedule);
        if (patch.enabled !== undefined) {
          toast.success(patch.enabled ? '自動送信を有効にしました' : '自動送信を無効にしました');
        } else {
          toast.success(`送信時刻を ${formatBirthdayMailTime(data.schedule)} に設定しました`);
        }
      } catch (e) {
        setSchedule(prev);
        toast.error(e instanceof Error ? e.message : '保存に失敗しました');
      } finally {
        setSavingSchedule(false);
      }
    },
    [schedule],
  );

  /** 時刻ゲートと「本日実行済み」判定を無視して、いま自動送信を走らせる。 */
  async function runAutoSendNow() {
    if (
      !confirm(
        '本日が誕生日で未送信の会員へ、いま自動送信と同じ処理を実行します。\n（送信済みの会員には送られません）よろしいですか？',
      )
    ) {
      return;
    }
    setRunningNow(true);
    try {
      const res = await fetch('/api/cron/birthday-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? '実行に失敗しました');
      if (data.status === 'sent') {
        toast.success(data.message ?? '自動送信を実行しました');
      } else {
        toast.info(data.message ?? '送信対象はありませんでした');
      }
      await Promise.all([loadSchedule(), loadRecipients(year, month, day)]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '実行に失敗しました');
    } finally {
      setRunningNow(false);
    }
  }

  const isToday = month === today.month && day === today.day;

  // 「本日ぶんはもう走ったか」— runState.lastRunDate と JST 今日を比較。
  const todayKey = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  const ranToday = runState?.lastRunDate === todayKey;
  // サーバーの JST 時刻で「送信時刻を過ぎたか」を判定 (端末時計に依存させない)。
  const isDue = serverNow ? isBirthdayMailScheduleDue(schedule, serverNow) : false;

  return (
    <div className="space-y-6">
      {/* 自動送信スケジュール */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-brand-600" aria-hidden />
            <h2 className="text-lg font-semibold">自動送信</h2>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {loadingSchedule ? (
            <p className="text-sm text-slate-500">読み込み中…</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                毎日、設定した時刻に「本日が誕生日の会員」へ自動でメールを送ります。
                その年のテンプレートが有効になっている必要があります。
              </p>

              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  disabled={savingSchedule}
                  onChange={(e) => void patchSchedule({ enabled: e.target.checked })}
                />
                自動送信を有効にする
              </label>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label
                    htmlFor="birthday-schedule-hour"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    送信時刻 (日本時間)
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      id="birthday-schedule-hour"
                      value={schedule.hour}
                      disabled={savingSchedule || !schedule.enabled}
                      onChange={(e) => void patchSchedule({ hour: Number(e.target.value) })}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm text-slate-600">時</span>
                    <select
                      value={schedule.minute}
                      disabled={savingSchedule || !schedule.enabled}
                      onChange={(e) => void patchSchedule({ minute: Number(e.target.value) })}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                      aria-label="送信時刻 (分)"
                    >
                      {Array.from(
                        { length: Math.ceil(60 / BIRTHDAY_MAIL_MINUTE_STEP) },
                        (_, i) => i * BIRTHDAY_MAIL_MINUTE_STEP,
                      ).map((m) => (
                        <option key={m} value={m}>
                          {String(m).padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm text-slate-600">分</span>
                  </div>
                </div>
                {schedule.enabled && (
                  <Badge tone="success">
                    毎日 {formatBirthdayMailTime(schedule)} に送信
                  </Badge>
                )}
                {!schedule.enabled && <Badge tone="gray">自動送信は停止中</Badge>}
              </div>

              <p className="text-xs text-slate-500">
                変更は選んだ時点で保存されます。時刻は数分ずれる場合があります
                （システムが数分おきに確認し、設定時刻を過ぎた最初の確認で送信します）。
              </p>

              {/* 本日の状況 */}
              <div className="rounded-md bg-slate-50 p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-700">
                  {ranToday ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                      本日ぶんは実行済みです
                    </>
                  ) : !schedule.enabled ? (
                    <>
                      <CircleSlash className="h-4 w-4 text-slate-400" aria-hidden />
                      自動送信が無効のため、本日は実行されません
                    </>
                  ) : isDue ? (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                      送信時刻を過ぎています（次の確認で送信されます）
                    </>
                  ) : (
                    <>
                      <Clock className="h-4 w-4 text-slate-400" aria-hidden />
                      本日 {formatBirthdayMailTime(schedule)} に送信予定です
                    </>
                  )}
                </p>
                {serverNow && (
                  <p className="mt-1 text-xs text-slate-500">
                    サーバー現在時刻 (日本時間): {formatBirthdayMailTime(serverNow)}
                  </p>
                )}
                {runState?.lastRunAt && (
                  <p className="mt-1 text-xs text-slate-500">
                    最終実行: {new Date(runState.lastRunAt).toLocaleString('ja-JP')}
                    {runState.lastStatus && (
                      <>
                        {' / '}
                        {AUTO_SEND_STATUS_LABEL[runState.lastStatus] ?? runState.lastStatus}
                      </>
                    )}
                    {runState.lastSent !== null && <> / 送信 {runState.lastSent} 件</>}
                    {runState.lastFailed ? <> / 失敗 {runState.lastFailed} 件</> : null}
                  </p>
                )}
                {!runState?.lastRunAt && (
                  <p className="mt-1 text-xs text-slate-500">まだ一度も自動送信は実行されていません。</p>
                )}
              </div>

              <div>
                <Button
                  variant="secondary"
                  type="button"
                  loading={runningNow}
                  onClick={runAutoSendNow}
                >
                  いま自動送信を実行（動作確認）
                </Button>
                <p className="mt-1 text-xs text-slate-400">
                  時刻設定や「本日実行済み」に関係なく、本日が誕生日の未送信会員へ送信します。
                </p>
              </div>
            </>
          )}
        </CardBody>
      </Card>

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

      {/* テスト送信 */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">テスト送信</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            {year}年版の内容を、任意のメールアドレスへ1通だけ送って見た目を確認できます。
            <br />
            テスト送信は配信記録に残らず、会員のマイページにも表示されません。件名の先頭に
            <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-brand-700">[テスト]</code>
            が付きます。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="送信先メールアドレス"
              type="email"
              placeholder="test@example.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Input
              label="差し込み名 (任意)"
              placeholder="例: 理江"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              hint="本文の {name} に入る名前。未入力なら「テスト」になります。"
            />
          </div>
          <div>
            <Button
              variant="secondary"
              type="button"
              loading={testSending}
              onClick={sendTest}
            >
              このアドレスにテスト送信
            </Button>
          </div>
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

          <p className="text-xs text-slate-400">
            対象は有料会員（スタンダード / プレミアム）のみです。無料会員は表示されません。
          </p>

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

      {/*
        強制送信パネル。
        通常の対象者一覧 (上) では「本日が誕生日 かつ 有料会員」しか出てこないため、
        送信漏れに後から気づいた場合や、対象外の会員へ特例で送りたい場合の受け皿。
        誤操作を避けるため、通常の導線より下に置いている。
      */}
      <ForcedSendPanel year={year} onSent={() => void loadRecipients(year, month, day)} />
    </div>
  );
}
