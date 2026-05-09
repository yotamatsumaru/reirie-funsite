/**
 * 開発用シードデータ投入スクリプト
 * 実行: pnpm --filter @idol/db seed
 */
import {
  PrismaClient,
  AccessLevel,
  ContentStatus,
  ContentType,
  VideoStatus,
  LiveStatus,
} from '@prisma/client';
import { createHash, randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

// シンプルなパスワードハッシュ (Auth.js の Credentials Provider 用)
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

async function main() {
  console.log('🌱 Seeding database...');

  // ---------- 管理者 / テストユーザー ----------
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: hashPassword('Admin1234!'),
      displayName: '管理者',
      role: 'ADMIN',
      emailVerified: new Date(),
    },
  });
  await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      passwordHash: hashPassword('User1234!'),
      displayName: 'テストユーザー',
      emailVerified: new Date(),
    },
  });

  // ---------- カテゴリ ----------
  const goodsCat = await prisma.productCategory.upsert({
    where: { slug: 'goods' },
    update: {},
    create: { slug: 'goods', name: 'グッズ', sortOrder: 1 },
  });
  const apparelCat = await prisma.productCategory.upsert({
    where: { slug: 'apparel' },
    update: {},
    create: { slug: 'apparel', name: 'アパレル', sortOrder: 2 },
  });

  // ---------- 商品 ----------
  const tshirt = await prisma.product.upsert({
    where: { slug: 'tour-tshirt-2026' },
    update: {},
    create: {
      slug: 'tour-tshirt-2026',
      name: 'ツアーTシャツ 2026',
      description: '2026年全国ツアー記念Tシャツ。背面にツアー日程プリント。',
      basePrice: 4500,
      memberPrice: 4000,
      premiumPrice: 3500,
      categoryId: apparelCat.id,
      images: {
        create: [
          { url: 'https://placehold.co/600x600?text=Tshirt+Front', sortOrder: 0, alt: '正面' },
          { url: 'https://placehold.co/600x600?text=Tshirt+Back', sortOrder: 1, alt: '背面' },
        ],
      },
      variants: {
        create: [
          { sku: 'TS-2026-BLK-S', name: '黒 / S', optionColor: '黒', optionSize: 'S' },
          { sku: 'TS-2026-BLK-M', name: '黒 / M', optionColor: '黒', optionSize: 'M' },
          { sku: 'TS-2026-BLK-L', name: '黒 / L', optionColor: '黒', optionSize: 'L' },
          { sku: 'TS-2026-WHT-M', name: '白 / M', optionColor: '白', optionSize: 'M' },
        ],
      },
    },
    include: { variants: true },
  });

  for (const variant of tshirt.variants) {
    await prisma.inventory.upsert({
      where: { variantId: variant.id },
      update: {},
      create: { variantId: variant.id, quantity: 50, reserved: 0, safetyStock: 5 },
    });
  }

  await prisma.product.upsert({
    where: { slug: 'photobook-premium' },
    update: {},
    create: {
      slug: 'photobook-premium',
      name: '限定フォトブック (プレミアム会員専用)',
      description: 'プレミアム会員限定で販売する豪華フォトブック。',
      basePrice: 8800,
      premiumPrice: 7500,
      categoryId: goodsCat.id,
      isPremiumExclusive: true,
      images: {
        create: [{ url: 'https://placehold.co/600x600?text=Photobook', sortOrder: 0 }],
      },
      variants: {
        create: [{ sku: 'PB-PREM-001', name: '通常版' }],
      },
    },
  });

  // ---------- ブログ記事 ----------
  await prisma.content.upsert({
    where: { slug: 'welcome-to-fanclub' },
    update: {},
    create: {
      slug: 'welcome-to-fanclub',
      type: ContentType.BLOG,
      title: 'ファンクラブへようこそ！',
      excerpt: '公式ファンクラブのオープンに寄せて。',
      body: '# ようこそ\n\n公式ファンクラブにご入会いただきありがとうございます！',
      accessLevel: AccessLevel.PUBLIC,
      status: ContentStatus.PUBLISHED,
      publishedAt: new Date(),
      authorName: '運営チーム',
      tags: ['お知らせ'],
    },
  });

  await prisma.content.upsert({
    where: { slug: 'members-only-message' },
    update: {},
    create: {
      slug: 'members-only-message',
      type: ContentType.BLOG,
      title: '【会員限定】メンバーからの感謝メッセージ',
      excerpt: 'スタンダード以上の会員様へ向けた特別メッセージ。',
      body: '# 会員のみなさまへ\n\nいつも応援ありがとうございます…',
      accessLevel: AccessLevel.MEMBERS,
      status: ContentStatus.PUBLISHED,
      publishedAt: new Date(),
      authorName: 'メンバーA',
      tags: ['会員限定'],
    },
  });

  await prisma.content.upsert({
    where: { slug: 'premium-behind-the-scenes' },
    update: {},
    create: {
      slug: 'premium-behind-the-scenes',
      type: ContentType.BLOG,
      title: '【プレミアム限定】MV撮影の裏側',
      excerpt: 'プレミアム会員限定の撮影裏話を公開。',
      body: '# 撮影レポート\n\n撮影は早朝5時から始まりました…',
      accessLevel: AccessLevel.PREMIUM,
      status: ContentStatus.PUBLISHED,
      publishedAt: new Date(),
      authorName: '制作スタッフ',
      tags: ['プレミアム限定', '撮影'],
    },
  });

  // ---------- ギャラリー ----------
  await prisma.content.upsert({
    where: { slug: 'gallery-tour-2025' },
    update: {},
    create: {
      slug: 'gallery-tour-2025',
      type: ContentType.GALLERY,
      title: '2025ツアー写真集',
      body: '2025年ツアーで撮影した写真集です。',
      accessLevel: AccessLevel.MEMBERS,
      status: ContentStatus.PUBLISHED,
      publishedAt: new Date(),
      images: {
        create: [
          { url: 'https://placehold.co/1200x800?text=Tour+1', sortOrder: 0 },
          { url: 'https://placehold.co/1200x800?text=Tour+2', sortOrder: 1 },
          { url: 'https://placehold.co/1200x800?text=Tour+3', sortOrder: 2 },
        ],
      },
    },
  });

  // ---------- 動画 ----------
  await prisma.video.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      title: '【プレミアム限定】MV ディレクターズカット',
      description: 'プレミアム会員限定で公開する未公開シーン入りMV。',
      s3SourceKey: 'videos/source/mv-directors-cut.mp4',
      s3HlsKey: 'videos/hls/mv-directors-cut/master.m3u8',
      thumbnailUrl: 'https://placehold.co/1280x720?text=MV+DirectorsCut',
      durationSeconds: 320,
      accessLevel: AccessLevel.PREMIUM,
      status: VideoStatus.READY,
      publishedAt: new Date(),
    },
  });

  // ---------- ライブ ----------
  await prisma.liveStream.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      title: '【会員限定】月例トーク配信',
      description: '毎月恒例のメンバートーク配信です。',
      ivsChannelArn: 'arn:aws:ivs:ap-northeast-1:000000000000:channel/dev',
      ivsPlaybackUrl: 'https://example.m3u8.example.com/master.m3u8',
      isPrivate: true,
      accessLevel: AccessLevel.MEMBERS,
      status: LiveStatus.SCHEDULED,
      scheduledStartAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // ---------- チケットイベント ----------
  await prisma.ticketEvent.upsert({
    where: { externalEventId: 'LTIKE-2026-TOUR-001' },
    update: {},
    create: {
      externalEventId: 'LTIKE-2026-TOUR-001',
      title: '2026 全国ツアー 東京公演',
      venue: '東京ドーム',
      performedAt: new Date('2026-08-15T18:00:00+09:00'),
      presaleStartAt: new Date('2026-06-01T10:00:00+09:00'),
      presaleEndAt: new Date('2026-06-07T23:59:00+09:00'),
      publicSaleAt: new Date('2026-06-15T10:00:00+09:00'),
      requiredPlan: 'STANDARD',
    },
  });

  // suppress unused warning
  void createHash;

  console.log('✅ Seed completed.');
  console.log('   admin: admin@example.com / Admin1234!');
  console.log('   user : user@example.com  / User1234!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
