import {
  slugifyTitle,
  fallbackSlug,
  suggestSlug,
  validateSlug,
  SLUG_PATTERN,
  MAX_SLUG_LENGTH,
} from './content-slug';

describe('slugifyTitle', () => {
  it('英語タイトルを slug 化する', () => {
    expect(slugifyTitle('New Single Release')).toBe('new-single-release');
  });

  it('記号は区切りとして扱う（単語がくっつかない）', () => {
    // 旧実装は記号を削除していたため "REIRIE/LIVE" が "reirielive" になっていた
    expect(slugifyTitle('REIRIE/LIVE')).toBe('reirie-live');
  });

  it('連続ハイフン・前後のハイフンを潰す', () => {
    expect(slugifyTitle('  --Hello---World--  ')).toBe('hello-world');
  });

  it('日本語のみのタイトルは空文字になる', () => {
    expect(slugifyTitle('新曲リリースのお知らせ')).toBe('');
  });

  it('日本語と英語の混在では英語部分が残る', () => {
    expect(slugifyTitle('新曲 Summer Days リリース')).toBe('summer-days');
  });

  it('長すぎるタイトルは切り詰め、末尾ハイフンを残さない', () => {
    const long = 'a'.repeat(200);
    const slug = slugifyTitle(long);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('fallbackSlug', () => {
  it('日付とランダム接尾辞から slug を作る', () => {
    expect(fallbackSlug(new Date(2026, 7, 28), 'a1b2')).toBe('post-20260828-a1b2');
  });

  it('月日はゼロ埋めする', () => {
    expect(fallbackSlug(new Date(2026, 0, 5), '0000')).toBe('post-20260105-0000');
  });

  it('生成された slug は必ず slug 形式を満たす', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(SLUG_PATTERN.test(fallbackSlug())).toBe(true);
    }
  });
});

describe('suggestSlug', () => {
  it('英語タイトルはそのまま slug 化する', () => {
    expect(suggestSlug('Summer Live 2026')).toBe('summer-live-2026');
  });

  it('日本語タイトルでも空にならず日付ベースの候補を返す', () => {
    // これが本来の修正点: 日本語タイトルで slug が空になり保存できなかった
    expect(suggestSlug('新曲リリースのお知らせ', new Date(2026, 7, 28), 'abcd')).toBe(
      'post-20260828-abcd',
    );
  });

  it('どんなタイトルでも有効な slug を返す', () => {
    const titles = ['', '   ', '！！！', '春のライブ', 'Hello', '2026'];
    for (const t of titles) {
      expect(validateSlug(suggestSlug(t)).ok).toBe(true);
    }
  });
});

describe('validateSlug', () => {
  it('正しい slug を許可する', () => {
    expect(validateSlug('new-single-2026')).toEqual({ ok: true });
  });

  it('空文字を拒否する', () => {
    const r = validateSlug('');
    expect(r.ok).toBe(false);
  });

  it('日本語を含む slug を拒否し、自動生成を案内する', () => {
    const r = validateSlug('新曲');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('自動生成');
  });

  it('大文字を拒否する', () => {
    expect(validateSlug('New-Single').ok).toBe(false);
  });

  it('スペースを拒否する', () => {
    expect(validateSlug('new single').ok).toBe(false);
  });

  it('長さ上限ちょうどは許可する（境界）', () => {
    expect(validateSlug('a'.repeat(MAX_SLUG_LENGTH)).ok).toBe(true);
  });

  it('長さ上限を超えたら拒否する（境界）', () => {
    const r = validateSlug('a'.repeat(MAX_SLUG_LENGTH + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(String(MAX_SLUG_LENGTH));
  });
});
