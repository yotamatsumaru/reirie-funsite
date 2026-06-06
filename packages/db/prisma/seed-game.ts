/**
 * 恋愛 ADV 用ダミーシード
 *
 * - 1 キャラクター ("hiroto" / 蒼井 大翔)
 * - 5 章 (プロローグ無料 / 第2-3章 ¥300 / 第4章 PREMIUM 同梱 / 最終章 ¥500)
 * - 共通アセット (背景・BGM・SE)
 * - キャラ別アセット (立ち絵 / 表情)
 * - プレゼントアイテム 3 種 (花束 / チョコ / 高級リング)
 *
 * 実行: pnpm --filter @idol/db tsx prisma/seed-game.ts
 *   または通常の seed と一緒に実行
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------- ダミー画像 / 音声 URL (placeholder) ----------
const PH = (text: string, w = 1280, h = 720) =>
  `https://placehold.co/${w}x${h}/ed1c75/ffffff?text=${encodeURIComponent(text)}`;

// ---------- シナリオ DSL ヘルパ ----------
const say = (speaker: string, text: string, expression?: string) => ({
  type: 'say' as const,
  speaker,
  text,
  ...(expression ? { expression } : {}),
});
const narration = (text: string) => ({ type: 'narration' as const, text });
const choice = (
  prompt: string,
  choices: Array<{
    label: string;
    delta: number;
    next?: string;
    requireItemSlug?: string;
    premiumOnly?: boolean;
  }>,
) => ({
  type: 'choice' as const,
  prompt,
  choices: choices.map((c) => ({
    label: c.label,
    effects: [{ type: 'affinity' as const, delta: c.delta }],
    ...(c.next ? { next: c.next } : {}),
    ...(c.requireItemSlug ? { requireItemSlug: c.requireItemSlug } : {}),
    ...(c.premiumOnly ? { premiumOnly: c.premiumOnly } : {}),
  })),
});
const bg = (key: string) => ({ type: 'background' as const, key });
const bgm = (key: string | null) => ({ type: 'bgm' as const, key });
const se = (key: string) => ({ type: 'se' as const, key });
const jump = (next: string) => ({ type: 'jump' as const, next });
const branch = (
  branches: Array<{ when: Array<{ kind: 'affinity'; op: 'gte' | 'lt'; value: number }>; next: string }>,
  elseTo?: string,
) => ({
  type: 'branch' as const,
  branches,
  ...(elseTo ? { else: elseTo } : {}),
});
const end = () => ({ type: 'end' as const });
const shake = () => ({ type: 'shake' as const, intensity: 'medium' as const, durationMs: 600 });
const flash = () => ({ type: 'flash' as const, color: '#ffffff', durationMs: 250 });

// ---------- 章 1: プロローグ (無料体験) ----------
const chapter1 = {
  version: 1 as const,
  startSceneKey: 'open',
  scenes: {
    open: {
      background: 'bg_studio',
      bgm: 'bgm_morning',
      steps: [
        narration('ある春の日 — レッスン後のスタジオ。'),
        say('hiroto', 'あ、来てくれたんだ。今日も応援ありがとう。', 'smile'),
        say('hiroto', '実は、最近ちょっと迷ってることがあって…。', 'serious'),
        choice('どう答える?', [
          { label: 'いつでも聞くよ', delta: 4, next: 'listen' },
          { label: 'プライベートなら無理しないで', delta: 2, next: 'considerate' },
          { label: '(黙って隣に座る)', delta: 1, next: 'silent' },
        ]),
      ],
    },
    listen: {
      steps: [
        say('hiroto', '…ありがとう。少しだけ、話してもいい?', 'soft'),
        narration('彼は小さく笑って、ゆっくり話し始めた。'),
        jump('closing'),
      ],
    },
    considerate: {
      steps: [
        say('hiroto', 'そう言ってくれるの、嬉しい。', 'smile'),
        jump('closing'),
      ],
    },
    silent: {
      steps: [
        say('hiroto', '…君がいてくれるだけで、ちょっと楽になる。', 'soft'),
        jump('closing'),
      ],
    },
    closing: {
      steps: [
        narration('話し終えた頃、夕焼けがスタジオに差し込んでいた。'),
        say('hiroto', '今日は、ありがとう。また会えるよね?', 'smile'),
        end(),
      ],
    },
  },
};

// ---------- 章 2: 距離が縮まる夜 ----------
const chapter2 = {
  version: 1 as const,
  startSceneKey: 'cafe',
  scenes: {
    cafe: {
      background: 'bg_cafe',
      bgm: 'bgm_calm',
      steps: [
        narration('レッスン帰りの夜カフェ。'),
        say('hiroto', '実は、今度の新曲…君のことを思って書いたんだ。', 'shy'),
        choice('返事は?', [
          { label: '本当に? すごく嬉しい!', delta: 6, next: 'glad' },
          { label: '冗談はやめてよ…', delta: -1, next: 'shy' },
          { label: '(顔が赤くなる)', delta: 4, next: 'shy' },
        ]),
      ],
    },
    glad: {
      steps: [
        say('hiroto', '…良かった。引かれなくて。', 'smile'),
        jump('finale'),
      ],
    },
    shy: {
      steps: [
        say('hiroto', 'ごめん、急にびっくりさせたよね。', 'soft'),
        jump('finale'),
      ],
    },
    finale: {
      steps: [
        se('se_heartbeat'),
        narration('カフェの窓の外、街灯りが揺れていた。'),
        say('hiroto', 'もう少しだけ、一緒にいてもいい?', 'soft'),
        end(),
      ],
    },
  },
};

// ---------- 章 3: 試練 ----------
const chapter3 = {
  version: 1 as const,
  startSceneKey: 'rain',
  scenes: {
    rain: {
      background: 'bg_street',
      bgm: 'bgm_tense',
      steps: [
        narration('雨の夜 — 駅前で偶然彼を見かけた。隣にいるのは、見知らぬ女性。'),
        shake(),
        say('hiroto', '…見てたんだね。説明、させてほしい。', 'serious'),
        choice('反応は?', [
          { label: '(信じて待つ)', delta: 5, next: 'trust' },
          { label: '何も言わずに立ち去る', delta: -3, next: 'leave' },
          { label: '事務所のマネージャー?', delta: 3, next: 'guess' },
        ]),
      ],
    },
    trust: {
      steps: [
        say('hiroto', '…君のそういうところ、本当に好きだ。', 'soft'),
        jump('after'),
      ],
    },
    leave: {
      steps: [
        narration('彼の声が背中を追いかけた。'),
        say('hiroto', '待って! 行かないで…!', 'sad'),
        jump('after'),
      ],
    },
    guess: {
      steps: [
        say('hiroto', 'すごい、当たり。新曲の打ち合わせだったんだ。', 'smile'),
        jump('after'),
      ],
    },
    after: {
      steps: [
        flash(),
        narration('翌朝 — メールが届いていた。'),
        say('hiroto', '昨日は、ごめん。ちゃんと話したい。週末、会える?', 'serious'),
        end(),
      ],
    },
  },
};

// ---------- 章 4: PREMIUM 限定 — 二人だけの旅 ----------
const chapter4 = {
  version: 1 as const,
  startSceneKey: 'station',
  scenes: {
    station: {
      background: 'bg_station',
      bgm: 'bgm_ride',
      steps: [
        narration('小さな駅 — 平日朝、人もまばら。'),
        say('hiroto', 'まさか本当に来てくれるとはね。', 'smile'),
        say('hiroto', '今日は、マネージャーには内緒だよ?', 'mischief'),
        choice('応える?', [
          { label: '私もドキドキしてる', delta: 5, next: 'sea' },
          { label: '内緒、得意だから', delta: 4, next: 'sea' },
        ]),
      ],
    },
    sea: {
      background: 'bg_seaside',
      bgm: 'bgm_calm',
      steps: [
        narration('海辺に着いた頃には、すっかり午後だった。'),
        say('hiroto', '前から、君と来てみたかった場所なんだ。', 'soft'),
        say('hiroto', '今だけは、誰も僕らを知らない場所で…。', 'serious'),
        end(),
      ],
    },
  },
};

// ---------- 章 5: 最終章 — 告白 ----------
const chapter5 = {
  version: 1 as const,
  startSceneKey: 'rooftop',
  scenes: {
    rooftop: {
      background: 'bg_rooftop',
      bgm: 'bgm_finale',
      steps: [
        narration('ライブ会場の屋上。リハの合間に、彼は静かに切り出した。'),
        say('hiroto', '…ずっと言いたかったことがあるんだ。', 'serious'),
        // 親密度で分岐
        branch(
          [
            { when: [{ kind: 'affinity', op: 'gte', value: 70 }], next: 'love' },
            { when: [{ kind: 'affinity', op: 'gte', value: 40 }], next: 'friend' },
          ],
          'bad',
        ),
      ],
    },
    love: {
      steps: [
        flash(),
        say('hiroto', '好きだ。アイドルじゃなくて、ただの僕として、君が好きだ。', 'soft'),
        choice('応える?', [
          { label: '私も、ずっと好きでした', delta: 10, next: 'love_end' },
          {
            label: '(ロイヤル・リングを差し出す)',
            delta: 15,
            next: 'love_end',
            requireItemSlug: 'royal-ring',
          },
        ]),
      ],
    },
    love_end: {
      steps: [
        se('se_heartbeat'),
        narration('夕陽が二人を包み込む。'),
        say('hiroto', '一生、君を離さない。', 'soft'),
        {
          type: 'effect' as const,
          effects: [{ type: 'route' as const, result: 'LOVE_END' as const }],
        },
        end(),
      ],
    },
    friend: {
      steps: [
        say('hiroto', '…君がいてくれて、本当に救われた。ずっと友達でいて。', 'smile'),
        {
          type: 'effect' as const,
          effects: [{ type: 'route' as const, result: 'FRIEND_END' as const }],
        },
        end(),
      ],
    },
    bad: {
      steps: [
        say('hiroto', '…ごめん、やっぱりやめておこう。', 'sad'),
        {
          type: 'effect' as const,
          effects: [{ type: 'route' as const, result: 'BAD_END' as const }],
        },
        end(),
      ],
    },
  },
};

async function main() {
  console.log('🎮 Seeding game data...');

  // ---------- キャラクター ----------
  const hiroto = await prisma.gameCharacter.upsert({
    where: { slug: 'hiroto' },
    update: {},
    create: {
      slug: 'hiroto',
      name: '蒼井 大翔',
      furigana: 'あおい ひろと',
      catchcopy: '振り向いてくれる、その瞬間まで。',
      description:
        'グループのセンターを務めるエースアイドル。明るく振る舞う一方で、努力家で繊細な一面も。\n誰にも見せない素顔を、君だけに。',
      age: 22,
      birthday: '04-15',
      bloodType: 'A',
      height: 178,
      portraitUrl: PH('Hiroto', 600, 800),
      spriteUrl: PH('Hiroto+Sprite', 600, 1000),
      themeColor: '#ed1c75',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      sortOrder: 1,
      isPremiumOnly: false,
      affinityMax: 100,
    },
  });
  console.log(`  ✓ character: ${hiroto.name}`);

  // ---------- アセット ----------
  const assets = [
    // 共通背景
    { kind: 'BACKGROUND' as const, key: 'bg_studio', url: PH('Studio'), characterId: null },
    { kind: 'BACKGROUND' as const, key: 'bg_cafe', url: PH('Cafe'), characterId: null },
    { kind: 'BACKGROUND' as const, key: 'bg_street', url: PH('Rain+Street'), characterId: null },
    { kind: 'BACKGROUND' as const, key: 'bg_station', url: PH('Station'), characterId: null },
    { kind: 'BACKGROUND' as const, key: 'bg_seaside', url: PH('Seaside'), characterId: null },
    { kind: 'BACKGROUND' as const, key: 'bg_rooftop', url: PH('Rooftop'), characterId: null },
    // 共通 BGM (URL は空 / 音源未配置でもプレイ可能)
    { kind: 'BGM' as const, key: 'bgm_morning', url: 'https://example.com/bgm/morning.mp3', characterId: null },
    { kind: 'BGM' as const, key: 'bgm_calm', url: 'https://example.com/bgm/calm.mp3', characterId: null },
    { kind: 'BGM' as const, key: 'bgm_tense', url: 'https://example.com/bgm/tense.mp3', characterId: null },
    { kind: 'BGM' as const, key: 'bgm_ride', url: 'https://example.com/bgm/ride.mp3', characterId: null },
    { kind: 'BGM' as const, key: 'bgm_finale', url: 'https://example.com/bgm/finale.mp3', characterId: null },
    // 共通 SE
    { kind: 'SE' as const, key: 'se_heartbeat', url: 'https://example.com/se/heartbeat.mp3', characterId: null },
    // キャラ別 立ち絵 (表情差分)
    { kind: 'SPRITE' as const, key: 'hiroto', url: PH('Hiroto+Default', 600, 1000), characterId: hiroto.id },
    { kind: 'EXPRESSION' as const, key: 'hiroto__smile', url: PH('Hiroto+Smile', 600, 1000), characterId: hiroto.id },
    { kind: 'EXPRESSION' as const, key: 'hiroto__serious', url: PH('Hiroto+Serious', 600, 1000), characterId: hiroto.id },
    { kind: 'EXPRESSION' as const, key: 'hiroto__soft', url: PH('Hiroto+Soft', 600, 1000), characterId: hiroto.id },
    { kind: 'EXPRESSION' as const, key: 'hiroto__shy', url: PH('Hiroto+Shy', 600, 1000), characterId: hiroto.id },
    { kind: 'EXPRESSION' as const, key: 'hiroto__sad', url: PH('Hiroto+Sad', 600, 1000), characterId: hiroto.id },
    { kind: 'EXPRESSION' as const, key: 'hiroto__mischief', url: PH('Hiroto+Mischief', 600, 1000), characterId: hiroto.id },
  ];
  for (const a of assets) {
    const existing = await prisma.gameAsset.findFirst({
      where: { characterId: a.characterId, kind: a.kind, key: a.key },
    });
    if (!existing) {
      await prisma.gameAsset.create({ data: a });
    }
  }
  console.log(`  ✓ assets: ${assets.length}`);

  // ---------- 章 ----------
  const scenarios = [
    {
      slug: 'prologue',
      chapterNumber: 1,
      title: 'プロローグ — レッスン後の告白',
      summary: 'ある春の日、彼が見せた「ふとした素顔」から物語が始まる。',
      scriptJson: chapter1,
      priceJpy: 0,
      isFreeTrial: true,
      isPremiumIncluded: false,
      requiredAffinity: 0,
      estimatedMinutes: 8,
    },
    {
      slug: 'chapter-2',
      chapterNumber: 2,
      title: '第2章 — 距離が縮まる夜',
      summary: '夜カフェで、彼が初めて見せる本音。',
      scriptJson: chapter2,
      priceJpy: 300,
      isFreeTrial: false,
      isPremiumIncluded: false,
      requiredAffinity: 5,
      estimatedMinutes: 10,
    },
    {
      slug: 'chapter-3',
      chapterNumber: 3,
      title: '第3章 — 試練',
      summary: '雨の夜の出来事が、二人の絆を試す。',
      scriptJson: chapter3,
      priceJpy: 300,
      isFreeTrial: false,
      isPremiumIncluded: false,
      requiredAffinity: 15,
      estimatedMinutes: 12,
    },
    {
      slug: 'chapter-4',
      chapterNumber: 4,
      title: '第4章 — 二人だけの旅 (PREMIUM)',
      summary: 'プレミアム会員限定 — 内緒の小旅行。',
      scriptJson: chapter4,
      priceJpy: 800,
      isFreeTrial: false,
      isPremiumIncluded: true,
      requiredAffinity: 30,
      estimatedMinutes: 15,
    },
    {
      slug: 'finale',
      chapterNumber: 5,
      title: '最終章 — 屋上の告白',
      summary: '親密度で結末が変わる、3 つのエンディング。',
      scriptJson: chapter5,
      priceJpy: 500,
      isFreeTrial: false,
      isPremiumIncluded: false,
      requiredAffinity: 40,
      estimatedMinutes: 15,
    },
  ];
  for (const s of scenarios) {
    await prisma.gameScenario.upsert({
      where: {
        characterId_chapterNumber: {
          characterId: hiroto.id,
          chapterNumber: s.chapterNumber,
        },
      },
      update: {
        scriptJson: s.scriptJson as never,
        title: s.title,
        summary: s.summary,
        priceJpy: s.priceJpy,
        isFreeTrial: s.isFreeTrial,
        isPremiumIncluded: s.isPremiumIncluded,
        requiredAffinity: s.requiredAffinity,
        estimatedMinutes: s.estimatedMinutes,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      create: {
        characterId: hiroto.id,
        slug: s.slug,
        chapterNumber: s.chapterNumber,
        title: s.title,
        summary: s.summary,
        scriptJson: s.scriptJson as never,
        priceJpy: s.priceJpy,
        isFreeTrial: s.isFreeTrial,
        isPremiumIncluded: s.isPremiumIncluded,
        requiredAffinity: s.requiredAffinity,
        estimatedMinutes: s.estimatedMinutes,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
  }
  console.log(`  ✓ scenarios: ${scenarios.length}`);

  // ---------- アイテム (プレゼント) ----------
  const items = [
    {
      slug: 'flower-bouquet',
      name: '小さな花束',
      description: '気軽に贈れる花束。親密度を少し上昇させます。',
      kind: 'GIFT' as const,
      iconUrl: PH('Bouquet', 200, 200),
      priceJpy: 200,
      affinityBoost: 3,
      isPremiumOnly: false,
      sortOrder: 1,
    },
    {
      slug: 'premium-chocolate',
      name: '高級チョコレート',
      description: '甘いひとときを共有しましょう。',
      kind: 'GIFT' as const,
      iconUrl: PH('Chocolate', 200, 200),
      priceJpy: 500,
      affinityBoost: 7,
      isPremiumOnly: false,
      sortOrder: 2,
    },
    {
      slug: 'royal-ring',
      name: 'ロイヤル・リング',
      description: '特別な瞬間に。最終章の告白シーンで効果を発揮します。',
      kind: 'GIFT' as const,
      iconUrl: PH('Ring', 200, 200),
      priceJpy: 1500,
      affinityBoost: 15,
      isPremiumOnly: false,
      maxOwn: 1,
      sortOrder: 3,
    },
  ];
  for (const it of items) {
    await prisma.gameItem.upsert({
      where: { slug: it.slug },
      update: {
        name: it.name,
        description: it.description,
        iconUrl: it.iconUrl,
        priceJpy: it.priceJpy,
        affinityBoost: it.affinityBoost,
        isPremiumOnly: it.isPremiumOnly,
        sortOrder: it.sortOrder,
        isActive: true,
      },
      create: {
        ...it,
        characterId: null, // 全キャラ共通
      },
    });
  }
  console.log(`  ✓ items: ${items.length}`);

  console.log('🎮 Game seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
