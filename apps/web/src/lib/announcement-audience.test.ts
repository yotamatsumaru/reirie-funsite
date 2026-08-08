import {
  ANNOUNCEMENT_AUDIENCES,
  AUDIENCE_DESCRIPTIONS,
  AUDIENCE_LABELS,
  AUDIENCE_SHORT_LABELS,
  AUDIENCE_TONES,
  isAnnouncementAudience,
  planSatisfiesAudience,
  planTypesForAudience,
  requiredPlanForAudience,
  requiresPaidPlan,
  requiresSignIn,
  upgradeHeadingForAudience,
} from './announcement-audience';

describe('ANNOUNCEMENT_AUDIENCES', () => {
  it('4 段階を制限が緩い順に並べる', () => {
    expect(ANNOUNCEMENT_AUDIENCES).toEqual([
      'ALL',
      'MEMBERS',
      'STANDARD',
      'PREMIUM',
    ]);
  });

  it('全ての値にラベル / 説明 / 短縮ラベル / 色が定義されている', () => {
    for (const a of ANNOUNCEMENT_AUDIENCES) {
      expect(AUDIENCE_LABELS[a]).toBeTruthy();
      expect(AUDIENCE_DESCRIPTIONS[a]).toBeTruthy();
      expect(AUDIENCE_SHORT_LABELS[a]).toBeTruthy();
      expect(AUDIENCE_TONES[a]).toBeTruthy();
    }
  });

  it('ラベルはユーザーの要望どおりの表現になっている', () => {
    expect(AUDIENCE_LABELS.ALL).toBe('だれでも');
    expect(AUDIENCE_LABELS.MEMBERS).toBe('無料会員以上');
    expect(AUDIENCE_LABELS.STANDARD).toBe('スタンダード会員以上');
    expect(AUDIENCE_LABELS.PREMIUM).toBe('プレミアム会員のみ');
  });
});

describe('requiredPlanForAudience', () => {
  it.each([
    ['ALL', null],
    ['MEMBERS', 'FREE'],
    ['STANDARD', 'STANDARD'],
    ['PREMIUM', 'PREMIUM'],
  ] as const)('%s → %s', (audience, expected) => {
    expect(requiredPlanForAudience(audience)).toBe(expected);
  });
});

describe('requiresSignIn', () => {
  it('ALL だけログイン不要', () => {
    expect(requiresSignIn('ALL')).toBe(false);
    expect(requiresSignIn('MEMBERS')).toBe(true);
    expect(requiresSignIn('STANDARD')).toBe(true);
    expect(requiresSignIn('PREMIUM')).toBe(true);
  });
});

describe('requiresPaidPlan', () => {
  it('無料会員でも見られる対象は有料プラン不要', () => {
    expect(requiresPaidPlan('ALL')).toBe(false);
    expect(requiresPaidPlan('MEMBERS')).toBe(false);
  });

  it('STANDARD / PREMIUM は有料プランが必要', () => {
    expect(requiresPaidPlan('STANDARD')).toBe(true);
    expect(requiresPaidPlan('PREMIUM')).toBe(true);
  });
});

describe('planSatisfiesAudience — 上位プランは常に下位向けのお知らせを見られる', () => {
  /**
   * 「スタンダード会員以上」がプレミアム会員に届かない、という
   * 一番ありがちな取り違えを機械的に防ぐ表。
   */
  const table = [
    // audience, 未ログイン, FREE, STANDARD, PREMIUM
    ['ALL', true, true, true, true],
    ['MEMBERS', false, true, true, true],
    ['STANDARD', false, false, true, true],
    ['PREMIUM', false, false, false, true],
  ] as const;

  it.each(table)(
    '%s: guest=%s free=%s standard=%s premium=%s',
    (audience, guest, free, standard, premium) => {
      expect(planSatisfiesAudience(audience, null)).toBe(guest);
      expect(planSatisfiesAudience(audience, 'FREE')).toBe(free);
      expect(planSatisfiesAudience(audience, 'STANDARD')).toBe(standard);
      expect(planSatisfiesAudience(audience, 'PREMIUM')).toBe(premium);
    },
  );

  it('undefined も未ログインと同じ扱い', () => {
    expect(planSatisfiesAudience('MEMBERS', undefined)).toBe(false);
    expect(planSatisfiesAudience('ALL', undefined)).toBe(true);
  });

  it('プレミアム会員はすべての配信対象を閲覧できる', () => {
    for (const a of ANNOUNCEMENT_AUDIENCES) {
      expect(planSatisfiesAudience(a, 'PREMIUM')).toBe(true);
    }
  });
});

describe('planTypesForAudience — メール宛先のプラン絞り込み', () => {
  it('ALL / MEMBERS はプランで絞らない (null)', () => {
    expect(planTypesForAudience('ALL')).toBeNull();
    expect(planTypesForAudience('MEMBERS')).toBeNull();
  });

  it('STANDARD は STANDARD と PREMIUM を含む', () => {
    expect(planTypesForAudience('STANDARD')).toEqual(['STANDARD', 'PREMIUM']);
  });

  it('PREMIUM は PREMIUM のみ', () => {
    expect(planTypesForAudience('PREMIUM')).toEqual(['PREMIUM']);
  });

  it('FREE を有料限定の宛先に含めない (誤配信の防止)', () => {
    expect(planTypesForAudience('STANDARD')).not.toContain('FREE');
    expect(planTypesForAudience('PREMIUM')).not.toContain('FREE');
  });
});

describe('upgradeHeadingForAudience', () => {
  it('対象に応じた案内文を返す', () => {
    expect(upgradeHeadingForAudience('PREMIUM')).toContain('プレミアム');
    expect(upgradeHeadingForAudience('STANDARD')).toContain('スタンダード');
  });
});

describe('isAnnouncementAudience', () => {
  it('既知の値のみ true', () => {
    for (const a of ANNOUNCEMENT_AUDIENCES) {
      expect(isAnnouncementAudience(a)).toBe(true);
    }
  });

  it('未知の値 / 型違いは false', () => {
    expect(isAnnouncementAudience('VIP')).toBe(false);
    expect(isAnnouncementAudience('')).toBe(false);
    expect(isAnnouncementAudience(null)).toBe(false);
    expect(isAnnouncementAudience(undefined)).toBe(false);
    expect(isAnnouncementAudience(1)).toBe(false);
  });
});
