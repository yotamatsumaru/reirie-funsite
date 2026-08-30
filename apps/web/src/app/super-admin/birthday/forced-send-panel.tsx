'use client';

/**
 * 誕生日メールの「強制送信」パネル (運営の救済操作)。
 *
 * 【なぜ必要か】
 * 通常の対象者一覧は「本日が誕生日 かつ 有料会員」しか出てこない。
 * そのため以下のケースで運営が手を出せなくなる:
 *   - 送信漏れに翌日以降に気づいた (誕生日を過ぎると一覧から消える)
 *   - 障害・テンプレート未作成で当日に届かなかった
 *   - 特例で無料会員にも送りたい
 * このパネルは会員を検索して、条件を無視して直接送信できるようにする。
 *
 * 【誤爆させないための設計】
 *  - 検索語が空のときは何も出さない (全会員が並ぶと事故のもと)
 *  - 対象は明示的にチェックして選ぶ (一括送信ボタンは置かない)
 *  - なぜ自動送信の対象外なのかを理由バッジで見せる
 *  - 送信済みの相手には「再送になる」と警告する
 *  - 実行前に確認ダイアログで宛先を読み上げる
 */
import { useCallback, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/ui-store';
import {
  BIRTHDAY_MAIL_FORCED_SEND_MAX,
  describeBirthdayMailIneligibleReason,
  type BirthdayMailIneligibleReason,
} from '@idol/shared';
import { Search, AlertTriangle, Send } from 'lucide-react';

type Candidate = {
  id: string;
  email: string;
  memberNumber: string | null;
  displayName: string | null;
  preferredName: string | null;
  fullName: string | null;
  birthDate: string | null;
  paidPlan: boolean;
  sent: boolean;
  sentAt: string | null;
  emailSent: boolean;
  ineligibleReasons: BirthdayMailIneligibleReason[];
};

function candidateName(c: Candidate): string {
  return c.preferredName?.trim() || c.displayName?.trim() || c.fullName?.trim() || '(名前未設定)';
}

/** 'YYYY-MM-DD' から「M月D日」を作る (誕生日の表示用)。 */
function formatBirthday(iso: string | null): string {
  if (!iso) return '誕生日未登録';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '誕生日未登録';
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export function ForcedSendPanel({
  year,
  onSent,
}: {
  year: number;
  /** 送信後に対象者一覧を再読み込みさせる。 */
  onSent?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      toast.warning('メールアドレス・会員番号・お名前のいずれかを入力してください');
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/super-admin/birthday/candidates?year=${year}&q=${encodeURIComponent(q)}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? '検索に失敗しました');
      setCandidates(data.candidates ?? []);
      setSelected(new Set());
      setSearched(true);
      if ((data.candidates ?? []).length === 0) {
        toast.info('該当する会員が見つかりませんでした');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '検索に失敗しました');
    } finally {
      setSearching(false);
    }
  }, [query, year]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function forceSend() {
    const ids = [...selected];
    if (ids.length === 0) {
      toast.warning('送信する会員を選択してください');
      return;
    }
    if (ids.length > BIRTHDAY_MAIL_FORCED_SEND_MAX) {
      toast.error(`一度に送信できるのは ${BIRTHDAY_MAIL_FORCED_SEND_MAX} 名までです`);
      return;
    }

    // 宛先を読み上げてから確認する。条件を無視して送る操作なので、
    // 「誰に送るのか」を必ず目視させる。
    const targets = candidates.filter((c) => selected.has(c.id));
    const resendCount = targets.filter((c) => c.emailSent).length;
    const lines = targets.map((c) => `・${candidateName(c)} (${c.email})`).join('\n');
    const warn =
      resendCount > 0
        ? `\n\n※ うち ${resendCount} 名は送信済みのため、再送 (2 通目) になります。`
        : '';
    if (
      !confirm(
        `${year} 年の誕生日メールを、以下の ${ids.length} 名へ強制送信します。\n` +
          `誕生日・プランの条件は無視されます。\n\n${lines}${warn}\n\nよろしいですか？`,
      )
    ) {
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/super-admin/birthday/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, userIds: ids, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? '送信に失敗しました');
      const r = data.result;
      if (r.failed > 0) {
        toast.error(
          `送信 ${r.sent} 件 / 失敗 ${r.failed} 件: ${r.errors?.[0]?.message ?? ''}`,
        );
      } else {
        toast.success(`${r.sent} 名に強制送信しました`);
      }
      setSelected(new Set());
      await search();
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-800">強制送信（送信漏れの救済）</h2>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              誕生日が過ぎた方・無料会員の方など、
              <strong>自動送信の対象外になっている会員にも送信できます</strong>。
              条件を無視するため、宛先をよくご確認のうえ実行してください。
              操作内容は監査ログに記録されます。
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <Input
              label="会員を検索"
              placeholder="メールアドレス / 会員番号 / お名前"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
              hint="一部でも一致すれば検索できます（最大 20 件）"
            />
          </div>
          <Button type="button" variant="secondary" loading={searching} onClick={() => void search()}>
            <Search className="mr-1 h-4 w-4" />
            検索
          </Button>
        </div>

        {searched && candidates.length === 0 && !searching && (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
            該当する会員が見つかりませんでした。退会・利用停止の会員は検索対象外です。
          </p>
        )}

        {candidates.length > 0 && (
          <>
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {candidates.map((c) => {
                const checked = selected.has(c.id);
                return (
                  <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      aria-label={`${candidateName(c)} を選択`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-slate-800">
                          {candidateName(c)}
                        </span>
                        {c.memberNumber && (
                          <span className="text-[11px] text-slate-400">{c.memberNumber}</span>
                        )}
                        {c.ineligibleReasons.length === 0 && (
                          <Badge tone="success">自動送信の対象</Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500">{c.email}</p>
                      <p className="text-[11px] text-slate-400">
                        {formatBirthday(c.birthDate)} ・{' '}
                        {c.paidPlan ? '有料プラン' : '無料プラン'}
                      </p>
                      {c.ineligibleReasons.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {c.ineligibleReasons.map((r) => (
                            <li
                              key={r}
                              className={
                                r === 'ALREADY_SENT'
                                  ? 'text-[11px] font-medium text-rose-600'
                                  : 'text-[11px] text-slate-500'
                              }
                            >
                              ・{describeBirthdayMailIneligibleReason(r)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                {selected.size > 0
                  ? `${selected.size} 名を選択中`
                  : '送信する会員にチェックを入れてください'}
              </p>
              <Button
                type="button"
                variant="danger"
                loading={sending}
                disabled={selected.size === 0}
                onClick={() => void forceSend()}
              >
                選択した {selected.size} 名に強制送信
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
