/**
 * DM (REIRIE への DM) 純粋ロジックの単体テスト
 */
import {
  normalizeNgWords,
  findNgWords,
  containsNgWord,
  resolvePreferredName,
  expandMentions,
  checkDirectMessage,
  DirectMessageBodySchema,
  PreferredNameSchema,
  DEFAULT_DM_NG_WORDS,
  DM_MAX_LENGTH,
  PREFERRED_NAME_MAX_LENGTH,
} from './dm';

describe('normalizeNgWords', () => {
  it('前後空白除去・空文字除去・重複除去', () => {
    expect(normalizeNgWords([' シネ ', 'シネ', '', '  ', '死ね'])).toEqual(['シネ', '死ね']);
  });
  it('大文字小文字違いは重複とみなす', () => {
    expect(normalizeNgWords(['BAD', 'bad', 'Bad'])).toEqual(['BAD']);
  });
});

describe('findNgWords / containsNgWord (部分一致)', () => {
  const ng = ['シネ', '死ね'];

  it('「シネマ」は NG 語「シネ」を含むのでヒットする', () => {
    expect(findNgWords('今日シネマに行く', ng)).toEqual(['シネ']);
    expect(containsNgWord('今日シネマに行く', ng)).toBe(true);
  });

  it('NG 語そのものもヒット', () => {
    expect(containsNgWord('死ね', ng)).toBe(true);
  });

  it('NG 語を含まなければヒットしない', () => {
    expect(findNgWords('こんにちは、応援しています!', ng)).toEqual([]);
    expect(containsNgWord('こんにちは、応援しています!', ng)).toBe(false);
  });

  it('英語 NG 語は大文字小文字を区別しない', () => {
    expect(containsNgWord('You are STUPID', ['stupid'])).toBe(true);
  });

  it('複数ヒットを全て返す', () => {
    expect(findNgWords('シネマで死ね', ng).sort()).toEqual(['シネ', '死ね'].sort());
  });
});

describe('resolvePreferredName', () => {
  it('preferredName を最優先', () => {
    expect(resolvePreferredName('れいちゃん推し', 'taro')).toBe('れいちゃん推し');
  });
  it('preferredName が空なら displayName', () => {
    expect(resolvePreferredName('  ', 'taro')).toBe('taro');
    expect(resolvePreferredName(null, 'taro')).toBe('taro');
  });
  it('どちらも空ならフォールバック', () => {
    expect(resolvePreferredName(null, null)).toBe('あなた');
    expect(resolvePreferredName('', '', 'ファン')).toBe('ファン');
  });
});

describe('expandMentions', () => {
  it('裸の @ を名前に展開', () => {
    expect(expandMentions('こんにちは @ です', 'れいちゃん推し')).toBe(
      'こんにちは れいちゃん推し です',
    );
  });
  it('複数の @ をすべて展開', () => {
    expect(expandMentions('@ と @ より', 'たろう')).toBe('たろう と たろう より');
  });
  it('@ が無ければそのまま', () => {
    expect(expandMentions('応援してます!', 'たろう')).toBe('応援してます!');
  });
  it('名前が空ならフォールバック', () => {
    expect(expandMentions('@ より', '')).toBe('あなた より');
  });
});

describe('checkDirectMessage', () => {
  const ng = DEFAULT_DM_NG_WORDS;

  it('正常: @ 展開後の本文を返す', () => {
    const r = checkDirectMessage('@ から応援!', 'れい', ng);
    expect(r).toEqual({ ok: true, body: 'れい から応援!' });
  });

  it('空 (空白のみ) は EMPTY', () => {
    expect(checkDirectMessage('   ', 'れい', ng)).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('長すぎる本文は TOO_LONG', () => {
    const long = 'あ'.repeat(DM_MAX_LENGTH + 1);
    expect(checkDirectMessage(long, 'れい', ng)).toEqual({ ok: false, reason: 'TOO_LONG' });
  });

  it('NG ワードを含むと NG_WORD + ヒット語', () => {
    const r = checkDirectMessage('今日シネマ行く', 'れい', ['シネ']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('NG_WORD');
      expect(r.ngWords).toEqual(['シネ']);
    }
  });

  it('@ 展開後の本文に対して NG 判定する', () => {
    // 名前自体に NG 語が含まれていてもチェック対象になる
    const r = checkDirectMessage('@ だよ', 'シネマ好き', ['シネ']);
    expect(r.ok).toBe(false);
  });
});

describe('DirectMessageBodySchema', () => {
  it('trim される', () => {
    expect(DirectMessageBodySchema.parse('  こんにちは  ')).toBe('こんにちは');
  });
  it('空はエラー', () => {
    expect(() => DirectMessageBodySchema.parse('   ')).toThrow();
  });
  it('上限超過はエラー', () => {
    expect(() => DirectMessageBodySchema.parse('あ'.repeat(DM_MAX_LENGTH + 1))).toThrow();
  });
});

describe('PreferredNameSchema', () => {
  it('正常な名前', () => {
    expect(PreferredNameSchema.parse(' れいちゃん推し ')).toBe('れいちゃん推し');
  });
  it('空文字は許可 (解除)', () => {
    expect(PreferredNameSchema.parse('')).toBe('');
  });
  it('@ を含むとエラー', () => {
    expect(() => PreferredNameSchema.parse('@たろう')).toThrow();
  });
  it('長すぎるとエラー', () => {
    expect(() => PreferredNameSchema.parse('あ'.repeat(PREFERRED_NAME_MAX_LENGTH + 1))).toThrow();
  });
});
