/**
 * サンプル商品 (グッズ) 投入スクリプト
 *  実行: pnpm --filter @idol/db seed:products
 *
 *  - slug をキーに upsert するため、何度実行しても重複しません（冪等）。
 *  - 各商品に複数枚の画像・バリエーション・在庫を付与します。
 *  - 画像は placehold.co のプレースホルダ。後から管理画面で差し替え可能です。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type SampleVariant = {
  sku: string;
  name: string;
  optionColor?: string;
  optionSize?: string;
  priceDelta?: number;
  quantity: number;
  safetyStock?: number;
};

type SampleProduct = {
  slug: string;
  name: string;
  description: string;
  basePrice: number;
  memberPrice?: number;
  premiumPrice?: number;
  categorySlug: 'goods' | 'apparel' | 'accessory' | 'media';
  isPremiumExclusive?: boolean;
  isMembersOnly?: boolean;
  images: { label: string; bg: string }[];
  variants: SampleVariant[];
};

const CATEGORIES: { slug: string; name: string; sortOrder: number }[] = [
  { slug: 'goods', name: 'グッズ', sortOrder: 1 },
  { slug: 'apparel', name: 'アパレル', sortOrder: 2 },
  { slug: 'accessory', name: 'アクセサリー', sortOrder: 3 },
  { slug: 'media', name: 'CD・映像', sortOrder: 4 },
];

function img(label: string, bg: string): string {
  // placehold.co: 600x600, 背景色 bg, テキスト label
  const text = encodeURIComponent(label);
  return `https://placehold.co/600x600/${bg}/ffffff?text=${text}`;
}

const PRODUCTS: SampleProduct[] = [
  {
    slug: 'sample-acrylic-stand',
    name: 'アクリルスタンド（全6種）',
    description: '推しメンのアクリルスタンド。デスクや棚に飾れる定番グッズです。',
    basePrice: 1500,
    memberPrice: 1350,
    categorySlug: 'goods',
    images: [
      { label: 'AcrylicStand+A', bg: 'ec4899' },
      { label: 'AcrylicStand+B', bg: 'f472b6' },
    ],
    variants: [
      { sku: 'SMP-ACR-01', name: 'メンバー1', quantity: 100, safetyStock: 10 },
      { sku: 'SMP-ACR-02', name: 'メンバー2', quantity: 100, safetyStock: 10 },
      { sku: 'SMP-ACR-03', name: 'メンバー3', quantity: 100, safetyStock: 10 },
    ],
  },
  {
    slug: 'sample-can-badge-set',
    name: '缶バッジセット（ランダム）',
    description: '直径57mmの缶バッジ。何が出るかはお楽しみのランダム仕様。',
    basePrice: 800,
    categorySlug: 'goods',
    images: [
      { label: 'CanBadge+1', bg: '8b5cf6' },
      { label: 'CanBadge+2', bg: 'a78bfa' },
      { label: 'CanBadge+3', bg: 'c4b5fd' },
    ],
    variants: [{ sku: 'SMP-BADGE-01', name: '1個（ランダム）', quantity: 300, safetyStock: 30 }],
  },
  {
    slug: 'sample-tour-tshirt',
    name: 'ツアーTシャツ',
    description: '柔らかい肌触りのコットン100%。ライブの定番アイテム。',
    basePrice: 4000,
    memberPrice: 3600,
    premiumPrice: 3200,
    categorySlug: 'apparel',
    images: [
      { label: 'Tshirt+Front', bg: '0ea5e9' },
      { label: 'Tshirt+Back', bg: '38bdf8' },
    ],
    variants: [
      { sku: 'SMP-TS-S', name: 'S', optionSize: 'S', quantity: 40, safetyStock: 5 },
      { sku: 'SMP-TS-M', name: 'M', optionSize: 'M', quantity: 60, safetyStock: 5 },
      { sku: 'SMP-TS-L', name: 'L', optionSize: 'L', quantity: 60, safetyStock: 5 },
      { sku: 'SMP-TS-XL', name: 'XL', optionSize: 'XL', priceDelta: 200, quantity: 30, safetyStock: 5 },
    ],
  },
  {
    slug: 'sample-hoodie',
    name: 'ロゴパーカー',
    description: '裏起毛で暖かいプルオーバーパーカー。ユニセックス対応。',
    basePrice: 6500,
    memberPrice: 5900,
    categorySlug: 'apparel',
    images: [
      { label: 'Hoodie+Black', bg: '334155' },
      { label: 'Hoodie+Gray', bg: '64748b' },
    ],
    variants: [
      { sku: 'SMP-HD-BLK-M', name: 'ブラック / M', optionColor: 'ブラック', optionSize: 'M', quantity: 25, safetyStock: 3 },
      { sku: 'SMP-HD-BLK-L', name: 'ブラック / L', optionColor: 'ブラック', optionSize: 'L', quantity: 25, safetyStock: 3 },
      { sku: 'SMP-HD-GRY-M', name: 'グレー / M', optionColor: 'グレー', optionSize: 'M', quantity: 20, safetyStock: 3 },
    ],
  },
  {
    slug: 'sample-tote-bag',
    name: 'キャンバストートバッグ',
    description: 'A4が入る大きめサイズ。普段使いしやすいシンプルデザイン。',
    basePrice: 2200,
    categorySlug: 'goods',
    images: [
      { label: 'ToteBag+1', bg: '14b8a6' },
      { label: 'ToteBag+2', bg: '2dd4bf' },
    ],
    variants: [{ sku: 'SMP-TOTE-NAT', name: 'ナチュラル', optionColor: 'ナチュラル', quantity: 80, safetyStock: 8 }],
  },
  {
    slug: 'sample-penlight',
    name: 'オフィシャルペンライト',
    description: '多色変更可能なライブ必携ペンライト。単4電池2本付属。',
    basePrice: 3500,
    memberPrice: 3200,
    categorySlug: 'goods',
    images: [
      { label: 'Penlight+On', bg: 'f59e0b' },
      { label: 'Penlight+Off', bg: 'fbbf24' },
    ],
    variants: [{ sku: 'SMP-PEN-01', name: '本体', quantity: 150, safetyStock: 15 }],
  },
  {
    slug: 'sample-photo-set',
    name: '生写真セット（5枚入り）',
    description: '撮りおろし生写真5枚セット。コレクションに最適。',
    basePrice: 1000,
    categorySlug: 'goods',
    images: [
      { label: 'Photo+Set+1', bg: 'ef4444' },
      { label: 'Photo+Set+2', bg: 'f87171' },
    ],
    variants: [
      { sku: 'SMP-PH-A', name: 'TypeA', quantity: 120, safetyStock: 10 },
      { sku: 'SMP-PH-B', name: 'TypeB', quantity: 120, safetyStock: 10 },
    ],
  },
  {
    slug: 'sample-keychain',
    name: 'ラバーキーホルダー',
    description: 'デフォルメイラストのラバーキーホルダー。バッグのアクセントに。',
    basePrice: 900,
    categorySlug: 'accessory',
    images: [
      { label: 'Keychain+1', bg: 'd946ef' },
      { label: 'Keychain+2', bg: 'e879f9' },
    ],
    variants: [
      { sku: 'SMP-KC-01', name: 'メンバー1', quantity: 90, safetyStock: 10 },
      { sku: 'SMP-KC-02', name: 'メンバー2', quantity: 90, safetyStock: 10 },
    ],
  },
  {
    slug: 'sample-muffler-towel',
    name: 'マフラータオル',
    description: '今治製の吸水性に優れたマフラータオル。約20×110cm。',
    basePrice: 2000,
    memberPrice: 1800,
    categorySlug: 'goods',
    images: [
      { label: 'Towel+1', bg: '3b82f6' },
      { label: 'Towel+2', bg: '60a5fa' },
    ],
    variants: [{ sku: 'SMP-TWL-01', name: '通常版', quantity: 100, safetyStock: 10 }],
  },
  {
    slug: 'sample-live-bluray',
    name: 'ライブ映像 Blu-ray',
    description: '最新ツアーの模様を完全収録。特典ブックレット付き。',
    basePrice: 7800,
    premiumPrice: 6800,
    categorySlug: 'media',
    images: [
      { label: 'BluRay+Front', bg: '7c3aed' },
      { label: 'BluRay+Disc', bg: '9333ea' },
    ],
    variants: [
      { sku: 'SMP-BD-REG', name: '通常盤', quantity: 70, safetyStock: 5 },
      { sku: 'SMP-BD-LTD', name: '限定盤', priceDelta: 2000, quantity: 30, safetyStock: 5 },
    ],
  },
  {
    slug: 'sample-premium-photobook',
    name: '【プレミアム限定】豪華フォトブック',
    description: 'プレミアム会員だけが購入できる、撮りおろし豪華フォトブック。',
    basePrice: 9800,
    premiumPrice: 8800,
    categorySlug: 'media',
    isPremiumExclusive: true,
    images: [
      { label: 'Photobook+Cover', bg: 'be123c' },
      { label: 'Photobook+Inside', bg: 'e11d48' },
    ],
    variants: [{ sku: 'SMP-PB-PREM', name: '限定版', quantity: 50, safetyStock: 5 }],
  },
];

async function main() {
  console.log('🛍  サンプル商品を投入します...');

  // カテゴリを用意
  const catBySlug = new Map<string, string>();
  for (const c of CATEGORIES) {
    const cat = await prisma.productCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.name, sortOrder: c.sortOrder },
      create: { slug: c.slug, name: c.name, sortOrder: c.sortOrder },
    });
    catBySlug.set(c.slug, cat.id);
  }

  let created = 0;
  let updated = 0;

  for (const p of PRODUCTS) {
    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    const categoryId = catBySlug.get(p.categorySlug) ?? null;

    // 商品本体 (upsert)
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        description: p.description,
        basePrice: p.basePrice,
        memberPrice: p.memberPrice ?? null,
        premiumPrice: p.premiumPrice ?? null,
        categoryId,
        isActive: true,
        isMembersOnly: p.isMembersOnly ?? false,
        isPremiumExclusive: p.isPremiumExclusive ?? false,
      },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        basePrice: p.basePrice,
        memberPrice: p.memberPrice ?? null,
        premiumPrice: p.premiumPrice ?? null,
        categoryId,
        isActive: true,
        isMembersOnly: p.isMembersOnly ?? false,
        isPremiumExclusive: p.isPremiumExclusive ?? false,
      },
    });
    if (existing) updated++;
    else created++;

    // 画像（毎回作り直して冪等に）
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.createMany({
      data: p.images.map((im, idx) => ({
        productId: product.id,
        url: img(im.label, im.bg),
        alt: `${p.name} 画像${idx + 1}`,
        sortOrder: idx,
      })),
    });

    // バリエーション + 在庫（SKU で upsert）
    for (const v of p.variants) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: v.sku },
        update: {
          productId: product.id,
          name: v.name,
          optionColor: v.optionColor ?? null,
          optionSize: v.optionSize ?? null,
          priceDelta: v.priceDelta ?? 0,
          isActive: true,
        },
        create: {
          productId: product.id,
          sku: v.sku,
          name: v.name,
          optionColor: v.optionColor ?? null,
          optionSize: v.optionSize ?? null,
          priceDelta: v.priceDelta ?? 0,
          isActive: true,
        },
      });
      await prisma.inventory.upsert({
        where: { variantId: variant.id },
        update: { quantity: v.quantity, safetyStock: v.safetyStock ?? 0 },
        create: {
          variantId: variant.id,
          quantity: v.quantity,
          reserved: 0,
          safetyStock: v.safetyStock ?? 0,
        },
      });
    }

    console.log(`  ✅ ${p.name} (${p.slug})`);
  }

  console.log(`🎉 完了: 新規 ${created} 件 / 更新 ${updated} 件（合計 ${PRODUCTS.length} 件）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
