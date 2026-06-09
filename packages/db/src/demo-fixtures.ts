/**
 * デモモード用 fixtures (モックデータ)
 *
 * Prisma クライアントのスタブが参照する。モデル名をキーに行配列を持つ。
 */

const now = new Date();
const iso = (d: Date) => d;

// =====================================================================
// User
// =====================================================================
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_ADMIN_ID = '00000000-0000-0000-0000-000000000002';

const users = [
  {
    id: DEMO_USER_ID,
    email: 'demo@example.com',
    displayName: 'デモユーザー',
    role: 'USER',
    avatarUrl: null,
    deletedAt: null,
    createdAt: iso(now),
    updatedAt: iso(now),
    subscriptions: [], // include される
  },
  {
    id: DEMO_ADMIN_ID,
    email: 'admin@example.com',
    displayName: '管理デモ',
    role: 'ADMIN',
    avatarUrl: null,
    deletedAt: null,
    createdAt: iso(now),
    updatedAt: iso(now),
    subscriptions: [],
  },
];

// =====================================================================
// Subscription (空)
// =====================================================================
const subscription: unknown[] = [];

// =====================================================================
// Content (記事)
// =====================================================================
const content = [
  {
    id: 'c1',
    type: 'BLOG',
    slug: 'first-news',
    title: '初めての公式ブログ',
    excerpt: '応援ありがとうございます！',
    body: '# こんにちは\n\nファンサイトオープンの初日です。',
    coverImageUrl: 'https://picsum.photos/seed/blog1/800/450',
    accessLevel: 'PUBLIC',
    status: 'PUBLISHED',
    publishedAt: now,
    authorName: '運営',
    tags: ['news'],
    viewCount: 1024,
    createdAt: now,
    updatedAt: now,
    images: [],
    comments: [],
  },
  {
    id: 'c2',
    type: 'BLOG',
    slug: 'members-only-1',
    title: '会員限定: 撮影オフショット',
    excerpt: 'メンバー限定でお届け',
    body: '# メンバーだけに\n\n秘密のオフショット…',
    coverImageUrl: 'https://picsum.photos/seed/blog2/800/450',
    accessLevel: 'MEMBERS',
    status: 'PUBLISHED',
    publishedAt: now,
    authorName: '運営',
    tags: ['member'],
    viewCount: 320,
    createdAt: now,
    updatedAt: now,
    images: [],
    comments: [],
  },
  {
    id: 'c3',
    type: 'BLOG',
    slug: 'premium-special',
    title: 'プレミアム独占: スタジオ取材',
    excerpt: 'プレミアム会員だけに公開',
    body: '# プレミアム独占\n\n…',
    coverImageUrl: 'https://picsum.photos/seed/blog3/800/450',
    accessLevel: 'PREMIUM',
    status: 'PUBLISHED',
    publishedAt: now,
    authorName: '運営',
    tags: ['premium'],
    viewCount: 80,
    createdAt: now,
    updatedAt: now,
    images: [],
    comments: [],
  },
];

// =====================================================================
// Product
// =====================================================================
const product = [
  {
    id: 'p1',
    categoryId: null,
    slug: 'official-tshirt',
    name: '公式ロゴ T シャツ',
    description: '柔らかい綿 100%。プレミアム会員は ¥500 オフ。',
    basePrice: 3500,
    memberPrice: 3200,
    premiumPrice: 3000,
    taxRate: 10,
    isActive: true,
    isMembersOnly: false,
    isPremiumExclusive: false,
    createdAt: now,
    updatedAt: now,
    category: null,
    images: [{ id: 'pi1', url: 'https://picsum.photos/seed/tshirt/600/600', sortOrder: 0 }],
    variants: [],
  },
  {
    id: 'p2',
    categoryId: null,
    slug: 'members-keyring',
    name: '会員限定キーホルダー',
    description: 'スタンダード以上の会員限定アイテム',
    basePrice: 1500,
    memberPrice: 1300,
    premiumPrice: 1100,
    taxRate: 10,
    isActive: true,
    isMembersOnly: true,
    isPremiumExclusive: false,
    createdAt: now,
    updatedAt: now,
    category: null,
    images: [{ id: 'pi2', url: 'https://picsum.photos/seed/keyring/600/600', sortOrder: 0 }],
    variants: [],
  },
  {
    id: 'p3',
    categoryId: null,
    slug: 'premium-acrylic',
    name: 'プレミアム限定アクリルスタンド',
    description: 'プレミアム会員だけが購入できる特別アイテム',
    basePrice: 5000,
    memberPrice: 4500,
    premiumPrice: 4000,
    taxRate: 10,
    isActive: true,
    isMembersOnly: false,
    isPremiumExclusive: true,
    createdAt: now,
    updatedAt: now,
    category: null,
    images: [{ id: 'pi3', url: 'https://picsum.photos/seed/acrylic/600/600', sortOrder: 0 }],
    variants: [],
  },
];

// =====================================================================
// Game (恋愛 ADV)
// =====================================================================
const GAME_CHAR_ID = 'gc-hiroto';

const gameCharacter = [
  {
    id: GAME_CHAR_ID,
    slug: 'hiroto',
    name: '蒼井 大翔',
    furigana: 'あおい ひろと',
    catchcopy: '俺の隣、空いてるけど？',
    description:
      '次世代アイドルグループのセンター候補。クールな見た目とは裏腹に、努力家で甘えん坊な一面も。',
    age: 19,
    birthday: '07-15',
    bloodType: 'A',
    height: 178,
    portraitUrl: 'https://picsum.photos/seed/hiroto-portrait/600/800',
    spriteUrl: 'https://picsum.photos/seed/hiroto-sprite/600/900',
    themeColor: '#3b82f6',
    status: 'PUBLISHED',
    sortOrder: 0,
    isPremiumOnly: false,
    affinityMax: 100,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    scenarios: [],
    items: [],
    assets: [],
  },
  {
    id: 'gc-ren',
    slug: 'ren',
    name: '桜井 蓮',
    furigana: 'さくらい れん',
    catchcopy: '君のことだけは、特別だよ。',
    description:
      '人気急上昇中のソロアイドル。普段は人当たりが良いが、好きな相手には独占欲が強い。',
    age: 22,
    birthday: '03-20',
    bloodType: 'AB',
    height: 182,
    portraitUrl: 'https://picsum.photos/seed/ren-portrait/600/800',
    spriteUrl: 'https://picsum.photos/seed/ren-sprite/600/900',
    themeColor: '#ec4899',
    status: 'PUBLISHED',
    sortOrder: 1,
    isPremiumOnly: true, // プレミアム限定キャラ
    affinityMax: 100,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    scenarios: [],
    items: [],
    assets: [],
  },
];

const gameScenario = [
  {
    id: 'gs-prologue',
    characterId: GAME_CHAR_ID,
    slug: 'prologue',
    chapterNumber: 0,
    title: 'プロローグ — 運命の出会い',
    summary: '無料で遊べる導入章',
    scriptJson: {
      version: 1,
      startSceneKey: 'opening',
      scenes: {
        opening: {
          steps: [
            { type: 'background', key: 'street_day' },
            { type: 'narration', text: '春のある日、駅前のスタジオ前で——。' },
            { type: 'say', speaker: 'hiroto', expression: 'smile', text: 'あ、よかった！迷子になるところだった。' },
            { type: 'say', speaker: 'hiroto', expression: 'smile', text: '助けてくれてありがとう。' },
            {
              type: 'choice',
              prompt: 'なんて返す？',
              choices: [
                { label: 'どういたしまして！', next: 'route_friendly', effects: [{ kind: 'affinity', delta: 3 }] },
                { label: '…別に。', next: 'route_cool' },
              ],
            },
          ],
        },
        route_friendly: {
          steps: [
            { type: 'say', speaker: 'hiroto', expression: 'happy', text: '優しい人だね。名前、聞いてもいい？' },
            { type: 'narration', text: '——こうして二人の物語は始まった。' },
            { type: 'end' },
          ],
        },
        route_cool: {
          steps: [
            { type: 'say', speaker: 'hiroto', expression: 'sad', text: '…そっか。でも、本当に助かったよ。' },
            { type: 'narration', text: '少し気まずい雰囲気のまま、彼は走り去っていった。' },
            { type: 'end' },
          ],
        },
      },
    },
    priceJpy: 0,
    isFreeTrial: true,
    isPremiumIncluded: false,
    status: 'PUBLISHED',
    requiredAffinity: 0,
    estimatedMinutes: 5,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'gs-ch1',
    characterId: GAME_CHAR_ID,
    slug: 'ch1',
    chapterNumber: 1,
    title: '第 1 章 — 急接近',
    summary: '通常章 (¥300)',
    scriptJson: { version: 1, startSceneKey: 'a', scenes: { a: { steps: [{ type: 'end' }] } } },
    priceJpy: 300,
    isFreeTrial: false,
    isPremiumIncluded: true, // PREMIUM は無料
    status: 'PUBLISHED',
    requiredAffinity: 0,
    estimatedMinutes: 15,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'gs-premium-ch',
    characterId: GAME_CHAR_ID,
    slug: 'special',
    chapterNumber: 99,
    title: 'スペシャル番外編 (プレミアム限定)',
    summary: 'PREMIUM 会員専用の特別章',
    scriptJson: { version: 1, startSceneKey: 'a', scenes: { a: { steps: [{ type: 'end' }] } } },
    priceJpy: 800,
    isFreeTrial: false,
    isPremiumIncluded: true,
    status: 'PUBLISHED',
    requiredAffinity: 50,
    estimatedMinutes: 20,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  },
];

const gameItem = [
  {
    id: 'gi-bouquet',
    slug: 'bouquet',
    characterId: null,
    kind: 'GIFT',
    name: '花束',
    description: '気持ちが伝わるささやかなプレゼント',
    iconUrl: 'https://picsum.photos/seed/bouquet/200/200',
    priceJpy: 200,
    isPremiumOnly: false,
    affinityBoost: 3,
    maxOwn: null,
    isActive: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'gi-chocolate',
    slug: 'chocolate',
    characterId: null,
    kind: 'GIFT',
    name: '高級チョコレート',
    description: 'こだわりのショコラティエ',
    iconUrl: 'https://picsum.photos/seed/choco/200/200',
    priceJpy: 500,
    isPremiumOnly: false,
    affinityBoost: 7,
    maxOwn: null,
    isActive: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'gi-ring',
    slug: 'royal-ring',
    characterId: null,
    kind: 'GIFT',
    name: 'ロイヤル・リング',
    description: 'プレミアム会員だけが贈れる特別な指輪',
    iconUrl: 'https://picsum.photos/seed/ring/200/200',
    priceJpy: 1500,
    isPremiumOnly: true,
    affinityBoost: 15,
    maxOwn: 1,
    isActive: true,
    sortOrder: 2,
    createdAt: now,
    updatedAt: now,
  },
];

// =====================================================================
// その他空テーブル (Prisma 呼び出し時に空配列を返せばよい)
// =====================================================================
const empty: unknown[] = [];

const fixtures: Record<string, unknown[]> = {
  user: users,
  account: empty,
  session: empty,
  subscription,
  content,
  contentImage: empty,
  contentComment: empty,
  product,
  productCategory: empty,
  productVariant: empty,
  productImage: empty,
  cart: empty,
  cartItem: empty,
  order: empty,
  orderItem: empty,
  payment: empty,
  video: empty,
  videoViewLog: empty,
  liveStream: empty,
  ticketEvent: empty,
  ticketLink: empty,
  ticketPresaleGrant: empty,
  auditLog: empty,
  gameCharacter,
  gameScenario,
  gameAsset: empty,
  gameItem,
  playerProgress: empty,
  playerInventory: empty,
  playerPurchase: empty,
  playerSaveSlot: empty,
  bonusGiftGrant: empty,
};

export default fixtures;
export { fixtures, DEMO_USER_ID, DEMO_ADMIN_ID };
