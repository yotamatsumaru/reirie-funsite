import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import {
  canAccess,
  canUseShop,
  formatJstDateTimeShort,
  getSaleStatus,
  methodsForProduct,
} from '@idol/shared';
import Link from 'next/link';
import { effectiveUnitPrice, formatJpy } from '@/lib/pricing';
import { Badge } from '@/components/ui/Badge';
import { AddToCartForm } from '@/components/product/AddToCartForm';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { listActiveShippingMethods } from '@/lib/shipping';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = await prisma.product.findUnique({ where: { slug }, select: { name: true } });
  return { title: p?.name ?? '商品' };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { productsVisible } = await getSiteSectionVisibility();
  if (!productsVisible) notFound();

  const { slug } = await params;
  const session = await auth();
  const plan = session?.user?.plan ?? 'FREE';

  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      category: true,
      images: { orderBy: { sortOrder: 'asc' } },
      variants: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        include: { inventory: true },
      },
      options: { orderBy: { sortOrder: 'asc' } },
      shippingMethods: { select: { shippingMethodId: true } },
    },
  });
  if (!product || !product.isActive) notFound();

  // 発売前 / 販売終了 でもページは見せる (予告)。購入ボタンだけ出さない。
  const saleStatus = getSaleStatus(product);

  // この商品で選べる配送方法 (未割当なら基本配送)
  const allShipping = await listActiveShippingMethods();
  const shippingMethods = methodsForProduct(
    allShipping,
    product.shippingMethods.map((s) => s.shippingMethodId),
  );

  // 無料会員 (FREE) / 未認証は物販 (EC) を一切利用できない
  const shopBlocked = !canUseShop(plan);

  const blocked =
    (product.isPremiumExclusive && !canAccess(plan, 'PREMIUM')) ||
    (product.isMembersOnly && !canAccess(plan, 'MEMBERS'));

  const variants = product.variants.map((v) => ({
    id: v.id,
    name: v.name,
    optionColor: v.optionColor,
    optionSize: v.optionSize,
    effectivePrice: effectiveUnitPrice(
      { basePrice: product.basePrice, memberPrice: product.memberPrice, premiumPrice: product.premiumPrice },
      v.priceDelta,
      plan,
    ),
    stockQuantity: v.inventory
      ? Math.max(0, v.inventory.quantity - v.inventory.reserved - v.inventory.safetyStock)
      : 0,
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <div>
          <div className="aspect-square w-full overflow-hidden rounded-lg bg-slate-100">
            {product.images[0]?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.images[0].url}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                No Image
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {product.images.slice(1).map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.url}
                  alt={img.alt ?? ''}
                  className="aspect-square w-full rounded-md object-cover"
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap gap-1">
            {product.category && <Badge tone="gray">{product.category.name}</Badge>}
            {product.isPremiumExclusive && <Badge tone="brand">PREMIUM限定</Badge>}
            {product.isMembersOnly && !product.isPremiumExclusive && (
              <Badge tone="info">会員限定</Badge>
            )}
            {saleStatus === 'UPCOMING' && <Badge tone="warning">発売前</Badge>}
            {saleStatus === 'ENDED' && <Badge tone="gray">販売終了</Badge>}
          </div>
          <h1 className="text-xl font-bold leading-snug text-slate-800 sm:text-2xl">{product.name}</h1>
          {product.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{product.description}</p>
          )}

          {/* 配送方法 / 送料 (BASE の商品ページと同様に、購入前に送料が分かるようにする) */}
          {shippingMethods.length > 0 && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">配送方法・送料</p>
              <ul className="mt-1 space-y-0.5">
                {shippingMethods.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span>{m.name}</span>
                    <span className="font-medium text-slate-800">
                      {m.fee === 0 ? '無料' : formatJpy(m.fee)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-slate-500">
                複数商品をまとめて購入する場合は、すべての商品が対応する配送方法から選べます。
              </p>
            </div>
          )}

          <div className="mt-6 border-t border-slate-200 pt-4">
            {saleStatus === 'UPCOMING' ? (
              <div className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">この商品は発売前です</p>
                {product.saleStartsAt && (
                  <p className="mt-1">
                    発売開始: {formatJstDateTimeShort(product.saleStartsAt)}
                  </p>
                )}
                <p className="mt-1 text-xs text-amber-700">
                  発売時刻になるとこのページから購入できるようになります。
                </p>
              </div>
            ) : saleStatus === 'ENDED' ? (
              <div className="rounded-md bg-slate-100 p-4 text-sm text-slate-600">
                <p className="font-semibold">この商品の販売は終了しました</p>
                {product.saleEndsAt && (
                  <p className="mt-1 text-xs">販売終了: {formatJstDateTimeShort(product.saleEndsAt)}</p>
                )}
              </div>
            ) : shopBlocked ? (
              <div className="rounded-md bg-brand-50 p-4 text-sm text-brand-700">
                <p className="font-semibold">物販（ショップ）はスタンダード以上のプラン限定です</p>
                <p className="mt-1 text-brand-600">
                  無料会員の方は商品をご購入いただけません。プランをアップグレードすると
                  ショップをご利用いただけます。
                </p>
                <Link
                  href="/plans"
                  className="mt-3 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  プランを見る
                </Link>
              </div>
            ) : blocked ? (
              <div className="rounded-md bg-brand-50 p-4 text-sm text-brand-700">
                この商品は
                {product.isPremiumExclusive ? 'プレミアム' : 'スタンダード'}
                会員限定です。プランをアップグレードしてください。
              </div>
            ) : (
              <AddToCartForm
                variants={variants}
                loggedIn={Boolean(session?.user)}
                options={product.options.map((o) => ({
                  id: o.id,
                  name: o.name,
                  helpText: o.helpText,
                  maxLength: o.maxLength,
                  price: o.price,
                  isRequired: o.isRequired,
                }))}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
