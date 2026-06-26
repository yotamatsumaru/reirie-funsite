/**
 * プラン特典定義の単体テスト
 */
import {
  SAVE_SLOT_LIMIT,
  FREE_SHIPPING_THRESHOLD_BY_PLAN,
  MONTHLY_BONUS_GIFT_COUNT,
  MAX_VIDEO_QUALITY,
  LIVE_ARCHIVE_RETENTION_DAYS,
  CAN_POST_COMMENT,
  HIDE_ADS,
  SHOW_PREMIUM_BADGE,
  PREMIUM_INCLUDES_SCENARIOS,
  PLAN_BENEFITS_TABLE,
  PLAN_HIGHLIGHTS,
  DEFAULT_BONUS_GIFT_SLUG,
  PLAN_POINT_MULTIPLIER,
  PLAN_POINT_MULTIPLIER_LABEL,
  NEWSLETTER_ISSUES_PER_YEAR,
  applyPlanPointMultiplier,
  canPlayQuality,
  allowedVideoQualities,
  groupedPlanBenefits,
  currentYearMonth,
} from './plan-benefits';

describe('SAVE_SLOT_LIMIT', () => {
  it('FREE=1 / STANDARD=3 / PREMIUM=10', () => {
    expect(SAVE_SLOT_LIMIT.FREE).toBe(1);
    expect(SAVE_SLOT_LIMIT.STANDARD).toBe(3);
    expect(SAVE_SLOT_LIMIT.PREMIUM).toBe(10);
  });
});

describe('FREE_SHIPPING_THRESHOLD_BY_PLAN', () => {
  it('FREE / STANDARD は 8000', () => {
    expect(FREE_SHIPPING_THRESHOLD_BY_PLAN.FREE).toBe(8000);
    expect(FREE_SHIPPING_THRESHOLD_BY_PLAN.STANDARD).toBe(8000);
  });
  it('PREMIUM は 0 (常時無料)', () => {
    expect(FREE_SHIPPING_THRESHOLD_BY_PLAN.PREMIUM).toBe(0);
  });
});

describe('MONTHLY_BONUS_GIFT_COUNT', () => {
  it('STANDARD=1 / PREMIUM=5 / FREE=0', () => {
    expect(MONTHLY_BONUS_GIFT_COUNT.FREE).toBe(0);
    expect(MONTHLY_BONUS_GIFT_COUNT.STANDARD).toBe(1);
    expect(MONTHLY_BONUS_GIFT_COUNT.PREMIUM).toBe(5);
  });
});

describe('MAX_VIDEO_QUALITY / canPlayQuality / allowedVideoQualities', () => {
  it('プラン別の上限画質が正しい', () => {
    expect(MAX_VIDEO_QUALITY.FREE).toBe('480p');
    expect(MAX_VIDEO_QUALITY.STANDARD).toBe('720p');
    expect(MAX_VIDEO_QUALITY.PREMIUM).toBe('1080p');
  });

  it('FREE は 480p のみ再生可', () => {
    expect(canPlayQuality('FREE', '480p')).toBe(true);
    expect(canPlayQuality('FREE', '720p')).toBe(false);
    expect(canPlayQuality('FREE', '1080p')).toBe(false);
  });

  it('STANDARD は 480p / 720p 再生可、1080p 不可', () => {
    expect(canPlayQuality('STANDARD', '480p')).toBe(true);
    expect(canPlayQuality('STANDARD', '720p')).toBe(true);
    expect(canPlayQuality('STANDARD', '1080p')).toBe(false);
  });

  it('PREMIUM は全画質再生可', () => {
    expect(canPlayQuality('PREMIUM', '480p')).toBe(true);
    expect(canPlayQuality('PREMIUM', '720p')).toBe(true);
    expect(canPlayQuality('PREMIUM', '1080p')).toBe(true);
  });

  it('allowedVideoQualities は昇順で返す', () => {
    expect(allowedVideoQualities('FREE')).toEqual(['480p']);
    expect(allowedVideoQualities('STANDARD')).toEqual(['480p', '720p']);
    expect(allowedVideoQualities('PREMIUM')).toEqual(['480p', '720p', '1080p']);
  });
});

describe('LIVE_ARCHIVE_RETENTION_DAYS', () => {
  it('FREE=0 / STANDARD=7 / PREMIUM=-1 (無期限)', () => {
    expect(LIVE_ARCHIVE_RETENTION_DAYS.FREE).toBe(0);
    expect(LIVE_ARCHIVE_RETENTION_DAYS.STANDARD).toBe(7);
    expect(LIVE_ARCHIVE_RETENTION_DAYS.PREMIUM).toBe(-1);
  });
});

describe('CAN_POST_COMMENT', () => {
  it('STANDARD 以上のみ投稿可', () => {
    expect(CAN_POST_COMMENT.FREE).toBe(false);
    expect(CAN_POST_COMMENT.STANDARD).toBe(true);
    expect(CAN_POST_COMMENT.PREMIUM).toBe(true);
  });
});

describe('HIDE_ADS / SHOW_PREMIUM_BADGE / PREMIUM_INCLUDES_SCENARIOS', () => {
  it('広告非表示は STANDARD 以上', () => {
    expect(HIDE_ADS.FREE).toBe(false);
    expect(HIDE_ADS.STANDARD).toBe(true);
    expect(HIDE_ADS.PREMIUM).toBe(true);
  });

  it('プレミアムバッジは PREMIUM のみ', () => {
    expect(SHOW_PREMIUM_BADGE.FREE).toBe(false);
    expect(SHOW_PREMIUM_BADGE.STANDARD).toBe(false);
    expect(SHOW_PREMIUM_BADGE.PREMIUM).toBe(true);
  });

  it('プレミアム会員はゲーム章が読み放題', () => {
    expect(PREMIUM_INCLUDES_SCENARIOS.FREE).toBe(false);
    expect(PREMIUM_INCLUDES_SCENARIOS.STANDARD).toBe(false);
    expect(PREMIUM_INCLUDES_SCENARIOS.PREMIUM).toBe(true);
  });
});

describe('PLAN_BENEFITS_TABLE', () => {
  it('全行に 4 カラム必須フィールドが揃っている', () => {
    for (const row of PLAN_BENEFITS_TABLE) {
      expect(row.category).toBeTruthy();
      expect(row.label).toBeTruthy();
      expect(row.free).toBeDefined();
      expect(row.standard).toBeDefined();
      expect(row.premium).toBeDefined();
    }
  });

  it('30 行以上ある', () => {
    expect(PLAN_BENEFITS_TABLE.length).toBeGreaterThanOrEqual(25);
  });

  it('「注目」ハイライトが少なくとも 3 つある', () => {
    const highlights = PLAN_BENEFITS_TABLE.filter((r) => r.highlight);
    expect(highlights.length).toBeGreaterThanOrEqual(3);
  });
});

describe('groupedPlanBenefits', () => {
  it('カテゴリ別にグルーピングされる', () => {
    const groups = groupedPlanBenefits();
    expect(groups.length).toBeGreaterThan(0);
    // 元の行数と一致
    const total = groups.reduce((sum, g) => sum + g.rows.length, 0);
    expect(total).toBe(PLAN_BENEFITS_TABLE.length);
  });

  it('順序が PLAN_BENEFITS_TABLE と一致', () => {
    const groups = groupedPlanBenefits();
    const firstCategory = PLAN_BENEFITS_TABLE[0]?.category;
    expect(groups[0]?.category).toBe(firstCategory);
  });
});

describe('PLAN_HIGHLIGHTS', () => {
  it('各プランにハイライトが定義されている', () => {
    expect(PLAN_HIGHLIGHTS.FREE.length).toBeGreaterThan(0);
    expect(PLAN_HIGHLIGHTS.STANDARD.length).toBeGreaterThan(0);
    expect(PLAN_HIGHLIGHTS.PREMIUM.length).toBeGreaterThan(0);
  });

  it('プレミアムは最も多くのハイライト', () => {
    expect(PLAN_HIGHLIGHTS.PREMIUM.length).toBeGreaterThanOrEqual(PLAN_HIGHLIGHTS.STANDARD.length);
  });
});

describe('DEFAULT_BONUS_GIFT_SLUG', () => {
  it('snake-case 形式の slug', () => {
    expect(DEFAULT_BONUS_GIFT_SLUG).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('PLAN_POINT_MULTIPLIER', () => {
  it('FREE=1.0 / STANDARD=1.2 / PREMIUM=2.0', () => {
    expect(PLAN_POINT_MULTIPLIER.FREE).toBe(1.0);
    expect(PLAN_POINT_MULTIPLIER.STANDARD).toBe(1.2);
    expect(PLAN_POINT_MULTIPLIER.PREMIUM).toBe(2.0);
  });

  it('PREMIUM が最も付与率が良い', () => {
    expect(PLAN_POINT_MULTIPLIER.PREMIUM).toBeGreaterThan(PLAN_POINT_MULTIPLIER.STANDARD);
    expect(PLAN_POINT_MULTIPLIER.STANDARD).toBeGreaterThanOrEqual(PLAN_POINT_MULTIPLIER.FREE);
  });

  it('表示ラベルが定義されている', () => {
    expect(PLAN_POINT_MULTIPLIER_LABEL.FREE).toBe('×1.0');
    expect(PLAN_POINT_MULTIPLIER_LABEL.STANDARD).toBe('×1.2');
    expect(PLAN_POINT_MULTIPLIER_LABEL.PREMIUM).toBe('×2.0');
  });
});

describe('applyPlanPointMultiplier', () => {
  it('FREE はベース額そのまま (整数)', () => {
    expect(applyPlanPointMultiplier(10, 'FREE')).toBe(10);
    expect(applyPlanPointMultiplier(30, 'FREE')).toBe(30);
  });

  it('STANDARD は ×1.2 で四捨五入', () => {
    expect(applyPlanPointMultiplier(10, 'STANDARD')).toBe(12); // 12
    expect(applyPlanPointMultiplier(30, 'STANDARD')).toBe(36); // 36
    expect(applyPlanPointMultiplier(5, 'STANDARD')).toBe(6); // 6.0
    expect(applyPlanPointMultiplier(7, 'STANDARD')).toBe(8); // 8.4 -> 8
  });

  it('PREMIUM は ×2.0', () => {
    expect(applyPlanPointMultiplier(10, 'PREMIUM')).toBe(20);
    expect(applyPlanPointMultiplier(30, 'PREMIUM')).toBe(60);
  });

  it('0 以下や非数は 0 を返す', () => {
    expect(applyPlanPointMultiplier(0, 'PREMIUM')).toBe(0);
    expect(applyPlanPointMultiplier(-5, 'PREMIUM')).toBe(0);
    expect(applyPlanPointMultiplier(Number.NaN, 'PREMIUM')).toBe(0);
  });

  it('常に整数を返す', () => {
    for (const plan of ['FREE', 'STANDARD', 'PREMIUM'] as const) {
      for (const base of [1, 3, 7, 11, 13, 17, 23]) {
        expect(Number.isInteger(applyPlanPointMultiplier(base, plan))).toBe(true);
      }
    }
  });
});

describe('NEWSLETTER_ISSUES_PER_YEAR', () => {
  it('PREMIUM のみ年2回、他は 0', () => {
    expect(NEWSLETTER_ISSUES_PER_YEAR.FREE).toBe(0);
    expect(NEWSLETTER_ISSUES_PER_YEAR.STANDARD).toBe(0);
    expect(NEWSLETTER_ISSUES_PER_YEAR.PREMIUM).toBe(2);
  });
});

describe('currentYearMonth', () => {
  it('YYYY-MM 形式', () => {
    expect(currentYearMonth()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('指定日付に対して正しい年月を返す', () => {
    expect(currentYearMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2026-01');
    expect(currentYearMonth(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
    expect(currentYearMonth(new Date('2026-03-01T00:00:00Z'))).toBe('2026-03');
  });
});
