/**
 * デモモード用の Prisma クライアントスタブ
 *
 * DB 接続無しで Next.js を起動するため、Prisma の主要メソッド
 * (findUnique / findMany / findFirst / count / create / update / delete / upsert
 *  / aggregate / groupBy / $transaction) を fixtures ベースのインメモリストアで模倣する。
 *
 * NEXT_PUBLIC_DEMO_MODE / DEMO_MODE 環境変数が "1" / "true" のときに有効化。
 *
 * fixtures は loadFixture(modelName) で動的にロードし、以降の
 * create / update / upsert / delete はこのプロセスメモリ上のコピーを実際に書き換える
 * (Next.js dev サーバーの HMR で保持されるよう globalThis にキャッシュ)。
 * ※ プロセス再起動 (デプロイ/再起動) でリセットされる点はデモ用途として許容する。
 */

type AnyArgs = Record<string, unknown> | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __demoFixturesStore: Record<string, unknown[]> | undefined;
}

async function loadFixtures(): Promise<Record<string, unknown[]>> {
  if (global.__demoFixturesStore) return global.__demoFixturesStore;
  let initial: Record<string, unknown[]> = {};
  try {
    const mod = (await import('./demo-fixtures')) as {
      default?: Record<string, unknown[]>;
      fixtures?: Record<string, unknown[]>;
    };
    initial = mod.default ?? mod.fixtures ?? {};
  } catch {
    initial = {};
  }
  // deep clone しておき、fixtures モジュール本体 (import キャッシュ) を汚さない
  global.__demoFixturesStore = JSON.parse(JSON.stringify(initial));
  return global.__demoFixturesStore!;
}

/**
 * fixtures からモデルのレコード一覧 (書き込み可能な実体配列) を取得。
 * デモはサーバーコンポーネントから async で読まれるため、await できる。
 * 返す配列はストアの実体そのもの (push/splice で create/delete を反映できる)。
 */
async function getRows(modelName: string): Promise<Record<string, unknown>[]> {
  const store = await loadFixtures();
  if (!store[modelName]) store[modelName] = [];
  return store[modelName] as Record<string, unknown>[];
}

/**
 * Prisma の `data` オブジェクトに含まれるフィールド演算子
 * ({ increment } / { decrement } / { set } / { multiply } / { divide }) を適用し、
 * 素の値へ変換する。
 */
function resolveScalarValue(current: unknown, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ops = value as Record<string, unknown>;
    if ('increment' in ops) return (Number(current) || 0) + Number(ops.increment);
    if ('decrement' in ops) return (Number(current) || 0) - Number(ops.decrement);
    if ('multiply' in ops) return (Number(current) || 0) * Number(ops.multiply);
    if ('divide' in ops) return (Number(current) || 0) / Number(ops.divide);
    if ('set' in ops) return ops.set;
  }
  return value;
}

/**
 * data オブジェクトを row に適用する (increment 等の演算子を解決しつつマージ)。
 */
function applyDataToRow(
  row: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!data) return row;
  for (const [k, v] of Object.entries(data)) {
    row[k] = resolveScalarValue(row[k], v);
  }
  return row;
}

/**
 * 単純な where 条件のマッチング (id, slug, status, characterId 等の eq に対応)
 * 完全な Prisma セマンティクスではなく、デモに十分な範囲で実装。
 */
const KNOWN_FILTER_OPERATORS = [
  'in',
  'notIn',
  'equals',
  'not',
  'contains',
  'startsWith',
  'endsWith',
  'lt',
  'lte',
  'gt',
  'gte',
];

function matches(row: Record<string, unknown>, where: AnyArgs): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
    if (k === 'AND' || k === 'OR' || k === 'NOT') {
      // 一旦無視 (デモ用途では fixtures のフィルタが効かなくても致命的でない)
      continue;
    }
    if (v && typeof v === 'object') {
      const cond = v as Record<string, unknown>;
      const hasKnownOperator = KNOWN_FILTER_OPERATORS.some((op) => op in cond);
      if (!hasKnownOperator) {
        // Prisma の複合ユニークキー (例: `@@unique([userId, gameType, date])` による
        // `findUnique({ where: { userId_gameType_date: { userId, gameType, date } } })`)。
        // オペレータを含まないネストされたオブジェクトは「各フィールドをそのまま row と比較する」
        // 複合キー条件とみなし、サブフィールドごとに等価チェックする。
        // (これを無視すると絞り込みが一切効かず、常に先頭行にマッチしてしまう)
        for (const [subKey, subVal] of Object.entries(cond)) {
          if (row[subKey] !== subVal) return false;
        }
        continue;
      }
      if ('in' in cond && Array.isArray(cond.in)) {
        if (!cond.in.includes(row[k])) return false;
      }
      if ('notIn' in cond && Array.isArray(cond.notIn)) {
        if (cond.notIn.includes(row[k])) return false;
      }
      if ('equals' in cond) {
        if (row[k] !== cond.equals) return false;
      }
      if ('not' in cond) {
        if (row[k] === cond.not) return false;
      }
      if ('contains' in cond) {
        const target = String(row[k] ?? '');
        if (!target.includes(String(cond.contains))) return false;
      }
      if ('startsWith' in cond) {
        const target = String(row[k] ?? '');
        if (!target.startsWith(String(cond.startsWith))) return false;
      }
      if ('endsWith' in cond) {
        const target = String(row[k] ?? '');
        if (!target.endsWith(String(cond.endsWith))) return false;
      }
      if ('lt' in cond) {
        if (!(Number(row[k]) < Number(cond.lt))) return false;
      }
      if ('lte' in cond) {
        if (!(Number(row[k]) <= Number(cond.lte))) return false;
      }
      if ('gt' in cond) {
        if (!(Number(row[k]) > Number(cond.gt))) return false;
      }
      if ('gte' in cond) {
        if (!(Number(row[k]) >= Number(cond.gte))) return false;
      }
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
      const rows = await getRows(modelName);
      const a = (args ?? {}) as { data?: Record<string, unknown>; include?: AnyArgs };
      const now = new Date();
      const row: Record<string, unknown> = {
        id: 'demo-' + Math.random().toString(36).slice(2, 10),
        createdAt: now,
        updatedAt: now,
        ...(a.data ?? {}),
      };
      rows.push(row);
      const f = await loadFixtures();
      return applyInclude(row, a.include, f);
    },
    async createMany(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as { data?: Record<string, unknown>[] };
      const now = new Date();
      const list = Array.isArray(a.data) ? a.data : [];
      for (const d of list) {
        rows.push({
          id: 'demo-' + Math.random().toString(36).slice(2, 10),
          createdAt: now,
          updatedAt: now,
          ...d,
        });
      }
      return { count: list.length };
    },
    async update(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as {
        where?: Record<string, unknown>;
        data?: Record<string, unknown>;
        include?: AnyArgs;
      };
      const row = rows.find((r) => matches(r, a.where));
      if (!row) {
        throw new Error(
          `[demo-prisma] update: レコードが見つかりません (model=${modelName})`,
        );
      }
      applyDataToRow(row, a.data);
      row.updatedAt = new Date();
      const f = await loadFixtures();
      return applyInclude(row, a.include, f);
    },
    async updateMany(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as { where?: Record<string, unknown>; data?: Record<string, unknown> };
      const targets = rows.filter((r) => matches(r, a.where));
      for (const row of targets) {
        applyDataToRow(row, a.data);
        row.updatedAt = new Date();
      }
      return { count: targets.length };
    },
    async upsert(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as {
        where?: Record<string, unknown>;
        create?: Record<string, unknown>;
        update?: Record<string, unknown>;
        include?: AnyArgs;
      };
      const existing = rows.find((r) => matches(r, a.where));
      const f = await loadFixtures();
      if (existing) {
        applyDataToRow(existing, a.update);
        existing.updatedAt = new Date();
        return applyInclude(existing, a.include, f);
      }
      const now = new Date();
      const row: Record<string, unknown> = {
        id: 'demo-' + Math.random().toString(36).slice(2, 10),
        createdAt: now,
        updatedAt: now,
        ...(a.where ?? {}),
        ...(a.create ?? {}),
      };
      rows.push(row);
      return applyInclude(row, a.include, f);
    },
    async delete(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as { where?: Record<string, unknown> };
      const idx = rows.findIndex((r) => matches(r, a.where));
      if (idx === -1) {
        throw new Error(
          `[demo-prisma] delete: レコードが見つかりません (model=${modelName})`,
        );
      }
      const [removed] = rows.splice(idx, 1);
      return removed as Record<string, unknown>;
    },
    async deleteMany(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as { where?: Record<string, unknown> };
      const remaining: Record<string, unknown>[] = [];
      let count = 0;
      for (const r of rows) {
        if (matches(r, a.where)) {
          count += 1;
        } else {
          remaining.push(r);
        }
      }
      rows.length = 0;
      rows.push(...remaining);
      return { count };
    },
    async aggregate(args) {
      const rows = await getRows(modelName);
      const a = (args ?? {}) as {
        where?: AnyArgs;
        _sum?: Record<string, boolean>;
        _avg?: Record<string, boolean>;
        _min?: Record<string, boolean>;
        _max?: Record<string, boolean>;
        _count?: boolean | Record<string, boolean>;
      };
      const filtered = rows.filter((r) => matches(r, a.where));
      const numeric = (field: string) =>
        filtered.map((r) => Number(r[field]) || 0);

      const out: Record<string, unknown> = {};
      if (a._count) {
        out._count =
          a._count === true
            ? filtered.length
            : Object.fromEntries(
                Object.keys(a._count as Record<string, boolean>).map((k) => [
                  k,
                  filtered.length,
                ]),
              );
      }
      for (const [outKey, fields] of [
        ['_sum', a._sum],
        ['_avg', a._avg],
        ['_min', a._min],
        ['_max', a._max],
      ] as const) {
        if (!fields) continue;
        const res: Record<string, number | null> = {};
        for (const field of Object.keys(fields)) {
          const nums = numeric(field);
          if (nums.length === 0) {
            res[field] = outKey === '_sum' ? 0 : null;
            continue;
          }
          if (outKey === '_sum') res[field] = nums.reduce((s, n) => s + n, 0);
          else if (outKey === '_avg') res[field] = nums.reduce((s, n) => s + n, 0) / nums.length;
          else if (outKey === '_min') res[field] = Math.min(...nums);
          else res[field] = Math.max(...nums);
        }
        out[outKey] = res;
      }
      return out;
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
