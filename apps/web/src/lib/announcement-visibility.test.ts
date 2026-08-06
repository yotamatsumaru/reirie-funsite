import {
  resolveAnnouncementVisibility,
  canPreviewAnnouncements,
  type ViewerContext,
} from './announcement-visibility';

/** テスト用の閲覧者ファクトリ */
const guest: ViewerContext = { isLoggedIn: false, role: null, plan: null };
const freeMember: ViewerContext = { isLoggedIn: true, role: 'USER', plan: 'FREE' };
const standardMember: ViewerContext = {
  isLoggedIn: true,
  role: 'USER',
  plan: 'STANDARD',
};
const premiumMember: ViewerContext = {
  isLoggedIn: true,
  role: 'USER',
  plan: 'PREMIUM',
};
const contentAdmin: ViewerContext = { isLoggedIn: true, role: 'ADMIN', plan: 'FREE' };
const staff: ViewerContext = { isLoggedIn: true, role: 'STAFF', plan: 'FREE' };
const superAdmin: ViewerContext = {
  isLoggedIn: true,
  role: 'SUPER_ADMIN',
  plan: 'FREE',
};

describe('canPreviewAnnouncements', () => {
  it.each([
    ['SUPER_ADMIN', 'SUPER_ADMIN', true],
    ['STAFF', 'STAFF', true],
    ['ADMIN (運営編集者) は不可', 'ADMIN', false],
    ['USER は不可', 'USER', false],
  ] as const)('%s', (_label, role, expected) => {
    expect(canPreviewAnnouncements(role)).toBe(expected);
  });

  it('未ログイン (undefined / null) は不可', () => {
    expect(canPreviewAnnouncements(undefined)).toBe(false);
    expect(canPreviewAnnouncements(null)).toBe(false);
  });
});

describe('resolveAnnouncementVisibility — 下書き (DRAFT)', () => {
  const draft = { status: 'DRAFT' as const, audience: 'ALL' as const };

  /**
   * 🔒 最重要のセキュリティ要件。
   * 「他の人には見られないようにしたい」を機械的に保証する。
   */
  describe('運営以外には絶対に見えない (preview 要求の有無に関わらず)', () => {
    it.each([
      ['未ログイン', guest],
      ['FREE 会員', freeMember],
      ['STANDARD 会員', standardMember],
      ['PREMIUM 会員', premiumMember],
      ['ADMIN (運営編集者)', contentAdmin],
    ] as const)('%s は preview=1 を付けても 404', (_label, viewer) => {
      expect(resolveAnnouncementVisibility(draft, viewer, true)).toEqual({
        kind: 'not-found',
      });
      expect(resolveAnnouncementVisibility(draft, viewer, false)).toEqual({
        kind: 'not-found',
      });
    });
  });

  it('SUPER_ADMIN が preview=1 を付けたときだけプレビューできる', () => {
    expect(resolveAnnouncementVisibility(draft, superAdmin, true)).toEqual({
      kind: 'preview',
    });
  });

  it('STAFF も preview=1 でプレビューできる (閲覧のみの運営)', () => {
    expect(resolveAnnouncementVisibility(draft, staff, true)).toEqual({
      kind: 'preview',
    });
  });

  it('運営でも preview=1 が無ければ 404 (URL 誤共有時の混乱を防ぐ)', () => {
    expect(resolveAnnouncementVisibility(draft, superAdmin, false)).toEqual({
      kind: 'not-found',
    });
    expect(resolveAnnouncementVisibility(draft, staff, false)).toEqual({
      kind: 'not-found',
    });
  });

  it('下書きプレビューでは audience 制限を無視する', () => {
    // FREE プランの SUPER_ADMIN でも PREMIUM 限定の下書きを確認できる
    const premiumDraft = { status: 'DRAFT' as const, audience: 'PREMIUM' as const };
    expect(resolveAnnouncementVisibility(premiumDraft, superAdmin, true)).toEqual({
      kind: 'preview',
    });

    const membersDraft = { status: 'DRAFT' as const, audience: 'MEMBERS' as const };
    expect(resolveAnnouncementVisibility(membersDraft, superAdmin, true)).toEqual({
      kind: 'preview',
    });
  });

  it('下書きは 403 ではなく 404 にする (ID の存在を漏らさない)', () => {
    const d = resolveAnnouncementVisibility(draft, freeMember, true);
    expect(d.kind).toBe('not-found');
    // 「権限がありません」系の応答を返していないこと
    expect(d.kind).not.toBe('signin-required');
    expect(d.kind).not.toBe('upgrade-required');
  });
});

describe('resolveAnnouncementVisibility — 公開済み (PUBLISHED)', () => {
  describe('audience=ALL は誰でも見られる', () => {
    const a = { status: 'PUBLISHED' as const, audience: 'ALL' as const };
    it.each([
      ['未ログイン', guest],
      ['FREE 会員', freeMember],
      ['PREMIUM 会員', premiumMember],
      ['SUPER_ADMIN', superAdmin],
    ] as const)('%s', (_label, viewer) => {
      expect(resolveAnnouncementVisibility(a, viewer)).toEqual({ kind: 'visible' });
    });
  });

  describe('audience=MEMBERS はログインが必要', () => {
    const a = { status: 'PUBLISHED' as const, audience: 'MEMBERS' as const };

    it('未ログインはサインインへ', () => {
      expect(resolveAnnouncementVisibility(a, guest)).toEqual({
        kind: 'signin-required',
      });
    });

    it('FREE 会員でもログインしていれば見られる', () => {
      expect(resolveAnnouncementVisibility(a, freeMember)).toEqual({
        kind: 'visible',
      });
    });
  });

  describe('audience=PREMIUM は PREMIUM プランが必要', () => {
    const a = { status: 'PUBLISHED' as const, audience: 'PREMIUM' as const };

    it('PREMIUM 会員は見られる', () => {
      expect(resolveAnnouncementVisibility(a, premiumMember)).toEqual({
        kind: 'visible',
      });
    });

    it.each([
      ['FREE 会員', freeMember],
      ['STANDARD 会員', standardMember],
    ] as const)('%s はアップグレード案内', (_label, viewer) => {
      expect(resolveAnnouncementVisibility(a, viewer)).toEqual({
        kind: 'upgrade-required',
      });
    });

    it('未ログインもアップグレード案内 (存在自体は公開済みなので隠さない)', () => {
      expect(resolveAnnouncementVisibility(a, guest)).toEqual({
        kind: 'upgrade-required',
      });
    });

    it('運営は自分が FREE プランでも確認できる (サポート対応用)', () => {
      expect(resolveAnnouncementVisibility(a, superAdmin)).toEqual({
        kind: 'visible',
      });
      expect(resolveAnnouncementVisibility(a, staff)).toEqual({ kind: 'visible' });
    });

    it('ADMIN (運営編集者) は特別扱いしない', () => {
      expect(resolveAnnouncementVisibility(a, contentAdmin)).toEqual({
        kind: 'upgrade-required',
      });
    });
  });

  it('公開済みなら preview=1 が付いていても通常表示 (preview 扱いにしない)', () => {
    const a = { status: 'PUBLISHED' as const, audience: 'ALL' as const };
    expect(resolveAnnouncementVisibility(a, superAdmin, true)).toEqual({
      kind: 'visible',
    });
    // 公開済みに preview バナーが出てしまうと運営が混乱する
    expect(resolveAnnouncementVisibility(a, superAdmin, true).kind).not.toBe(
      'preview',
    );
  });
});

describe('網羅: 下書きが visible になる組み合わせは存在しない', () => {
  const viewers = [
    guest,
    freeMember,
    standardMember,
    premiumMember,
    contentAdmin,
    staff,
    superAdmin,
  ];
  const audiences = ['ALL', 'MEMBERS', 'PREMIUM'] as const;

  it('DRAFT の判定結果は preview か not-found のみ', () => {
    for (const viewer of viewers) {
      for (const audience of audiences) {
        for (const previewRequested of [true, false]) {
          const d = resolveAnnouncementVisibility(
            { status: 'DRAFT', audience },
            viewer,
            previewRequested,
          );
          expect(['preview', 'not-found']).toContain(d.kind);
          // 一般ユーザーに preview が返らないこと
          if (d.kind === 'preview') {
            expect(canPreviewAnnouncements(viewer.role)).toBe(true);
          }
        }
      }
    }
  });
});
