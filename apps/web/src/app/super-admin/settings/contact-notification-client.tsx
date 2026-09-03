'use client';

/**
 * お問い合わせ通知設定 UI (SUPER_ADMIN)。
 *
 * 【なぜこの画面が必要か】
 * 過去に新規問い合わせが 2 週間気づかれず放置された。原因は
 * 「問い合わせが届いても運営に通知が飛ばない」ことで、管理画面を
 * 自発的に開かないと気づけなかった。ここで通知先を登録しておけば、
 * 問い合わせが届いた時点でメールが飛ぶ。
 *
 * また、会員様からのご要望 (送信内容の控えが欲しい) に対応する
 * 「控えメール」のオン/オフもここで管理する。
 *
 * GET/PATCH /api/super-admin/contact-notification で永続化
 * (AppSetting: contact.notification)。切り替えは即時反映 (再デプロイ不要)。
 */
import { useState } from 'react';
import {
  CONTACT_ADMIN_EMAIL_MAX,
  parseAdminEmailsText,
  stringifyAdminEmails,
  type ContactNotificationSettings,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { toast } from '@/stores/ui-store';

type Props = {
  initialSettings: ContactNotificationSettings;
};

export function ContactNotificationClient({ initialSettings }: Props) {
  const [settings, setSettings] = useState<ContactNotificationSettings>(initialSettings);
  const [emailsText, setEmailsText] = useState(stringifyAdminEmails(initialSettings.adminEmails));
  const [saving, setSaving] = useState<'ack' | 'notify' | 'emails' | null>(null);

  async function patch(
    body: Partial<ContactNotificationSettings>,
    kind: 'ack' | 'notify' | 'emails',
    successMessage: string,
  ) {
    if (saving !== null) return;
    setSaving(kind);
    try {
      const res = await fetch('/api/super-admin/contact-notification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? '保存に失敗しました');
      const next = json.settings as ContactNotificationSettings;
      setSettings(next);
      // サーバ側で正規化 (小文字化・重複除去) された結果を画面に反映する。
      setEmailsText(stringifyAdminEmails(next.adminEmails));
      toast.success(successMessage);
    } catch (e) {
      toast.error((e as Error).message, '保存エラー');
    } finally {
      setSaving(null);
    }
  }

  const parsedEmails = parseAdminEmailsText(emailsText);
  const emailsDirty = stringifyAdminEmails(parsedEmails) !== stringifyAdminEmails(settings.adminEmails);
  const tooMany = parsedEmails.length > CONTACT_ADMIN_EMAIL_MAX;
  // 「通知は ON なのに宛先が空」= 通知が飛ばない状態。最も気づきにくい設定ミスなので警告する。
  const notifyMisconfigured = settings.adminNotifyEnabled && settings.adminEmails.length === 0;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">お問い合わせ通知</h2>
            <p className="mt-1 text-xs text-slate-500">
              お問い合わせフォーム（<span className="font-mono">/contact</span>
              ）からの送信時に、送信者へ「送信内容の控え」を、運営へ「新規受信通知」を
              メールで送ります。切り替えは即時反映されます（再デプロイ不要）。
            </p>
          </div>
          {notifyMisconfigured && (
            <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              宛先未設定
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* 控えメール (会員向け) */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">送信者への控えメール</p>
            <p className="mt-0.5 text-xs text-slate-500">
              お問い合わせの送信直後に、受付番号と送信内容の控えを送信者本人へお送りします。
              「送ったのに届いているか分からない」というお問い合わせを減らせます。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={`text-xs font-semibold ${
                settings.ackMailEnabled ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {saving === 'ack' ? '切り替え中…' : settings.ackMailEnabled ? '送信する' : '送信しない'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.ackMailEnabled}
              aria-label="送信者への控えメール"
              onClick={() =>
                patch(
                  { ackMailEnabled: !settings.ackMailEnabled },
                  'ack',
                  `控えメールを${!settings.ackMailEnabled ? '送信する' : '送信しない'}設定にしました`,
                )
              }
              disabled={saving !== null}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                settings.ackMailEnabled ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.ackMailEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 運営通知 */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">運営への新規受信通知</p>
            <p className="mt-0.5 text-xs text-slate-500">
              新しいお問い合わせが届いたときに、下の宛先へ通知メールを送ります。
              管理画面を開かなくても気づけるようになります。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={`text-xs font-semibold ${
                settings.adminNotifyEnabled ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {saving === 'notify'
                ? '切り替え中…'
                : settings.adminNotifyEnabled
                  ? '通知する'
                  : '通知しない'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.adminNotifyEnabled}
              aria-label="運営への新規受信通知"
              onClick={() =>
                patch(
                  { adminNotifyEnabled: !settings.adminNotifyEnabled },
                  'notify',
                  `運営通知を${!settings.adminNotifyEnabled ? '通知する' : '通知しない'}設定にしました`,
                )
              }
              disabled={saving !== null}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                settings.adminNotifyEnabled ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.adminNotifyEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 通知先アドレス */}
        <div className="rounded-lg border border-slate-100 px-4 py-3">
          <Textarea
            label="運営通知の宛先"
            rows={4}
            value={emailsText}
            onChange={(e) => setEmailsText(e.target.value)}
            placeholder={'staff@example.com\ninfo@example.com'}
            hint={`1行に1件、または カンマ区切りで入力してください（最大 ${CONTACT_ADMIN_EMAIL_MAX} 件）。現在 ${parsedEmails.length} 件。空にすると通知は送られません。`}
            error={tooMany ? `宛先は ${CONTACT_ADMIN_EMAIL_MAX} 件までです` : undefined}
          />
          {notifyMisconfigured && (
            <p className="mt-2 text-xs font-semibold text-amber-700">
              通知は「通知する」になっていますが宛先が未設定のため、実際には通知が送られません。
            </p>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            {emailsDirty && (
              <button
                type="button"
                onClick={() => setEmailsText(stringifyAdminEmails(settings.adminEmails))}
                className="text-xs text-slate-500 underline hover:text-slate-700"
              >
                変更を取り消す
              </button>
            )}
            <Button
              size="sm"
              loading={saving === 'emails'}
              disabled={!emailsDirty || tooMany || saving !== null}
              onClick={() =>
                patch({ adminEmails: parsedEmails }, 'emails', '運営通知の宛先を保存しました')
              }
            >
              宛先を保存
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
