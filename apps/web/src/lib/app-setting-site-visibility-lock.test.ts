/**
 * サイト公開設定 (site.sectionVisibility) の競合対策 (advisory lock) に関するテスト。
 *
 * 背景: /super-admin/settings のトグルを連打すると、片方の変更が
 * もう片方の書き込みで上書きされて消えてしまう不具合が報告された
 * (read-then-write の lost update)。
 *
 * ここでは主に以下を検証する:
 *  1. setSiteSectionVisibility が $transaction の「最初」に
 *     pg_advisory_xact_lock を取得すること (= read より前にロックする)。
 *     ロックが read より後だと Read-Modify-Write 競合を防げないため、
 *     「順序」が正当性の要になる。
 *  2. 部分更新 (patch) が、ロック取得後にトランザクション内で読み直した
 *     最新値に対してマージされること (呼び出し時点の古い値ではなく)。
 *  3. ほぼ同時の 2 リクエストを模した場合でも、両方の変更が失われずに
 *     反映されること (逐次実行される $transaction 経由で検証)。
 *
 * 実 DB は使わず、@idol/db を軽量なインメモリスタブに差し替えて検証する。
 */

type Call = { op: string; args: unknown[] };

const calls: Call[] = [];

/** AppSetting テーブルを模したインメモリストア (テスト間で beforeEach リセット) */
let appSettingRow: { key: string; value: string } | null = null;

// トランザクションクライアントのスタブ。呼ばれた順序を calls に記録する。
function makeTx() {
  return {
    $executeRaw: (...args: unknown[]) => {
      calls.push({ op: '$executeRaw', args });
      return Promise.resolve(1);
    },
    appSetting: {
      findUnique: () => {
        calls.push({ op: 'appSetting.findUnique', args: [] });
        return Promise.resolve(appSettingRow ? { ...appSettingRow } : null);
      },
      upsert: (args: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
        calls.push({ op: 'appSetting.upsert', args: [args] });
        appSettingRow = { key: args.where.key, value: args.create.value };
        return Promise.resolve({ ...appSettingRow });
      },
    },
  };
}

jest.mock('@idol/db', () => {
  const prismaStub = {
    // GET 用の直接読み取り (getSiteSectionVisibility) はトップレベル prisma に対して呼ばれる。
    appSetting: {
      findUnique: (args: { where: { key: string } }) => {
        calls.push({ op: 'toplevel.appSetting.findUnique', args: [args] });
        return Promise.resolve(appSettingRow ? { ...appSettingRow } : null);
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  };
  return {
    prisma: prismaStub,
    Prisma: {
      // Prisma.TransactionClient は型のみなので実行時には不要。ダミーを置く。
      TransactionClient: class {},
    },
  };
});

// jest.mock の後に import する (ホイスティングされるので実際は先に評価される)
import { setSiteSectionVisibility, getSiteSectionVisibility } from './app-setting';
import { DEFAULT_SITE_SECTION_VISIBILITY } from '@idol/shared';

/**
 * 「すべて公開」の状態。
 *
 * 【重要】ここでフィールドをベタ書きしないこと。
 * 公開セクションは今後も増える (例: 2026-08 にゲームを追加) ため、リテラルで
 * 書くとセクションが増えるたびにこのテストが無関係に落ちる。既定値を基準にし、
 * このテストの関心事 (= advisory lock と部分マージの正しさ) だけを検証する。
 */
const ALL_VISIBLE = { ...DEFAULT_SITE_SECTION_VISIBILITY };

/** ALL_VISIBLE から一部だけ変更した期待値を作るヘルパ */
const expectVisibility = (patch: Partial<typeof ALL_VISIBLE>) => ({
  ...ALL_VISIBLE,
  ...patch,
});

beforeEach(() => {
  calls.length = 0;
  appSettingRow = null;
});

describe('setSiteSectionVisibility (advisory lock による競合対策)', () => {
  it('トランザクションの最初に advisory lock ($executeRaw) を取得する', async () => {
    await setSiteSectionVisibility({ contentsVisible: false });

    const opOrder = calls.map((c) => c.op);
    const lockIndex = opOrder.indexOf('$executeRaw');
    const findIndex = opOrder.indexOf('appSetting.findUnique');

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(findIndex).toBeGreaterThanOrEqual(0);
    // ロック取得は「読み取りより前」でなければ競合対策の意味がない
    expect(lockIndex).toBeLessThan(findIndex);
  });

  it('部分更新 (patch) は既存の他フィールドを保持したままマージされる', async () => {
    // 既定値 (すべて true) が保存されている状態からスタート
    appSettingRow = {
      key: 'site.sectionVisibility',
      value: JSON.stringify(ALL_VISIBLE),
    };

    const { after } = await setSiteSectionVisibility({ contentsVisible: false });
    expect(after).toEqual(expectVisibility({ contentsVisible: false }));

    const persisted = await getSiteSectionVisibility();
    expect(persisted).toEqual(expectVisibility({ contentsVisible: false }));
  });

  it('逐次実行される 2 つの部分更新はどちらも失われずに反映される (lost update が起きない)', async () => {
    appSettingRow = {
      key: 'site.sectionVisibility',
      value: JSON.stringify(ALL_VISIBLE),
    };

    // 「コンテンツを OFF」と「DM を OFF」がほぼ同時に発生したケースを模す。
    // advisory lock により実際の DB では直列化されるため、ここでは
    // 2 回の呼び出しを順番に await することで「両方の変更が残ること」を検証する
    // (もし従来の実装のように毎回 getSiteSectionVisibility() を呼び出し元で
    //  先読みしてから渡す方式だと、呼び出し元が古い値を保持していれば
    //  2 回目の呼び出しで 1 回目の変更が消えてしまう)。
    await setSiteSectionVisibility({ contentsVisible: false });
    const { after } = await setSiteSectionVisibility({ dmVisible: false });

    expect(after).toEqual(expectVisibility({ contentsVisible: false, dmVisible: false }));
  });

  it('before には呼び出し前の値が、after には呼び出し後の値が入る', async () => {
    appSettingRow = {
      key: 'site.sectionVisibility',
      value: JSON.stringify(ALL_VISIBLE),
    };

    const { before, after } = await setSiteSectionVisibility({ productsVisible: false });
    expect(before).toEqual(ALL_VISIBLE);
    expect(after).toEqual(expectVisibility({ productsVisible: false }));
  });

  it('未設定 (行が存在しない) 場合はデフォルト値をベースにマージする', async () => {
    appSettingRow = null;

    const { before, after } = await setSiteSectionVisibility({ dmVisible: false });
    expect(before).toEqual(ALL_VISIBLE);
    expect(after).toEqual(expectVisibility({ dmVisible: false }));
  });
});
