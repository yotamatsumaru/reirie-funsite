import {
  countHiddenNotices,
  filterVisibleNotices,
  isNoticeVisibleInList,
  type NoticeListItem,
  type NoticeViewer,
} from './api-notice-list';
import type { AnnouncementAudienceLiteral } from './announcement-audience';

const n = (
  audience: AnnouncementAudienceLiteral,
  status: string = 'PUBLISHED',
): NoticeListItem => ({ audience, status });

const guest: NoticeViewer = { isLoggedIn: false, plan: undefined };
const free: NoticeViewer = { isLoggedIn: true, plan: 'FREE' };
const standard: NoticeViewer = { isLoggedIn: true, plan: 'STANDARD' };
const premium: NoticeViewer = { isLoggedIn: true, plan: 'PREMIUM' };

describe('isNoticeVisibleInList — 下書きの扱い', () => {
  it('下書きは誰にも一覧に出さない', () => {
    // 一覧に下書きが混ざると「公開したつもりのもの」と区別できなくなる。
    // 運営のプレビューは詳細ページ (?preview=1) の役割。
    for (const viewer of [guest, free, standard, premium]) {
      expect(isNoticeVisibleInList(n('ALL', 'DRAFT'), viewer)).toBe(false);
    }
  });

  it('未知のステータスも一覧に出さない（既定で隠す）', () => {
    expect(isNoticeVisibleInList(n('ALL', 'SCHEDULED'), premium)).toBe(false);
  });
});

describe('isNoticeVisibleInList — audience ごとの可否', () => {
  it('ALL は未ログインでも見える', () => {
    expect(isNoticeVisibleInList(n('ALL'), guest)).toBe(true);
  });

  it('MEMBERS は未ログインには見えず、無料会員には見える', () => {
    expect(isNoticeVisibleInList(n('MEMBERS'), guest)).toBe(false);
    expect(isNoticeVisibleInList(n('MEMBERS'), free)).toBe(true);
  });

  it('STANDARD は無料会員には見えず、スタンダード以上に見える', () => {
    expect(isNoticeVisibleInList(n('STANDARD'), free)).toBe(false);
    expect(isNoticeVisibleInList(n('STANDARD'), standard)).toBe(true);
    expect(isNoticeVisibleInList(n('STANDARD'), premium)).toBe(true);
  });

  it('PREMIUM はプレミアムのみ', () => {
    expect(isNoticeVisibleInList(n('PREMIUM'), guest)).toBe(false);
    expect(isNoticeVisibleInList(n('PREMIUM'), free)).toBe(false);
    expect(isNoticeVisibleInList(n('PREMIUM'), standard)).toBe(false);
    expect(isNoticeVisibleInList(n('PREMIUM'), premium)).toBe(true);
  });

  it('上位プランは下位向けのお知らせも見える', () => {
    expect(isNoticeVisibleInList(n('ALL'), premium)).toBe(true);
    expect(isNoticeVisibleInList(n('MEMBERS'), premium)).toBe(true);
    expect(isNoticeVisibleInList(n('STANDARD'), premium)).toBe(true);
  });

  it('ログイン済みでも plan が無いユーザーは限定お知らせを見られない', () => {
    // セッションに plan が乗らない異常時に «限定が漏れる» 方向へ倒れないこと。
    const noPlan: NoticeViewer = { isLoggedIn: true, plan: null };
    expect(isNoticeVisibleInList(n('ALL'), noPlan)).toBe(true);
    expect(isNoticeVisibleInList(n('MEMBERS'), noPlan)).toBe(false);
    expect(isNoticeVisibleInList(n('PREMIUM'), noPlan)).toBe(false);
  });
});

describe('filterVisibleNotices', () => {
  const all = [n('ALL'), n('MEMBERS'), n('STANDARD'), n('PREMIUM'), n('ALL', 'DRAFT')];

  it('未ログインには ALL のみ', () => {
    expect(filterVisibleNotices(all, guest)).toEqual([n('ALL')]);
  });

  it('無料会員には ALL と MEMBERS', () => {
    expect(filterVisibleNotices(all, free)).toEqual([n('ALL'), n('MEMBERS')]);
  });

  it('プレミアムには下書き以外すべて', () => {
    expect(filterVisibleNotices(all, premium)).toHaveLength(4);
  });

  it('並び順を変えない（呼び出し側が新しい順で渡す）', () => {
    const ordered = [
      { audience: 'ALL' as const, status: 'PUBLISHED', id: '1' },
      { audience: 'ALL' as const, status: 'PUBLISHED', id: '2' },
      { audience: 'ALL' as const, status: 'PUBLISHED', id: '3' },
    ];
    expect(filterVisibleNotices(ordered, guest).map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('空配列なら空配列', () => {
    expect(filterVisibleNotices([], premium)).toEqual([]);
  });
});

describe('countHiddenNotices', () => {
  const all = [n('ALL'), n('MEMBERS'), n('STANDARD'), n('PREMIUM')];

  it('未ログインは 3 件が非表示', () => {
    expect(countHiddenNotices(all, guest)).toBe(3);
  });

  it('無料会員は 2 件が非表示', () => {
    expect(countHiddenNotices(all, free)).toBe(2);
  });

  it('プレミアムは非表示 0 件', () => {
    expect(countHiddenNotices(all, premium)).toBe(0);
  });

  it('下書きは «非表示» に数えない', () => {
    // 下書きは会員向けに存在しないものなので、
    // 「あと N 件読める」という案内に含めると誤解を招く。
    expect(countHiddenNotices([n('ALL'), n('PREMIUM', 'DRAFT')], guest)).toBe(0);
  });

  it('表示件数 + 非表示件数 = 公開件数 になる', () => {
    for (const viewer of [guest, free, standard, premium]) {
      const visible = filterVisibleNotices(all, viewer).length;
      expect(visible + countHiddenNotices(all, viewer)).toBe(all.length);
    }
  });
});
