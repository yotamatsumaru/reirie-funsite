'use client';

/**
 * 会報誌の発送対象「個別確認」パネル。
 * 会員番号を入れると、基準日時点で発送対象に入るか・入らない理由・
 * 過去にダウンロードした発送用 CSV に入っていたかを表示する。
 */
import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { formatJstDateTimeShort } from '@idol/shared';

type Sub = {
  planType: string;
  billingInterval: string;
  status: string;
  createdAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  manual: boolean;
  explanation: { included: boolean; reason: string };
};
type Result =
  | { found: false; memberNumber: string }
  | {
      found: true;
      memberNumber: string;
      user: { name: string; email: string; createdAt: string; deletedAt: string | null; bannedAt: string | null };
      subscriptions: Sub[];
      annualMember: boolean;
      missingFields: string[];
      phoneMissing: boolean;
      inB2Csv: boolean;
      exports: { action: string; at: string; cutoff: string | null; memberIncluded: boolean; exact: boolean }[];
      findings: string[];
    };

const EXPORT_LABEL: Record<string, string> = {
  'newsletter.export': '宛名CSV (ダウンロード時点の有効会員)',
  'newsletter.b2_export': 'ヤマトB2 送り状CSV (基準日時点の年間会員)',
};

function Yes({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok ? (
    <span className="font-semibold text-emerald-600">○ {yes}</span>
  ) : (
    <span className="font-semibold text-rose-600">× {no}</span>
  );
}

export function DiagnosePanel({ cutoffDate }: { cutoffDate: string }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams({ memberNumber: input, cutoff: cutoffDate });
      const res = await fetch(`/api/super-admin/newsletter/diagnose?${qs.toString()}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      setResult(j as Result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-700">個別確認（「届いていない」と連絡があったとき）</h2>
        <p className="mt-1 text-xs text-slate-500">
          会員番号を入れると、基準日（{cutoffDate}）時点で発送対象に入るか、入らない理由、
          これまでにダウンロードした発送用 CSV に入っていたかを確認できます。
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        <form onSubmit={run} className="flex flex-wrap items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="RR-000698"
            aria-label="会員番号"
            className="w-48 rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-md bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {loading ? '確認中…' : '確認する'}
          </button>
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </form>

        {result && !result.found && (
          <p className="text-sm text-slate-600">会員番号 {result.memberNumber} の会員は見つかりませんでした。</p>
        )}

        {result && result.found && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="font-semibold text-slate-800">
                {result.memberNumber} {result.user.name || '（氏名未入力）'}
              </p>
              <p className="text-xs text-slate-500">
                {result.user.email} / 登録 {formatJstDateTimeShort(result.user.createdAt)} (日本時間)
                {(result.user.deletedAt || result.user.bannedAt) && (
                  <span className="ml-2 text-rose-600">退会済み / 利用停止中</span>
                )}
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                <li>
                  基準日時点の年間会員: <Yes ok={result.annualMember} yes="該当" no="該当しない" />
                </li>
                <li>
                  住所: <Yes ok={result.missingFields.length === 0} yes="揃っている" no={`未入力 (${result.missingFields.join('、')})`} />
                  {result.phoneMissing && <span className="ml-2 text-amber-600">電話番号なし</span>}
                </li>
                <li>
                  いま送り状CSVを作ると: <Yes ok={result.inB2Csv} yes="入る" no="入らない" />
                </li>
              </ul>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">考えられる原因</p>
              <ul className="list-disc space-y-1 pl-5 text-slate-700">
                {result.findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>

            <div className="overflow-x-auto">
              <p className="mb-1 text-xs font-semibold text-slate-600">契約の記録</p>
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1">プラン</th>
                    <th className="px-2 py-1">状態</th>
                    <th className="px-2 py-1">開始 (日本時間)</th>
                    <th className="px-2 py-1">期間終了</th>
                    <th className="px-2 py-1">判定</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.subscriptions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-2 text-slate-400">記録なし</td>
                    </tr>
                  )}
                  {result.subscriptions.map((s, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">
                        {s.planType} / {s.billingInterval === 'YEAR' ? '年額' : '月額'}
                        {s.manual && <span className="ml-1 text-slate-400">(手動付与)</span>}
                      </td>
                      <td className="px-2 py-1">{s.status}</td>
                      <td className="px-2 py-1">
                        {formatJstDateTimeShort(
                          new Date(s.currentPeriodStart) < new Date(s.createdAt) ? s.currentPeriodStart : s.createdAt,
                        )}
                      </td>
                      <td className="px-2 py-1">{formatJstDateTimeShort(s.currentPeriodEnd)}</td>
                      <td className={`px-2 py-1 ${s.explanation.included ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {s.explanation.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <p className="mb-1 text-xs font-semibold text-slate-600">これまでにダウンロードされた発送用 CSV (新しい順・最大 20 件)</p>
              {result.exports.length === 0 ? (
                <p className="text-xs text-slate-400">記録がありません。</p>
              ) : (
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1">ダウンロード日時 (日本時間)</th>
                      <th className="px-2 py-1">種類</th>
                      <th className="px-2 py-1">この会員</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.exports.map((x, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1">{formatJstDateTimeShort(x.at)}</td>
                        <td className="px-2 py-1">
                          {EXPORT_LABEL[x.action] ?? x.action}
                          {x.cutoff && <span className="ml-1 text-slate-400">基準日 {x.cutoff}</span>}
                        </td>
                        <td className="px-2 py-1">
                          <Yes ok={x.memberIncluded} yes="入っていた" no="入っていない" />
                          <span className="ml-1 text-[10px] text-slate-400">{x.exact ? '(記録で確認)' : '(推定)'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-1 text-[11px] text-slate-400">
                ※ 「記録で確認」は出力した会員番号の記録 (今回の更新以降のダウンロード) で確認した結果です。
                それより前のダウンロードは契約開始時刻からの推定です (基準日を指定しない宛名CSVは、ダウンロードした瞬間の有効会員を出すため、それより後に入会した人は入りません)。
              </p>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
