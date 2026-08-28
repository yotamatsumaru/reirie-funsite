import {
  accessibleLevels,
  accessLevelRank,
  canAccess,
  canUseShop,
  planRank,
  requiredPlanLabel,
  requiresSignInForAccess,
} from './access-control';
import { ACCESS_LEVELS, ACCESS_LEVEL_LABELS, accessLevelLabel } from './constants';

describe('canAccess', () => {
  it('PUBLIC は誰でもアクセス可', () => {
    expect(canAccess(undefined, 'PUBLIC')).toBe(true);
    expect(canAccess(null, 'PUBLIC')).toBe(true);
    expect(canAccess('FREE', 'PUBLIC')).toBe(true);
    expect(canAccess('STANDARD', 'PUBLIC')).toBe(true);
    expect(canAccess('PREMIUM', 'PUBLIC')).toBe(true);
  });

  it('FREE_MEMBERS はログインしていれば無料プランでも可', () => {
    expect(canAccess('FREE', 'FREE_MEMBERS')).toBe(true);
    expect(canAccess('STANDARD', 'FREE_MEMBERS')).toBe(true);
    expect(canAccess('PREMIUM', 'FREE_MEMBERS')).toBe(true);
  });

  it('FREE_MEMBERS は未ログインを弾く（PUBLIC との違い）', () => {
    expect(canAccess(undefined, 'FREE_MEMBERS')).toBe(false);
    expect(canAccess(null, 'FREE_MEMBERS')).toBe(false);
  });

  it('MEMBERS は STANDARD 以上のみ', () => {
    expect(canAccess(undefined, 'MEMBERS')).toBe(false);
    expect(canAccess('FREE', 'MEMBERS')).toBe(false);
    expect(canAccess('STANDARD', 'MEMBERS')).toBe(true);
    expect(canAccess('PREMIUM', 'MEMBERS')).toBe(true);
  });

  it('PREMIUM は PREMIUM のみ', () => {
    expect(canAccess(undefined, 'PREMIUM')).toBe(false);
    expect(canAccess('FREE', 'PREMIUM')).toBe(false);
    expect(canAccess('STANDARD', 'PREMIUM')).toBe(false);
    expect(canAccess('PREMIUM', 'PREMIUM')).toBe(true);
  });
});

describe('canUseShop', () => {
  it('無料会員 (FREE) と未認証は物販を利用できない', () => {
    expect(canUseShop(undefined)).toBe(false);
    expect(canUseShop(null)).toBe(false);
    expect(canUseShop('FREE')).toBe(false);
  });

  it('スタンダード以上は物販を利用できる', () => {
    expect(canUseShop('STANDARD')).toBe(true);
    expect(canUseShop('PREMIUM')).toBe(true);
  });
});

describe('planRank / requiredPlanLabel', () => {
  it('プランの順位', () => {
    expect(planRank('FREE')).toBeLessThan(planRank('STANDARD'));
    expect(planRank('STANDARD')).toBeLessThan(planRank('PREMIUM'));
  });
  it('ラベル変換', () => {
    expect(requiredPlanLabel('MEMBERS')).toBe('スタンダード');
    expect(requiredPlanLabel('PREMIUM')).toBe('プレミアム');
  });
  it('FREE_MEMBERS は有料プラン不要なので「無料」', () => {
    expect(requiredPlanLabel('FREE_MEMBERS')).toBe('無料');
    expect(requiredPlanLabel('PUBLIC')).toBe('無料');
  });
});

describe('requiresSignInForAccess', () => {
  it('PUBLIC だけログイン不要', () => {
    expect(requiresSignInForAccess('PUBLIC')).toBe(false);
    expect(requiresSignInForAccess('FREE_MEMBERS')).toBe(true);
    expect(requiresSignInForAccess('MEMBERS')).toBe(true);
    expect(requiresSignInForAccess('PREMIUM')).toBe(true);
  });
});

describe('accessLevelRank', () => {
  it('緩い順に単調増加する', () => {
    expect(accessLevelRank('PUBLIC')).toBeLessThan(accessLevelRank('FREE_MEMBERS'));
    expect(accessLevelRank('FREE_MEMBERS')).toBeLessThan(accessLevelRank('MEMBERS'));
    expect(accessLevelRank('MEMBERS')).toBeLessThan(accessLevelRank('PREMIUM'));
  });

  it('ACCESS_LEVELS の並び順と一致する（select の選択肢順の根拠）', () => {
    const ranks = ACCESS_LEVELS.map((l) => accessLevelRank(l));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('公開範囲ラベル', () => {
  it('4 段階すべてにラベルがある', () => {
    expect(ACCESS_LEVELS).toEqual(['PUBLIC', 'FREE_MEMBERS', 'MEMBERS', 'PREMIUM']);
    for (const level of ACCESS_LEVELS) {
      expect(ACCESS_LEVEL_LABELS[level]).toBeTruthy();
    }
  });

  it('ユーザーが指定した表記どおりであること', () => {
    expect(accessLevelLabel('PUBLIC')).toBe('だれでも');
    expect(accessLevelLabel('FREE_MEMBERS')).toBe('無料会員以上');
    expect(accessLevelLabel('MEMBERS')).toBe('会員限定');
    expect(accessLevelLabel('PREMIUM')).toBe('プレミアム限定');
  });

  it('未知の値はそのまま返す（DB に想定外の値が入っても画面が壊れない）', () => {
    expect(accessLevelLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('accessibleLevels', () => {
  it('未ログインは PUBLIC のみ', () => {
    expect(accessibleLevels(undefined)).toEqual(['PUBLIC']);
    expect(accessibleLevels(null)).toEqual(['PUBLIC']);
  });

  it('無料会員は PUBLIC と FREE_MEMBERS まで', () => {
    expect(accessibleLevels('FREE')).toEqual(['PUBLIC', 'FREE_MEMBERS']);
  });

  it('スタンダードは MEMBERS まで', () => {
    expect(accessibleLevels('STANDARD')).toEqual(['PUBLIC', 'FREE_MEMBERS', 'MEMBERS']);
  });

  it('プレミアムはすべて見られる', () => {
    expect(accessibleLevels('PREMIUM')).toEqual([...ACCESS_LEVELS]);
  });

  it('canAccess と結果が完全に一致する（一覧クエリと再生判定がズレない）', () => {
    for (const plan of [undefined, 'FREE', 'STANDARD', 'PREMIUM'] as const) {
      const allowed = accessibleLevels(plan);
      for (const level of ACCESS_LEVELS) {
        expect(allowed.includes(level)).toBe(canAccess(plan, level));
      }
    }
  });
});

describe('公開範囲とプランの整合性（回帰防止）', () => {
  const plans = [undefined, 'FREE', 'STANDARD', 'PREMIUM'] as const;

  it('公開範囲を厳しくすると、閲覧できる人は増えない', () => {
    for (const plan of plans) {
      for (let i = 0; i < ACCESS_LEVELS.length - 1; i++) {
        const looser = ACCESS_LEVELS[i]!;
        const tighter = ACCESS_LEVELS[i + 1]!;
        if (canAccess(plan, tighter)) {
          expect(canAccess(plan, looser)).toBe(true);
        }
      }
    }
  });
});
