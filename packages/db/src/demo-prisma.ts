/**
 * デモモード用の Prisma クライアントスタブ
 *
 * DB 接続無しで Next.js を起動するため、Prisma の主要メソッド
 * (findUnique / findMany / findFirst / count / create / update / delete / upsert
 *  / aggregate / groupBy / $transaction) を空の値や fixtures から返す。
 *
 * NEXT_PUBLIC_DEMO_MODE / DEMO_MODE 環境変数が "1" / "true" のときに有効化。
 *
 * fixtures は loadFixture(modelName) で動的にロード。
 */

type AnyArgs = Record<string, unknown> | undefined;

let fixturesCache: Record<string, unknown[]> | null = null;

async function loadFixtures(): Promise<Record<string, unknown[]>> {
  if (fixturesCache) return fixturesCache;
  try {
    const mod = (await import('./demo-fixtures')) as {
      default?: Record<string, unknown[]>;
      fixtures?: Record<string, unknown[]>;
    };
    fixturesCache = mod.default ?? mod.fixtures ?? {};
  } catch {
    fixturesCache = {};
  }
  return fixturesCache!;
}

/**
 * fixtures からモデルのレコード一覧を取得。
 * デモはサーバーコンポーネントから async で読まれるため、await できる。
 */
async function getRows(modelName: string): Promise<Record<string, unknown>[]> {
  const f = await loadFixtures();
  const rows = (f[modelName] as Record<string, unknown>[] | undefined) ?? [];
  return rows;
}

/**
 * 単純な where 条件のマッチング (id, slug, status, characterId 等の eq に対応)
 * 完全な Prisma セマンティクスではなく、デモに十分な範囲で実装。
 */
function matches(row: Record<string, unknown>, where: AnyArgs): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
    if (k === 'AND' || k === 'OR' || k === 'NOT') {
      // 一旦無視 (デモ用途では fixtures のフィルタが効かなくても致命的でない)
      continue;
    }
    if (v && typeof v === 'object') {
      const cond = v as Record<string, unknown>;
      if ('in' in cond && Array.isArray(cond.in)) {
        if (!cond.in.includes(row[k])) return false;
      } else if ('equals' in cond) {
        if (row[k] !== cond.equals) return false;
      } else if ('not' in cond) {
        if (row[k] === cond.not) return false;
      } else if ('contains' in cond) {
        const target = String(row[k] ?? '');
        if (!target.includes(String(cond.contains))) return false;
      }
      // 他の Prisma 条件 (lt/lte/gt/gte 等) はデモでは無視
    } else {
      if (row[k] !== v) return false;
    }
  }
  return true;
}

/**
 * include 名 → fixture テーブル名のマッピング
 * Prisma リレーション名 (relation name) と fixtures map のキー名がズレる場合に補正
 */
const RELATION_TO_FIXTURE: Record<string, string> = {
  // belongsTo (単数)
  character: 'gameCharacter',
  scenario: 'gameScenario',
  item: 'gameItem',
  user: 'user',
  product: 'product',
  variant: 'productVariant',
  order: 'order',
  subscription: 'subscription',
  // hasMany (複数)
  characters: 'gameCharacter',
  scenarios: 'gameScenario',
  items: 'gameItem',
  users: 'user',
  products: 'product',
  variants: 'productVariant',
  orders: 'order',
  subscriptions: 'subscription',
  orderItems: 'orderItem',
  comments: 'comment',
  payments: 'payment',
};

function applyInclude(
  row: Record<string, unknown>,
  include: AnyArgs,
  allFixtures: Record<string, unknown[]>,
): Record<string, unknown> {
  if (!include || typeof include !== 'object') return row;
  const out: Record<string, unknown> = { ...row };
  for (const [key, val] of Object.entries(include as Record<string, unknown>)) {
    // _count: { select: { scenarios: true, ... } } → { scenarios: 0, ... }
    if (key === '_count') {
      const selectObj =
        val && typeof val === 'object' && (val as Record<string, unknown>).select
          ? ((val as Record<string, unknown>).select as Record<string, unknown>)
          : (val as Record<string, unknown> | undefined) ?? {};
      const countOut: Record<string, number> = {};
      for (const relKey of Object.keys(selectObj)) {
        // fixtures に同名テーブルがあれば件数を返す (大雑把だがデモ用途で十分)
        const fixtureRows = allFixtures[relKey];
        countOut[relKey] = Array.isArray(fixtureRows) ? fixtureRows.length : 0;
      }
      out._count = countOut;
      continue;
    }
    // 既に row に同名のリレーションがあれば尊重
    if (row[key] !== undefined) continue;

    // include: false の場合はスキップ
    if (val === false) continue;

    // リレーション名から fixture テーブルを推測
    const fixtureKey =
      RELATION_TO_FIXTURE[key] ??
      (Array.isArray(allFixtures[key]) ? key : null);
    const targetRows = fixtureKey ? allFixtures[fixtureKey] : undefined;

    if (!Array.isArray(targetRows)) {
      // fixture テーブルが見つからない → 配列か null かは推測不可、配列でデフォルト null
      out[key] = null;
      continue;
    }

    // belongsTo: row[<key>Id] で単一 row を引く
    const fkSingular = `${key}Id`;
    if (fkSingular in row) {
      const targetId = row[fkSingular];
      const found = targetRows.find(
        (r) => (r as Record<string, unknown>).id === targetId,
      );
      out[key] = found ?? null;
      continue;
    }

    // hasMany: 対象テーブルから row.id を <currentModel>Id で参照する行を集める
    // currentModel 名を推測するのは難しいので、代表的な FK 候補を試行
    const myId = row['id'];
    const fkCandidates = ['userId', 'characterId', 'scenarioId', 'itemId', 'orderId', 'productId'];
    const matched = targetRows.filter((r) => {
      const rec = r as Record<string, unknown>;
      return fkCandidates.some((fk) => fk in rec && rec[fk] === myId);
    });
    out[key] = matched;
  }
  return out;
}

interface DelegateMethods {
  findUnique: (args?: AnyArgs) => Promise<Record<string, unknown> | null>;
  findFirst: (args?: AnyArgs) => Promise<Record<string, unknown> | null>;
  findMany: (args?: AnyArgs) => Promise<Record<string, unknown>[]>;
  count: (args?: AnyArgs) => Promise<number>;
  create: (args?: AnyArgs) => Promise<Record<string, unknown>>;
  createMany: (args?: AnyArgs) => Promise<{ count: number }>;
  update: (args?: AnyArgs) => Promise<Record<string, unknown>>;
  updateMany: (args?: AnyArgs) => Promise<{ count: number }>;
  upsert: (args?: AnyArgs) => Promise<Record<string, unknown>>;
  delete: (args?: AnyArgs) => Promise<Record<string, unknown>>;
  deleteMany: (args?: AnyArgs) => Promise<{ count: number }>;
  aggregate: (args?: AnyArgs) => Promise<Record<string, unknown>>;
  groupBy: (args?: AnyArgs) => Promise<unknown[]>;
}

function makeDelegate(modelName: string): DelegateMethods {
  return {
    async findUnique(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as { where?: AnyArgs; include?: AnyArgs };
      const f = await loadFixtures();
      const row = rows.find((r) => matches(r, a.where));
      return row ? applyInclude(row, a.include, f) : null;
    },
    async findFirst(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as { where?: AnyArgs; include?: AnyArgs };
      const f = await loadFixtures();
      const row = rows.find((r) => matches(r, a.where));
      return row ? applyInclude(row, a.include, f) : null;
    },
    async findMany(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as {
        where?: AnyArgs;
        include?: AnyArgs;
        skip?: number;
        take?: number;
      };
      const f = await loadFixtures();
      let filtered = rows.filter((r) => matches(r, a.where));
      if (typeof a.skip === 'number') filtered = filtered.slice(a.skip);
      if (typeof a.take === 'number') filtered = filtered.slice(0, a.take);
      return filtered.map((r) => applyInclude(r, a.include, f));
    },
    async count(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as { where?: AnyArgs };
      return rows.filter((r) => matches(r, a.where)).length;
    },
    async create(args) {
      const a = (args ?? {}) as { data?: Record<string, unknown> };
      return { id: 'demo-' + Math.random().toString(36).slice(2), ...(a.data ?? {}) };
    },
    async createMany(args) {
      const a = (args ?? {}) as { data?: unknown[] };
      return { count: Array.isArray(a.data) ? a.data.length : 0 };
    },
    async update(args) {
      const a = (args ?? {}) as { where?: Record<string, unknown>; data?: Record<string, unknown> };
      return { ...(a.where ?? {}), ...(a.data ?? {}) };
    },
    async updateMany() {
      return { count: 0 };
    },
    async upsert(args) {
      const a = (args ?? {}) as {
        where?: Record<string, unknown>;
        create?: Record<string, unknown>;
        update?: Record<string, unknown>;
      };
      return { ...(a.where ?? {}), ...(a.create ?? {}), ...(a.update ?? {}) };
    },
    async delete(args) {
      const a = (args ?? {}) as { where?: Record<string, unknown> };
      return { ...(a.where ?? {}) };
    },
    async deleteMany() {
      return { count: 0 };
    },
    async aggregate() {
      return { _count: 0, _sum: {}, _avg: {}, _min: {}, _max: {} };
    },
    async groupBy() {
      return [];
    },
  };
}

/**
 * Prisma 風のプロキシクライアントを生成。
 * `prisma.user.findMany(...)` のようなアクセスを動的に解決。
 */
export function createDemoPrisma(): unknown {
  const cache = new Map<string, DelegateMethods>();
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      // 特殊メソッド
      if (prop === '$transaction') {
        return async (arg: unknown) => {
          if (typeof arg === 'function') {
            return (arg as (tx: unknown) => unknown)(createDemoPrisma());
          }
          if (Array.isArray(arg)) {
            return Promise.all(arg.map((p) => Promise.resolve(p)));
          }
          return undefined;
        };
      }
      if (prop === '$connect' || prop === '$disconnect') {
        return async () => undefined;
      }
      if (prop === '$queryRaw' || prop === '$executeRaw') {
        return async () => [];
      }
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined;
      }
      // モデル委譲
      if (typeof prop === 'string') {
        if (!cache.has(prop)) cache.set(prop, makeDelegate(prop));
        return cache.get(prop);
      }
      return undefined;
    },
  };
  return new Proxy({}, handler);
}

export function isDemoMode(): boolean {
  return (
    process.env.DEMO_MODE === '1' ||
    process.env.DEMO_MODE === 'true' ||
    process.env.NEXT_PUBLIC_DEMO_MODE === '1' ||
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
  );
}
