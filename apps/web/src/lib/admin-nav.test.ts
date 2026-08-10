/**
 * 管理メニュー表示判定のテスト。
 *
 * 実際に起きた不具合の再発防止が主目的:
 *   STAFF (スタッフ管理者) のサイドバーに「スーパー管理者」リンクが出ず、
 *   URL を直接叩かないとスーパー管理画面に到達できなかった。
 *   原因は isSuperAdmin() (=== 'SUPER_ADMIN' の厳密判定) で出し分けていたこと。
 */
import { resolveAdminNavVisibility } from './admin-nav';

describe('resolveAdminNavVisibility', () => {
  describe('STAFF (スタッフ管理者)', () => {
    const nav = resolveAdminNavVisibility('STAFF');

    it('スーパー管理画面へのリンクを表示する (回帰: 以前は表示されなかった)', () => {
      expect(nav.showSuperAdmin).toBe(true);
    });

    it('管理セクション自体が表示される', () => {
      expect(nav.showAdminSection).toBe(true);
    });

    it('/admin (通常管理画面) には入れないのでリンクを出さない', () => {
      // admin/layout.tsx は ADMIN / SUPER_ADMIN しか通さないため、
      // リンクを出すと必ずトップへリダイレクトされる導線になってしまう。
      expect(nav.showAdminDashboard).toBe(false);
    });

    it('閲覧専用フラグが立つ', () => {
      expect(nav.superAdminReadOnly).toBe(true);
    });

    it('閲覧のみと分かるラベルになる', () => {
      expect(nav.superAdminLabel).toBe('スタッフ管理（閲覧）');
    });
  });

  describe('SUPER_ADMIN', () => {
    const nav = resolveAdminNavVisibility('SUPER_ADMIN');

    it('両方のリンクを表示する', () => {
      expect(nav.showAdminDashboard).toBe(true);
      expect(nav.showSuperAdmin).toBe(true);
      expect(nav.showAdminSection).toBe(true);
    });

    it('閲覧専用ではない', () => {
      expect(nav.superAdminReadOnly).toBe(false);
    });

    it('通常のラベルになる', () => {
      expect(nav.superAdminLabel).toBe('スーパー管理者');
    });
  });

  describe('ADMIN', () => {
    const nav = resolveAdminNavVisibility('ADMIN');

    it('/admin のリンクのみ表示する', () => {
      expect(nav.showAdminDashboard).toBe(true);
      expect(nav.showAdminSection).toBe(true);
    });

    it('スーパー管理画面へのリンクは表示しない', () => {
      expect(nav.showSuperAdmin).toBe(false);
    });
  });

  describe('USER / 未ログイン', () => {
    it.each([['USER'], [null], [undefined], ['']])(
      'role=%p では管理メニューを一切表示しない',
      (role) => {
        const nav = resolveAdminNavVisibility(role as string | null | undefined);
        expect(nav.showAdminDashboard).toBe(false);
        expect(nav.showSuperAdmin).toBe(false);
        expect(nav.showAdminSection).toBe(false);
      },
    );
  });

  it('未知のロール文字列は権限なしとして扱う', () => {
    const nav = resolveAdminNavVisibility('MODERATOR');
    expect(nav.showAdminSection).toBe(false);
  });
});
