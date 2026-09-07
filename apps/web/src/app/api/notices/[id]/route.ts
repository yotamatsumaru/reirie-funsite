/**
 * GET /api/notices/[id] — お知らせ詳細
 *
 * ## 判定を自前で書かず resolveAnnouncementVisibility を使う理由（重要）
 *
 * 素朴に実装すると
 *
 *   if (!a || a.status !== 'PUBLISHED') → 404
 *   if (requiresSignIn(..) && !isLoggedIn) → 403
 *   if (!planSatisfiesAudience(..)) → 403
 *
 * となるが、これは Web の詳細ページ (/notices/[id]) の挙動と一致しない。
 * あちらは `lib/announcement-visibility.ts` の純粋関数に判定を集約しており、
 * 自前で書き直すと次の差異が生まれる:
 *
 *   1. 運営 (SUPER_ADMIN / STAFF) は公開済みの限定お知らせを
 *      プランに関係なく閲覧できる。サポート対応で「会員に何が見えているか」を
 *      確認する必要があるため。自前実装だと運営が 403 になる。
 *   2. 下書きは `?preview=1` を付けた運営だけが読める。
 *      自前実装だと運営もプレビューできない。
 *   3. 「ログインすれば読める (MEMBERS)」と
 *      「有料プランが必要 (STANDARD/PREMIUM)」を区別している。
 *      前者はログインへ誘導、後者はプラン案内。区別を失うと
 *      無料会員で読めるお知らせに対して «課金が必要» と案内してしまう。
 *
 * 判定が 2 系統に分かれると、配信対象を増やしたときに
 * 片方だけ直し忘れて限定お知らせが漏れる。そのため同じ関数を共有する。
 *
 * ## HTTP ステータスの対応
 *
 *   not-found        → 404 NOT_FOUND
 *   signin-required  → 401 UNAUTHORIZED   … ログインすれば読める
 *   upgrade-required → 403 PLAN_REQUIRED  … プランが足りない
 *   visible/preview  → 200
 *
 * signin-required を 401 にするのは、アプリ側が
 * 「ログイン画面を出す」か「プラン案内を出す」かを
 * ステータスだけで分岐できるようにするため。
 * 両方 403 だと本文のメッセージを文字列で判定することになる。
 *
 * response: { notice: { id, title, body, audience, publishedAt }, isPreview }
 */
import { NextResponse } from 'next/server';
import { getAnnouncement } from '@/lib/announcements';
import { resolveApiSession } from '@/lib/api-auth';
import { resolveAnnouncementVisibility } from '@/lib/announcement-visibility';
import { requiredPlanForAudience } from '@/lib/announcement-audience';
import type { AnnouncementAudienceLiteral } from '@/lib/announcement-audience';
import { errors, handle } from '@/lib/errors';
import { PLAN_LABELS } from '@idol/shared';

export const runtime = 'nodejs';

export const GET = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;

    /**
     * UUID の形式を先に確認する。
     * 不正な文字列で prisma が例外を投げると 500 になり、
     * 「存在しない ID」と「サーバー障害」がアプリ側で区別できない。
     */
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw errors.notFound('お知らせが見つかりません');
    }

    const announcement = await getAnnouncement(id);
    if (!announcement) throw errors.notFound('お知らせが見つかりません');

    const session = await resolveApiSession(req);

    // `?preview=1` は Web と同じクエリ名にする。
    // 権限はサーバー側のロールだけで判定するので、
    // クエリを付けただけで見えるようになることはない。
    const previewRequested =
      new URL(req.url).searchParams.get('preview') === '1';

    const decision = resolveAnnouncementVisibility(
      {
        status: announcement.status as 'DRAFT' | 'PUBLISHED',
        audience: announcement.audience as AnnouncementAudienceLiteral,
      },
      {
        isLoggedIn: !!session?.user?.id,
        role: session?.user?.role,
        plan: session?.user?.plan,
      },
      previewRequested,
    );

    if (decision.kind === 'not-found') {
      throw errors.notFound('お知らせが見つかりません');
    }
    if (decision.kind === 'signin-required') {
      throw errors.unauthorized('このお知らせを読むにはログインが必要です');
    }
    if (decision.kind === 'upgrade-required') {
      /**
       * 必要なプラン名を含めて返す。
       * 「プランが必要」だけだと、スタンダードで読めるお知らせに対して
       * アプリが «プレミアムへ» と案内してしまい、
       * 不要な上位プランへ誘導することになる。
       */
      const required = requiredPlanForAudience(
        announcement.audience as AnnouncementAudienceLiteral,
      );
      throw errors.planRequired(required ? PLAN_LABELS[required] : 'スタンダード');
    }

    return NextResponse.json({
      notice: {
        id: announcement.id,
        title: announcement.title,
        body: announcement.body,
        audience: announcement.audience,
        publishedAt: announcement.publishedAt,
      },
      /**
       * 下書きプレビューかどうか。
       * Web は「これは下書きです」というバナーを必ず出しているので、
       * アプリでも同じ注意表示ができるようにフラグを返す。
       */
      isPreview: decision.kind === 'preview',
    });
  },
);
