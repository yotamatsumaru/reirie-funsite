/**
 * サイトセクション公開設定 (とくにゲームの公開/非公開) の回帰テスト。
 *
 * 【このテストが守っている仕様】
 *  1. 既定ではゲームは公開 (未設定の本番 DB で勝手に非公開にならない)
 *  2. 非公開にすると一般会員・未ログインには見えない
 *  3. 非公開でも管理者は見える (開発中の動作確認のため)
 *  4. 部分更新でゲームを非公開にしても、他セクションが公開に戻らない
 *     (SiteSectionVisibilitySchema に .default() を付けた場合に起きるバグ)
 */
import {
  SiteSectionVisibilitySchema,
  DEFAULT_SITE_SECTION_VISIBILITY,
  canViewGameSection,
  isGameSectionPreview,
  type SiteSectionVisibility,
} from './site-section-visibility';

describe('DEFAULT_SITE_SECTION_VISIBILITY', () => {
  it('ゲームの既定は「公開」である（既存サイトが勝手に非公開にならない）', () => {
    expect(DEFAULT_SITE_SECTION_VISIBILITY.gamesVisible).toBe(true);
  });

  it('すべてのセクションの既定は公開である', () => {
    expect(DEFAULT_SITE_SECTION_VISIBILITY).toEqual({
      contentsVisible: true,
      productsVisible: true,
      dmVisible: true,
      gamesVisible: true,
    });
  });
});

describe('SiteSectionVisibilitySchema', () => {
  it('gamesVisible を含む完全な値を受け付ける', () => {
    const parsed = SiteSectionVisibilitySchema.parse({
      contentsVisible: true,
      productsVisible: false,
      dmVisible: true,
      gamesVisible: false,
    });
    expect(parsed.gamesVisible).toBe(false);
  });

  it('gamesVisible が欠けている場合は不正としてはじく（既定値での補完は呼び出し側の責務）', () => {
    const result = SiteSectionVisibilitySchema.safeParse({
      contentsVisible: true,
      productsVisible: true,
      dmVisible: true,
    });
    expect(result.success).toBe(false);
  });

  it('gamesVisible が真偽値でない場合ははじく', () => {
    const result = SiteSectionVisibilitySchema.safeParse({
      ...DEFAULT_SITE_SECTION_VISIBILITY,
      gamesVisible: 'false',
    });
    expect(result.success).toBe(false);
  });

  /**
   * 【重要な回帰テスト】
   * スキーマに .default(true) を付けると、`.partial()` した PATCH で
   * 「送られなかったフィールド」まで true に戻ってしまう。
   * (= ゲームを非公開にしたらコンテンツが公開に戻る、という事故)
   */
  it('部分更新でゲームだけ非公開にしても、他セクションの状態が巻き戻らない', () => {
    const before: SiteSectionVisibility = {
      contentsVisible: false,
      productsVisible: false,
      dmVisible: false,
      gamesVisible: true,
    };
    const patch = SiteSectionVisibilitySchema.partial().parse({ gamesVisible: false });
    const after = SiteSectionVisibilitySchema.parse({ ...before, ...patch });

    expect(after).toEqual({
      contentsVisible: false,
      productsVisible: false,
      dmVisible: false,
      gamesVisible: false,
    });
  });

  it('部分更新で他セクションを変更しても、ゲームの非公開状態が維持される', () => {
    const before: SiteSectionVisibility = {
      ...DEFAULT_SITE_SECTION_VISIBILITY,
      gamesVisible: false,
    };
    const patch = SiteSectionVisibilitySchema.partial().parse({ contentsVisible: false });
    const after = SiteSectionVisibilitySchema.parse({ ...before, ...patch });

    expect(after.gamesVisible).toBe(false);
    expect(after.contentsVisible).toBe(false);
  });

  it('空の部分更新はすべての値を維持する', () => {
    const before: SiteSectionVisibility = {
      ...DEFAULT_SITE_SECTION_VISIBILITY,
      gamesVisible: false,
    };
    const patch = SiteSectionVisibilitySchema.partial().parse({});
    expect(SiteSectionVisibilitySchema.parse({ ...before, ...patch })).toEqual(before);
  });
});

describe('canViewGameSection (公開中)', () => {
  it.each([
    ['未ログイン', undefined],
    ['null', null],
    ['USER', 'USER'],
    ['STAFF', 'STAFF'],
    ['ADMIN', 'ADMIN'],
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
  ] as const)('公開中は %s でも閲覧できる', (_label, role) => {
    expect(canViewGameSection(true, role)).toBe(true);
  });

  it('公開中はプレビュー扱いにならない（警告バナーを出さない）', () => {
    expect(isGameSectionPreview(true, 'SUPER_ADMIN')).toBe(false);
    expect(isGameSectionPreview(true, 'USER')).toBe(false);
  });
});

describe('canViewGameSection (非公開中)', () => {
  it.each([
    ['未ログイン', undefined],
    ['null', null],
    ['一般会員 (USER)', 'USER'],
  ] as const)('非公開中は %s は閲覧できない', (_label, role) => {
    expect(canViewGameSection(false, role)).toBe(false);
  });

  it.each([
    ['ADMIN', 'ADMIN'],
    ['STAFF', 'STAFF'],
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
  ] as const)('非公開中でも %s は閲覧できる（開発中の動作確認のため）', (_label, role) => {
    expect(canViewGameSection(false, role)).toBe(true);
  });

  it('非公開中の管理者にはプレビュー警告を出す', () => {
    expect(isGameSectionPreview(false, 'ADMIN')).toBe(true);
    expect(isGameSectionPreview(false, 'STAFF')).toBe(true);
    expect(isGameSectionPreview(false, 'SUPER_ADMIN')).toBe(true);
  });

  it('非公開中でも一般会員にはプレビュー扱いしない（そもそも 404 になる）', () => {
    expect(isGameSectionPreview(false, 'USER')).toBe(false);
    expect(isGameSectionPreview(false, undefined)).toBe(false);
  });

  /**
   * 「見えない人にバナーだけ見える」「見える人にバナーが出ない」といった
   * 組み合わせ矛盾が起きないことを保証する。
   */
  it('プレビュー表示は必ず「閲覧できる」場合に限られる', () => {
    const roles = [undefined, null, 'USER', 'STAFF', 'ADMIN', 'SUPER_ADMIN'] as const;
    for (const visible of [true, false]) {
      for (const role of roles) {
        if (isGameSectionPreview(visible, role)) {
          expect(canViewGameSection(visible, role)).toBe(true);
        }
      }
    }
  });
});
