import {
  contentStatusLabel,
  isContentPublished,
  isContentScheduled,
  publishedContentWhere,
} from './content-visibility';

const NOW = new Date('2026-09-06T12:00:00.000Z');
const PAST = new Date('2026-09-01T00:00:00.000Z');
const FUTURE = new Date('2026-12-31T00:00:00.000Z');

describe('isContentPublished', () => {
  it('PUBLISHED + 過去日時 は公開', () => {
    expect(isContentPublished({ status: 'PUBLISHED', publishedAt: PAST }, NOW)).toBe(true);
  });

  it('PUBLISHED + 未来日時 は非公開 (公開予約)', () => {
    // これが今回の中心。以前は publishedAt を見ていなかったため
    // 未来日時を入れても即座に公開されていた。
    expect(isContentPublished({ status: 'PUBLISHED', publishedAt: FUTURE }, NOW)).toBe(false);
  });

  it('publishedAt がちょうど今なら公開 (境界は公開側に含める)', () => {
    expect(isContentPublished({ status: 'PUBLISHED', publishedAt: NOW }, NOW)).toBe(true);
  });

  it('1 ミリ秒でも未来なら非公開', () => {
    const just = new Date(NOW.getTime() + 1);
    expect(isContentPublished({ status: 'PUBLISHED', publishedAt: just }, NOW)).toBe(false);
  });

  it('publishedAt が null なら公開 (既存データを消さないため)', () => {
    // 過去のデータには status=PUBLISHED かつ publishedAt=null の行が存在しうる。
    // これを非公開にすると、変更を入れた瞬間に既存記事が一斉に消える。
    expect(isContentPublished({ status: 'PUBLISHED', publishedAt: null }, NOW)).toBe(true);
  });

  it('DRAFT は日時に関係なく非公開', () => {
    expect(isContentPublished({ status: 'DRAFT', publishedAt: PAST }, NOW)).toBe(false);
    expect(isContentPublished({ status: 'DRAFT', publishedAt: null }, NOW)).toBe(false);
  });

  it('ARCHIVED は日時に関係なく非公開', () => {
    expect(isContentPublished({ status: 'ARCHIVED', publishedAt: PAST }, NOW)).toBe(false);
  });

  it('未知の status は非公開 (安全側に倒す)', () => {
    expect(isContentPublished({ status: 'UNKNOWN', publishedAt: PAST }, NOW)).toBe(false);
  });
});

describe('isContentScheduled', () => {
  it('PUBLISHED + 未来日時 は予約中', () => {
    expect(isContentScheduled({ status: 'PUBLISHED', publishedAt: FUTURE }, NOW)).toBe(true);
  });

  it('PUBLISHED + 過去日時 は予約中でない (公開済み)', () => {
    expect(isContentScheduled({ status: 'PUBLISHED', publishedAt: PAST }, NOW)).toBe(false);
  });

  it('publishedAt が null なら予約中でない', () => {
    expect(isContentScheduled({ status: 'PUBLISHED', publishedAt: null }, NOW)).toBe(false);
  });

  it('DRAFT は未来日時でも予約中でない (公開予約は PUBLISHED のみ)', () => {
    // DRAFT のまま日時だけ入れて «公開したつもり» になる事故を防ぐため、
    // 予約は status=PUBLISHED を必須にしている。
    expect(isContentScheduled({ status: 'DRAFT', publishedAt: FUTURE }, NOW)).toBe(false);
  });

  it('公開中と予約中は同時に成立しない', () => {
    for (const at of [PAST, FUTURE, NOW, null]) {
      const c = { status: 'PUBLISHED', publishedAt: at };
      expect(isContentPublished(c, NOW) && isContentScheduled(c, NOW)).toBe(false);
    }
  });
});

describe('publishedContentWhere', () => {
  it('status=PUBLISHED を含む', () => {
    expect(publishedContentWhere(NOW).status).toBe('PUBLISHED');
  });

  it('publishedAt が null または now 以下 の OR 条件になる', () => {
    const w = publishedContentWhere(NOW);
    expect(w.OR).toEqual([{ publishedAt: null }, { publishedAt: { lte: NOW } }]);
  });

  it('null を含める (isContentPublished と同じ扱いにする)', () => {
    // where と純粋関数で扱いが違うと「一覧に出るのに詳細が 404」になる
    const w = publishedContentWhere(NOW);
    expect(w.OR.some((o) => 'publishedAt' in o && o.publishedAt === null)).toBe(true);
  });
});

describe('contentStatusLabel', () => {
  it('下書き', () => {
    expect(contentStatusLabel({ status: 'DRAFT', publishedAt: null }, NOW)).toBe('下書き');
  });

  it('アーカイブ', () => {
    expect(contentStatusLabel({ status: 'ARCHIVED', publishedAt: PAST }, NOW)).toBe('アーカイブ');
  });

  it('公開 (過去日時)', () => {
    expect(contentStatusLabel({ status: 'PUBLISHED', publishedAt: PAST }, NOW)).toBe('公開');
  });

  it('公開 (日時未設定)', () => {
    expect(contentStatusLabel({ status: 'PUBLISHED', publishedAt: null }, NOW)).toBe('公開');
  });

  it('公開予約 (未来日時) — status だけ見て「公開」と出さない', () => {
    // 予約中を «公開» と表示すると、運営が «もう出ているはず» と誤解する
    expect(contentStatusLabel({ status: 'PUBLISHED', publishedAt: FUTURE }, NOW)).toBe('公開予約');
  });
});
