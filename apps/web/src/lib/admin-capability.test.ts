/**
 * 管理権限 (ロール × 領域) の判定を固定するテスト。
 *
 * ## 守りたい権限境界
 *
 * 権限は 2 階建てで、それぞれ別のガードが担当する。
 *
 *   1. /admin       … 日常の運営作業 (ブログ・商品・ゲーム・1on1)
 *                     → hasCapability / hasAnyCapability (このテスト)
 *   2. /super-admin … 経営・危険操作 (返金・BAN・ロール変更)
 *                     → requireSuperAdmin / requireSuperAdminView
 *                     → 静的監査は api/super-admin/staff-permissions.test.ts
 *
 * STAFF は 1 をフル操作でき、2 は閲覧のみ。
 * この 2 つを混同すると「STAFF が返金できてしまう」事故になるため、
 * ここでは 1 の側だけを扱い、2 は上記の監査テストに任せる。
 */
import { hasAnyCapability, hasCapability, ADMIN_CAPABILITIES } from '@idol/shared';
import type { AdminCapabilityLiteral, UserRoleLiteral } from '@idol/shared';

const p = (role: UserRoleLiteral, capabilities: string[] = []) => ({ role, capabilities });

describe('hasCapability — ロール別の基本挙動', () => {
  it('SUPER_ADMIN はすべての領域を扱える', () => {
    for (const cap of ADMIN_CAPABILITIES) {
      expect(hasCapability(p('SUPER_ADMIN'), cap)).toBe(true);
    }
  });

  it('STAFF はすべての領域を扱える (運営ダッシュボードの日常業務を担当)', () => {
    // 以前は false だったため、STAFF は /super-admin を見られるのに
    // ブログすら書けなかった。その直感に反する状態を解消する。
    for (const cap of ADMIN_CAPABILITIES) {
      expect(hasCapability(p('STAFF'), cap)).toBe(true);
    }
  });

  it('STAFF は capabilities が空でも扱える (領域指定に依存しない)', () => {
    expect(hasCapability({ role: 'STAFF', capabilities: [] }, 'CONTENT')).toBe(true);
    expect(hasCapability({ role: 'STAFF' }, 'MERCH')).toBe(true);
    expect(hasCapability({ role: 'STAFF', capabilities: null }, 'GAME')).toBe(true);
  });

  it('USER はどの領域も扱えない', () => {
    for (const cap of ADMIN_CAPABILITIES) {
      expect(hasCapability(p('USER'), cap)).toBe(false);
      // capabilities を無理やり持たせても USER は通さない
      expect(hasCapability(p('USER', [...ADMIN_CAPABILITIES]), cap)).toBe(false);
    }
  });

  it('未ログイン (role なし) は扱えない', () => {
    expect(hasCapability({ role: undefined }, 'CONTENT')).toBe(false);
    expect(hasCapability({ role: null }, 'CONTENT')).toBe(false);
  });
});

describe('hasCapability — ADMIN は付与された領域だけ', () => {
  it('付与された領域のみ true', () => {
    const admin = p('ADMIN', ['CONTENT']);
    expect(hasCapability(admin, 'CONTENT')).toBe(true);
    expect(hasCapability(admin, 'MERCH')).toBe(false);
    expect(hasCapability(admin, 'GAME')).toBe(false);
    expect(hasCapability(admin, 'CALL')).toBe(false);
  });

  it('複数領域を付与できる', () => {
    const admin = p('ADMIN', ['CONTENT', 'MERCH']);
    expect(hasCapability(admin, 'CONTENT')).toBe(true);
    expect(hasCapability(admin, 'MERCH')).toBe(true);
    expect(hasCapability(admin, 'CALL')).toBe(false);
  });

  it('領域なしの ADMIN は何も扱えない', () => {
    for (const cap of ADMIN_CAPABILITIES) {
      expect(hasCapability(p('ADMIN', []), cap)).toBe(false);
    }
  });
});

describe('hasAnyCapability — /admin の入口判定', () => {
  it('SUPER_ADMIN / STAFF は常に入れる', () => {
    expect(hasAnyCapability(p('SUPER_ADMIN'))).toBe(true);
    expect(hasAnyCapability(p('STAFF'))).toBe(true);
    // capabilities が空でも入れる
    expect(hasAnyCapability({ role: 'STAFF', capabilities: [] })).toBe(true);
  });

  it('領域を 1 つでも持つ ADMIN は入れる', () => {
    expect(hasAnyCapability(p('ADMIN', ['CALL']))).toBe(true);
  });

  it('領域を持たない ADMIN は入れない', () => {
    expect(hasAnyCapability(p('ADMIN', []))).toBe(false);
  });

  it('USER / 未ログインは入れない', () => {
    expect(hasAnyCapability(p('USER'))).toBe(false);
    expect(hasAnyCapability({ role: undefined })).toBe(false);
  });
});

describe('整合性: hasAnyCapability と hasCapability', () => {
  it('どれか 1 つでも扱えるなら hasAnyCapability も true になる', () => {
    const cases: Array<{ role: UserRoleLiteral; capabilities: string[] }> = [
      { role: 'SUPER_ADMIN', capabilities: [] },
      { role: 'STAFF', capabilities: [] },
      { role: 'ADMIN', capabilities: ['GAME'] },
      { role: 'ADMIN', capabilities: [] },
      { role: 'USER', capabilities: [] },
    ];
    for (const c of cases) {
      const any = ADMIN_CAPABILITIES.some((cap: AdminCapabilityLiteral) =>
        hasCapability(c, cap),
      );
      expect(hasAnyCapability(c)).toBe(any);
    }
  });

  it('領域を増やしても判定関数を直す必要がない (定義から導出している)', () => {
    // ADMIN_CAPABILITIES に新しい領域を足したとき、
    // STAFF / SUPER_ADMIN が自動的に扱えることを保証する
    // (列挙を手書きしていると新領域だけ権限が無い、という事故になる)。
    expect(ADMIN_CAPABILITIES.length).toBeGreaterThan(0);
    for (const cap of ADMIN_CAPABILITIES) {
      expect(hasCapability(p('SUPER_ADMIN'), cap)).toBe(true);
      expect(hasCapability(p('STAFF'), cap)).toBe(true);
    }
  });
});
