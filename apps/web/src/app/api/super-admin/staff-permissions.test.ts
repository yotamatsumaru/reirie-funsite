/**
 * スタッフ管理者 (STAFF) の権限モデルを守るための静的監査テスト。
 *
 * 要件:
 *   - STAFF は SUPER_ADMIN と同じ画面を「閲覧」できる
 *   - ただし「返金」「サブスクの変更」をはじめ、書き込み操作は原則できない
 *   - 例外として、サイト運営に必要な操作だけ STAFF にも書き込みを許可する
 *     (STAFF_WRITABLE_ROUTES に列挙したもの。現在はお知らせのみ)
 *
 * 権限の実体は各 API ルートのガード関数で担保している:
 *   requireSuperAdmin()        … SUPER_ADMIN のみ (STAFF は 403)  → 書き込みに使う
 *   requireSuperAdminView()    … SUPER_ADMIN と STAFF (閲覧)      → 読み取りに使う
 *   requireSuperAdminOrStaff() … SUPER_ADMIN と STAFF (書き込み)  → 許可リストの API だけ
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
 * STAFF にも書き込みを許可する API (api/super-admin からの相対パス → メソッド)。
 *
 * ここに無い API で requireSuperAdminOrStaff() を使うとテストが落ちる。
 * 追加するときは «なぜ STAFF に任せてよいか» をコメントに残すこと。
 */
const STAFF_WRITABLE_ROUTES: Record<string, readonly string[]> = {
  // お知らせ: サイト運営に日常的に必要 (ライブ告知・メンテ告知など)。
  // 操作者は監査ログ (announcement.create / update / delete) に残る。
  'announcements/route.ts': ['POST'],
  'announcements/[id]/route.ts': ['PATCH', 'DELETE'],
};

function routeKey(file: string): string {
  return relative(API_ROOT, file).split(/[\\/]/).join('/');
}

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

  it('すべての書き込みハンドラが requireSuperAdmin() で保護されている (許可リストを除く)', () => {
    const violations: string[] = [];

    for (const file of routeFiles) {
      const key = routeKey(file);
      const src = readFileSync(file, 'utf8');
      const handlers = extractHandlers(src);
      const staffWritable = STAFF_WRITABLE_ROUTES[key] ?? [];

      for (const method of WRITE_METHODS) {
        const body = handlers.get(method);
        if (!body) continue;

        const hasStrictGuard = /requireSuperAdmin\s*\(/.test(body);
        const hasStaffWriteGuard = /requireSuperAdminOrStaff\s*\(/.test(body);
        // requireSuperAdminView() は「閲覧」用。書き込みで使ってはいけない。
        const usesViewGuard = /requireSuperAdminView\s*\(/.test(body);

        if (usesViewGuard) {
          violations.push(`${key} の ${method}: requireSuperAdminView() を使用 (閲覧用ガード)`);
          continue;
        }
        if (staffWritable.includes(method)) {
          if (!hasStaffWriteGuard && !hasStrictGuard) {
            violations.push(`${key} の ${method}: ガードがない`);
          }
          continue;
        }
        if (hasStaffWriteGuard) {
          violations.push(
            `${key} の ${method}: requireSuperAdminOrStaff() を使用 ` +
              '(STAFF が書き込めてしまう。必要なら STAFF_WRITABLE_ROUTES に理由付きで追加)',
          );
          continue;
        }
        if (!hasStrictGuard) {
          violations.push(`${key} の ${method}: requireSuperAdmin() がない`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('許可リストの API は実在し、STAFF 用の書き込みガードを使っている', () => {
    for (const [key, methods] of Object.entries(STAFF_WRITABLE_ROUTES)) {
      const src = readFileSync(join(API_ROOT, ...key.split('/')), 'utf8');
      const handlers = extractHandlers(src);
      for (const method of methods) {
        const body = handlers.get(method);
        expect(body).toBeDefined();
        expect(body).toMatch(/requireSuperAdminOrStaff\s*\(/);
      }
    }
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

describe('STAFF 権限モデル: お知らせ (サイト運営に必要なため STAFF も変更可)', () => {
  function readRoute(...segments: string[]): string {
    return readFileSync(join(API_ROOT, ...segments), 'utf8');
  }

  it('お知らせの作成 (POST) は STAFF も可', () => {
    const post = extractHandlers(readRoute('announcements', 'route.ts')).get('POST');
    expect(post).toMatch(/requireSuperAdminOrStaff\s*\(/);
  });

  it('お知らせの編集・公開切替 (PATCH) と削除 (DELETE) は STAFF も可', () => {
    const h = extractHandlers(readRoute('announcements', '[id]', 'route.ts'));
    expect(h.get('PATCH')).toMatch(/requireSuperAdminOrStaff\s*\(/);
    expect(h.get('DELETE')).toMatch(/requireSuperAdminOrStaff\s*\(/);
  });
});
