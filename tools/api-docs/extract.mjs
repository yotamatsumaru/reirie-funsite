/**
 * API 仕様書の元データを実コードから抽出する。
 *
 * 手で書くと必ず実装とずれるため、route.ts を機械的に走査して
 *   - パス (App Router のディレクトリ構造から復元)
 *   - 公開している HTTP メソッド
 *   - 使っている認証ガード
 *   - 先頭の JSDoc コメント (説明として使う)
 * を集める。
 */
import fs from 'node:fs';
import path from 'node:path';

const API_ROOT = 'apps/web/src/app/api';

/** 認証ガードの分類 */
const GUARDS = [
  // 完全公開 / 認証任意
  { re: /resolveApiSession\s*\(/, key: 'optional', label: '任意（未ログインでも可）' },
  { re: /resolveApiPrincipal\s*\(/, key: 'optional', label: '任意（未ログインでも可）' },
  // 会員必須
  { re: /requireApiPrincipal\s*\(/, key: 'member', label: '会員必須' },
  { re: /requireApiSession\s*\(/, key: 'member', label: '会員必須' },
  { re: /requireApiAccessLevel\s*\(/, key: 'plan', label: 'プラン条件つき' },
  // 動画は requirePlayableVideo の内部で requireApiSession を呼んでいる
  // (視聴権とプラン条件をまとめて判定する)。実装を確認して member 扱いにする。
  { re: /requirePlayableVideo\s*\(/, key: 'member', label: '会員必須（視聴権あり）' },
  // 管理者
  { re: /requireApiAdmin\s*\(/, key: 'admin', label: '管理者' },
  { re: /requireSuperAdminView\s*\(/, key: 'superadmin', label: 'スーパー管理者（閲覧）' },
  { re: /requireSuperAdmin\s*\(/, key: 'superadmin', label: 'スーパー管理者' },
  { re: /requireAdmin\s*\(/, key: 'admin', label: '管理者' },
  { re: /hasCapability|hasAnyCapability/, key: 'admin', label: '管理者（権限別）' },
  // Cookie 専用（アプリから使えない）
  { re: /requireSession\s*\(/, key: 'cookie', label: 'Cookie専用' },
  { re: /await auth\s*\(\s*\)/, key: 'cookie', label: 'Cookie専用' },
];

/** ゲート（機能自体の公開トグル） */
/**
 * 認証区分の «強さ» の順序。先に来るものほど強い。
 * 1 ルートに複数のガードが見つかった場合、最も強いものを代表として表示する。
 * cron は「会員では通れない (secret か管理者が必要)」ので member より強い。
 * 2 箇所で使うので定数にしている (別々に書くとズレる)。
 */
const AUTH_ORDER = [
  'superadmin',
  'admin',
  'cron',
  'plan',
  'member',
  'optional',
  'cookie',
];

const GATES = [
  { re: /contentsVisible/, label: 'コンテンツ公開トグル' },
  { re: /videosVisible/, label: '動画公開トグル' },
  { re: /productsVisible/, label: 'ショップ公開トグル' },
  { re: /dmVisible/, label: 'DM公開トグル' },
  { re: /requireGameVisible/, label: 'ゲーム公開トグル' },
  { re: /requireMyRoomVisible/, label: 'MyRoom公開トグル' },
  { re: /requireGameSectionVisible/, label: 'ゲーム公開トグル' },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

/** ディレクトリ構造 → URL パス */
function toApiPath(file) {
  const rel = path.relative(API_ROOT, path.dirname(file));
  if (rel === '') return '/api';
  // ルートグループ (xxx) は URL に出ない
  const segs = rel.split(path.sep).filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return '/api/' + segs.join('/');
}

/**
 * 先頭 JSDoc から説明を取り出す。
 *
 * 【注意 / 一度ハマった点】
 * 「GET /api/me/login-bonus — 説明」から説明部分を切り出すとき、
 * 単純に /[-—–]\s*(.+)/ で分割すると **パスに含まれる - にマッチ** してしまい、
 * 「bonus — 毎日の…」のような壊れた説明になる。
 * (login-bonus / reward-catalog / point-packs などが該当した)
 *
 * そのため「メソッド + パス」を先に取り除いてから、残りの区切り記号を探す。
 */
function firstDoc(src) {
  const m = /^\/\*\*([\s\S]*?)\*\//.exec(src.trimStart());
  if (!m) return null;
  const lines = m[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean);

  for (const l of lines) {
    // 「GET /api/xxx」の部分を丸ごと取り除く
    const stripped = l.replace(
      /^(GET|POST|PATCH|PUT|DELETE)\s+\S*/i,
      '',
    );
    if (stripped === l) continue; // メソッド行ではない
    // 残りの先頭にある区切り記号だけを落とす
    const desc = stripped.replace(/^\s*[—–:\-]\s*/, '').trim();
    if (desc) return desc;
  }

  // メソッド行に説明が無い場合は、パス表記でない最初の行を使う
  for (const l of lines) {
    if (/^(GET|POST|PATCH|PUT|DELETE)\s/i.test(l)) continue;
    if (/^[#=\-]/.test(l)) continue;
    return l;
  }
  return null;
}

/**
 * route.ts が実装を別モジュールへ «委譲» している場合、ガードはそちら側にある。
 * route.ts だけを見ると「認証なし」と誤判定してしまう。
 *
 * 例: /api/v1/games/memory は handleMemoryGet を import しているだけで、
 *     requireGameVisible / requireApiPrincipal は memory-handlers.ts にある。
 *
 * ただし @/lib/errors のような «共通ヘルパ» まで辿ると、
 * その中に出てくる関数名を拾って全部が管理者API に見えてしまう
 * (実際に一度そうなった)。そこで
 *   「route.ts が実際に呼んでいる handleXxx / xxxHandler を
 *     export しているモジュール」だけ
 * に限定して辿る。
 */
function resolveDelegatedModules(src) {
  // export const GET = handle(handleMemoryGet) のような «委譲先の関数名» を集める
  const handlerNames = new Set();
  const re =
    /export\s+const\s+(?:GET|POST|PATCH|PUT|DELETE)\s*=\s*(?:handle\s*\()?\s*([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) handlerNames.add(m[1]);
  if (handlerNames.size === 0) return [];

  const out = [];
  const imp = /import\s*\{([^}]+)\}\s*from\s*['"]@\/(lib|auth)([^'"]*)['"]/g;
  while ((m = imp.exec(src)) !== null) {
    const named = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim());
    // その import が委譲先の関数を含んでいるときだけ対象にする
    if (!named.some((n) => handlerNames.has(n))) continue;
    const rel = `apps/web/src/${m[2]}${m[3]}`;
    for (const cand of [`${rel}.ts`, `${rel}/index.ts`]) {
      if (fs.existsSync(cand)) {
        out.push(cand);
        break;
      }
    }
  }
  return out;
}

const rows = [];
for (const file of walk(API_ROOT).sort()) {
  const own = fs.readFileSync(file, 'utf8');
  // 委譲先を1段だけ辿る
  const extra = resolveDelegatedModules(own)
    .map((f) => {
      try {
        return fs.readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
  const src = own + '\n/* ---- delegated ---- */\n' + extra;
  const methods = [];
  // メソッドの export は route.ts 自身にしかない
  for (const m of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
    // export const GET = ... / export async function GET(
    if (new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(own)) {
      methods.push(m);
    }
  }
  if (methods.length === 0) continue;

  const guards = [];
  for (const g of GUARDS) if (g.re.test(src)) guards.push(g);

  /**
   * 【誤分類の補正 1】
   * resolveApiSession は「未ログインでも null を返す」ヘルパだが、
   * 直後に自前で errors.unauthorized() を投げている実装がある
   * (例: /api/call/ice-servers)。この場合の実挙動は «会員必須» なので、
   * optional ではなく member に補正する。
   * (実機で 401 が返ることを確認して気づいた)
   */
  const selfUnauthorized =
    /resolveApiSession[\s\S]{0,400}?errors\.unauthorized\s*\(/.test(src) ||
    /resolveApiPrincipal[\s\S]{0,400}?errors\.unauthorized\s*\(/.test(src);
  if (selfUnauthorized) {
    guards.push({ key: 'member', label: '会員必須' });
  }

  /**
   * 【誤分類の補正 3】
   * cron 用エンドポイントは «x-cron-secret ヘッダ または 管理者» で守られている。
   * 認証ヘルパは resolveApiSession (= 未ログインでも null を返す) しか
   * 使っていないため、静的解析では «任意（未ログインでも可）» に見えてしまう。
   * 実際は secret も管理者権限も無ければ 403 になる。
   *
   * これを «任意» と書いてしまうと、仕様書に
   * 「誰でも誕生日メール一斉送信を叩ける」と書くことになり最悪なので、
   * 専用の cron 区分に補正する。
   * (実挙動: secret 無し・未ログインで 403 FORBIDDEN)
   */
  const isCronGuarded = /x-cron-secret/.test(src);
  if (isCronGuarded) {
    guards.push({ key: 'cron', label: 'Cron専用（secret または管理者）' });
  }

  /**
   * 【誤分類の補正 2】
   * メソッドごとに認証条件が違うルートがある
   * (例: /api/contents/comments は GET は公開、POST はプラン必須)。
   * 一括で「プラン必須」と書くと、GET も会員限定だと誤解される。
   * メソッド別に判定できた場合はそれを併記する。
   */
  const perMethod = {};
  for (const m of methods) {
    // export const GET = handle(async ... ) のブロックを切り出す
    const re = new RegExp(
      `export\\s+const\\s+${m}\\s*=[\\s\\S]*?(?=\\nexport\\s+const\\s+(?:GET|POST|PATCH|PUT|DELETE)\\s*=|$)`,
    );
    const block = re.exec(own)?.[0];
    if (!block) continue;
    const found = GUARDS.filter((g) => g.re.test(block));
    // cron secret はメソッド単位でも判定する
    // (例: /api/subscriptions/monthly-bonus は GET=会員 / POST=cron)
    if (/x-cron-secret/.test(block)) {
      found.push({ key: 'cron', label: 'Cron専用（secret または管理者）' });
    }
    if (found.length === 0) continue;
    const k = AUTH_ORDER.find((x) => found.some((g) => g.key === x));
    if (k) perMethod[m] = k;
  }
  const gates = GATES.filter((g) => g.re.test(src)).map((g) => g.label);

  // 最も強いガードを代表にする
  const primary = AUTH_ORDER.find((k) => guards.some((g) => g.key === k)) ?? 'public';
  const label =
    primary === 'public'
      ? '不要（公開）'
      : guards.find((g) => g.key === primary).label;

  rows.push({
    path: toApiPath(file),
    file: file.replace('apps/web/src/app/', ''),
    methods,
    auth: primary,
    authLabel: label,
    gates,
    bearer: guards.some((g) =>
      ['optional', 'member', 'plan', 'admin'].includes(g.key),
    ),
    cookieOnly: primary === 'cookie',
    // メソッドごとに条件が違う場合のみ入る (同じなら空)
    perMethod:
      Object.keys(perMethod).length > 1 &&
      new Set(Object.values(perMethod)).size > 1
        ? perMethod
        : null,
    doc: firstDoc(own),
  });
}

fs.writeFileSync('tools/api-docs/endpoints.json', JSON.stringify(rows, null, 2));
console.log('endpoints:', rows.length);
const by = {};
for (const r of rows) by[r.auth] = (by[r.auth] ?? 0) + 1;
console.log('by auth:', by);
console.log('cookieOnly:', rows.filter((r) => r.cookieOnly).map((r) => r.path));
