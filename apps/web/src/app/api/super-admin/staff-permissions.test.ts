/**
 * スタッフ管理者 (STAFF) の権限モデルを守るための静的監査テスト。
 *
 * 要件:
 *   - STAFF は SUPER_ADMIN と同じ画面を「閲覧」できる
 *   - ただし「返金」「サブスクの変更」をはじめ、書き込み操作は一切できない
 *
 * 権限の実体は各 API ルートのガード関数で担保している:
 *   requireSuperAdmin()     … SUPER_ADMIN のみ (STAFF は 403)  → 書き込みに使う
 *   requireSuperAdminView() … SUPER_ADMIN と STAFF (閲覧)      → 読み取りに使う
 *
 * 新しい書き込み API を追加したときに、うっかり requireSuperAdminView() を
 * 使ってしまうと STAFF が返金できてしまう。それをこのテストで機械的に防ぐ。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const API_ROOT = __dirname;

/** api/super-admin 配下の route.ts をすべて集める */
function collectRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectRouteFiles(full, acc);
    } else if (entry === 'route.ts') {
      acc.push(full);
    }
  }
  return acc;
}

const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;

/**
 * ソースを関数単位に大まかに分割し、HTTP メソッドごとの本文を取り出す。
 * (厳密なパースはしない。ガード呼び出しの有無を見るだけなので十分)
 */
function extractHandlers(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export\s+(?:const|async\s+function)\s+(GET|POST|PATCH|PUT|DELETE)\b/g;
  const marks: Array<{ method: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    marks.push({ method: m[1], index: m.index });
  }
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
    out.set(marks[i].method, src.slice(start, end));
  }
  return out;
}

const routeFiles = collectRouteFiles(API_ROOT);

describe('STAFF 権限モデル: /api/super-admin の書き込みガード', () => {
  it('監査対象の route.ts が十分に存在する (収集ロジックの健全性チェック)', () => {
    expect(routeFiles.length).toBeGreaterThan(20);
  });

  it('すべての書き込みハンドラが requireSuperAdmin() で保護されている', () => {
    const violations: string[] = [];

    for (const file of routeFiles) {
      const src = readFileSync(file, 'utf8');
      const handlers = extractHandlers(src);

      for (const method of WRITE_METHODS) {
        const body = handlers.get(method);
        if (!body) continue;

        const hasStrictGuard = /requireSuperAdmin\s*\(/.test(body);
        // requireSuperAdminView() は「閲覧」用。書き込みで使ってはいけない。
        const usesViewGuard = /requireSuperAdminView\s*\(/.test(body);

        if (!hasStrictGuard || usesViewGuard) {
          violations.push(
            `${relative(API_ROOT, file)} の ${method}: ` +
              `${usesViewGuard ? 'requireSuperAdminView() を使用 (STAFF が書き込めてしまう)' : 'requireSuperAdmin() がない'}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('STAFF 権限モデル: 返金 / サブスク変更 (ユーザーが明示した要件)', () => {
  function readRoute(...segments: string[]): string {
    return readFileSync(join(API_ROOT, ...segments), 'utf8');
  }

  it('サブスクの返金 (POST) は SUPER_ADMIN 限定', () => {
    const src = readRoute('subscriptions', '[id]', 'refund', 'route.ts');
    const post = extractHandlers(src).get('POST');
    expect(post).toBeDefined();
    expect(post).toMatch(/requireSuperAdmin\s*\(/);
    expect(post).not.toMatch(/requireSuperAdminView\s*\(/);
  });

  it('返金対象の照会 (GET) は STAFF も閲覧できる', () => {
    const src = readRoute('subscriptions', '[id]', 'refund', 'route.ts');
    const get = extractHandlers(src).get('GET');
    expect(get).toBeDefined();
    expect(get).toMatch(/requireSuperAdminView\s*\(/);
  });

  it('サブスクの変更 (PATCH) は SUPER_ADMIN 限定', () => {
    const src = readRoute('subscriptions', '[id]', 'route.ts');
    const patch = extractHandlers(src).get('PATCH');
    expect(patch).toBeDefined();
    expect(patch).toMatch(/requireSuperAdmin\s*\(/);
    expect(patch).not.toMatch(/requireSuperAdminView\s*\(/);
  });

  it('ユーザー個別のサブスク操作 (手動付与 / Stripe同期) は SUPER_ADMIN 限定', () => {
    const src = readRoute('users', '[id]', 'subscription', 'route.ts');
    const post = extractHandlers(src).get('POST');
    expect(post).toBeDefined();
    expect(post).toMatch(/requireSuperAdmin\s*\(/);
    expect(post).not.toMatch(/requireSuperAdminView\s*\(/);
  });

  it('注文の返金 (PATCH) は SUPER_ADMIN 限定', () => {
    const src = readRoute('orders', '[id]', 'route.ts');
    const patch = extractHandlers(src).get('PATCH');
    expect(patch).toBeDefined();
    expect(patch).toMatch(/requireSuperAdmin\s*\(/);
    expect(patch).not.toMatch(/requireSuperAdminView\s*\(/);
  });
});
