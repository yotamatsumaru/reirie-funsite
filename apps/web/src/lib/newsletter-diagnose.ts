/**
 * 会報誌の発送対象「個別確認」。
 *
 * 「届いていない」と問い合わせがあったときに、会員番号から
 *   - 基準日時点で年間会員と判定されるか (理由つき)
 *   - 住所が揃っていて送り状 CSV に入るか
 *   - 過去に宛名 CSV / 送り状 CSV をダウンロードした時点で対象に入っていたか
 * をまとめて確認する。
 *
 * 【ダウンロード時点を見る理由】
 * 旧来の宛名 CSV (/api/super-admin/newsletter/export) は «ダウンロードした瞬間の有効会員» を出す。
 * 基準日当日の早い時間にダウンロードしていると、その日の後半に入会した人は入らない。
 * 監査ログ (newsletter.export / newsletter.b2_export) の時刻と契約開始時刻を比べて判定する。
 */
import { prisma } from '@idol/db';
import {
  MISSING_FIELD_LABELS,
  explainAnnualMembership,
  membershipPeriod,
  missingShippingFields,
  recipientName,
  formatMemberNumber,
  type JstDayRange,
  type MembershipSnapshot,
} from '@idol/shared';

/** "RR-000698" / "rr000698" / "698" / "000698" → "RR-000698"。不正なら null */
export function normalizeMemberNumberInput(raw: string): string | null {
  const s = raw.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
  const m = /^(?:RR-?)?(\d{1,9})$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return formatMemberNumber(n);
}

/** 旧来の宛名 CSV と同じ条件 (PREMIUM・ACTIVE/TRIALING、年額/月額は問わない) で、時刻 at に対象だったか */
export function wasPremiumListedAt(subs: MembershipSnapshot[], at: Date, now: Date): boolean {
  return subs.some((s) => {
    if (s.planType !== 'PREMIUM') return false;
    const p = membershipPeriod(s, now);
    if (!p) return false;
    return p.start.getTime() <= at.getTime() && (!p.end || p.end.getTime() > at.getTime());
  });
}

export type DiagnoseSubscription = MembershipSnapshot & {
  manual: boolean;
  explanation: { included: boolean; reason: string };
};

export type DiagnoseExport = {
  action: 'newsletter.export' | 'newsletter.b2_export';
  at: Date;
  cutoff: string | null;
  /** その CSV にこの会員が入っていたか */
  memberIncluded: boolean;
  /** true = 出力した会員番号の記録で確認 / false = 契約開始時刻からの推定 */
  exact: boolean;
};

export type DiagnoseResult =
  | { found: false; memberNumber: string }
  | {
      found: true;
      memberNumber: string;
      user: {
        name: string;
        email: string;
        createdAt: Date;
        deletedAt: Date | null;
        bannedAt: Date | null;
      };
      subscriptions: DiagnoseSubscription[];
      annualMember: boolean;
      missingFields: string[];
      phoneMissing: boolean;
      inB2Csv: boolean;
      exports: DiagnoseExport[];
      findings: string[];
    };

/** 結果から «考えられる原因» を日本語で並べる (純粋関数・テスト対象) */
export function buildFindings(r: {
  deleted: boolean;
  banned: boolean;
  subscriptions: DiagnoseSubscription[];
  annualMember: boolean;
  missingFields: string[];
  phoneMissing: boolean;
  exports: DiagnoseExport[];
}): string[] {
  const out: string[] = [];
  if (r.deleted || r.banned) out.push('退会済み / 利用停止中のため発送対象から除外されています。');
  if (r.subscriptions.length === 0) out.push('サブスクリプション (有料プラン) の記録がありません。');
  if (!r.annualMember && r.subscriptions.length > 0) {
    const reasons = [...new Set(r.subscriptions.map((s) => s.explanation.reason))];
    out.push(`基準日時点の年間会員と判定されませんでした (${reasons.join(' / ')})。`);
    if (r.subscriptions.some((s) => s.planType === 'PREMIUM' && s.billingInterval === 'MONTH')) {
      out.push('PREMIUM ですが月額として記録されています。Stripe の契約内容と DB の記録を確認してください。');
    }
  }
  if (r.annualMember && r.missingFields.length > 0) {
    out.push(`年間会員ですが、住所が揃っていないため送り状 CSV に入りません (未入力: ${r.missingFields.join('、')})。`);
  }
  if (r.annualMember && r.missingFields.length === 0 && r.phoneMissing) {
    out.push('電話番号が未入力のため、B2クラウド取込時にエラーになった可能性があります。');
  }
  const missedExports = r.exports.filter((e) => !e.memberIncluded);
  if (r.annualMember && missedExports.length > 0 && missedExports.length === r.exports.length) {
    out.push(
      'これまでにダウンロードされた発送用 CSV のいずれにも、この会員は入っていなかったと推定されます (ダウンロードした時点ではまだ対象外でした)。',
    );
  } else if (r.annualMember && missedExports.length > 0) {
    out.push('一部の発送用 CSV (この会員が対象になる前にダウンロードされたもの) には入っていません。どの CSV で発送したかを確認してください。');
  }
  if (out.length === 0) {
    out.push('現在の条件では発送対象に入っています。発送に使った CSV のダウンロード日時と、配送状況 (住所不備による返送など) を確認してください。');
  }
  return out;
}

export async function diagnoseNewsletterMember(
  memberNumber: string,
  day: JstDayRange,
  now: Date = new Date(),
): Promise<DiagnoseResult> {
  const user = await prisma.user.findUnique({
    where: { memberNumber },
    select: {
      id: true,
      email: true,
      fullName: true,
      displayName: true,
      furigana: true,
      postalCode: true,
      prefecture: true,
      addressLine1: true,
      addressLine2: true,
      phone: true,
      createdAt: true,
      deletedAt: true,
      bannedAt: true,
      subscriptions: {
        orderBy: { createdAt: 'asc' },
        select: {
          planType: true,
          billingInterval: true,
          status: true,
          createdAt: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          canceledAt: true,
          updatedAt: true,
          stripeSubscriptionId: true,
        },
      },
    },
  });
  if (!user) return { found: false, memberNumber };

  const subscriptions: DiagnoseSubscription[] = user.subscriptions.map((s) => {
    const snap: MembershipSnapshot = {
      planType: s.planType,
      billingInterval: s.billingInterval,
      status: s.status,
      createdAt: s.createdAt,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      canceledAt: s.canceledAt,
      updatedAt: s.updatedAt,
    };
    return {
      ...snap,
      manual: s.stripeSubscriptionId.startsWith('manual_'),
      explanation: explainAnnualMembership(snap, day, now),
    };
  });

  const excluded = Boolean(user.deletedAt || user.bannedAt);
  const annualMember = !excluded && subscriptions.some((s) => s.explanation.included);
  const missingFields = missingShippingFields(user).map((f) => MISSING_FIELD_LABELS[f]);
  const phoneMissing = !user.phone?.trim();

  const logs = await prisma.auditLog.findMany({
    where: { action: { in: ['newsletter.export', 'newsletter.b2_export'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { action: true, createdAt: true, metadata: true },
  });
  const exports: DiagnoseExport[] = logs.map((l) => {
    const meta = (l.metadata ?? {}) as { cutoff?: unknown; memberNumbers?: unknown };
    const cutoff = typeof meta.cutoff === 'string' ? meta.cutoff : null;
    const action = l.action as DiagnoseExport['action'];
    // 出力した会員番号が記録されていれば (2026-11 以降のダウンロード) それで正確に判定する。
    // 無ければ推定: 送り状 CSV / 基準日指定の宛名 CSV は基準日で、
    // 基準日なしの宛名 CSV はダウンロード時点の有効 PREMIUM 会員で判定する。
    const recorded = Array.isArray(meta.memberNumbers)
      ? (meta.memberNumbers as unknown[]).filter((v): v is string => typeof v === 'string')
      : null;
    const exact = recorded !== null;
    const memberIncluded = recorded
      ? recorded.includes(memberNumber)
      : excluded
        ? false
        : action === 'newsletter.b2_export' || cutoff
          ? annualMember && (action === 'newsletter.export' || missingFields.length === 0)
          : wasPremiumListedAt(subscriptions, l.createdAt, now);
    return { action, at: l.createdAt, cutoff, memberIncluded, exact };
  });

  return {
    found: true,
    memberNumber,
    user: {
      name: recipientName(user),
      email: user.email,
      createdAt: user.createdAt,
      deletedAt: user.deletedAt,
      bannedAt: user.bannedAt,
    },
    subscriptions,
    annualMember,
    missingFields,
    phoneMissing,
    inB2Csv: annualMember && missingFields.length === 0,
    exports,
    findings: buildFindings({
      deleted: Boolean(user.deletedAt),
      banned: Boolean(user.bannedAt),
      subscriptions,
      annualMember,
      missingFields,
      phoneMissing,
      exports,
    }),
  };
}
