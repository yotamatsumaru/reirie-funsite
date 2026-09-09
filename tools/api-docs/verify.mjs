/**
 * 仕様書の «認証区分» が実際の挙動と一致するか検証する。
 *
 * 仕様書に嘘が載るのが最悪なので、GET のエンドポイントに対して
 *   - トークン無しで叩く
 *   - トークン有りで叩く
 * を実行し、書かれた区分と矛盾しないかを確かめる。
 *
 *   公開/任意 … トークン無しでも 401 にならない
 *   会員       … トークン無しなら 401 (または 404: 機能が非公開)
 */
import fs from 'node:fs';

const BASE = process.env.API_BASE ?? 'http://localhost:3111';
const EMAIL = process.env.API_EMAIL ?? 'fan@example.com';
const PASSWORD = process.env.API_PASSWORD ?? 'Test1234!';

const rows = JSON.parse(fs.readFileSync('tools/api-docs/endpoints.json', 'utf8'));

/**
 * トークンは «実際にログインして» 取得する。
 * 以前は /tmp に置いたトークンを読んでいたが、それだと
 * 他の人が実行できない / 期限切れに気づけないので毎回ログインする。
 */
async function login() {
  const res = await fetch(`${BASE}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    console.error(`ログイン失敗 (${res.status}): ${await res.text()}`);
    console.error(`\n開発サーバが ${BASE} で起動しているか確認してください。`);
    process.exit(1);
  }
  const json = await res.json();
  return json.accessToken;
}

const token = await login();

const targets = rows.filter(
  (r) =>
    r.methods.includes('GET') &&
    !/^\/api\/(admin|super-admin)/.test(r.path) &&
    !r.path.includes('[') && // 動的パスは ID が必要なので除外
    !r.path.includes('events') && // SSE は待たされるので除外
    ['public', 'optional', 'member', 'plan', 'cron'].includes(r.auth),
);

/**
 * cron 用エンドポイントは POST なので上の GET 検証では拾えない。
 * ただし «誰でも叩ける» と誤記すると被害が大きい
 * (誕生日メールの一斉送信・月次ボーナス付与を第三者が実行できると書くことになる)
 * ため、secret 無しで本当に弾かれるかを個別に確認する。
 */
const cronTargets = rows.filter(
  (r) => r.auth === 'cron' && !/^\/api\/(admin|super-admin)/.test(r.path),
);

async function code(path, withToken) {
  const res = await fetch(BASE + path, {
    headers: withToken ? { Authorization: `Bearer ${token}` } : {},
    redirect: 'manual',
  });
  return res.status;
}

const mismatches = [];
for (const r of targets) {
  const anon = await code(r.path, false);
  const auth = await code(r.path, true);

  // メソッドごとに条件が違うものは GET の条件で判定する
  const effective = r.perMethod?.GET ?? r.auth;

  if (effective === 'cron') {
    // secret も管理者権限も無いので 403 で弾かれるのが正しい
    if (anon !== 403 && anon !== 401 && anon !== 404) {
      mismatches.push(`${r.path}: 「${r.authLabel}」だがトークン無しで ${anon}`);
    }
  } else if (effective === 'member' || effective === 'plan') {
    // 会員必須なら、トークン無しでは通らないはず
    // (404 は「機能が非公開」で塞がれているケース。これも「通っていない」ので許容)
    // 422 は「必須クエリが無い」= 認証より前に弾かれたケース。
    // 認証区分の検証としては判定不能なのでスキップする。
    if (anon === 422) {
      console.log(`(skip) ${r.path} — 必須パラメータ不足で判定不能`);
      continue;
    }
    if (anon !== 401 && anon !== 404 && anon !== 403) {
      mismatches.push(`${r.path}: 「${r.authLabel}」だがトークン無しで ${anon}`);
    }
  } else {
    // 公開 / 任意 なら、トークン無しで 401 になってはいけない
    if (anon === 401) {
      mismatches.push(`${r.path}: 「${r.authLabel}」だがトークン無しで 401`);
    }
  }
  console.log(
    `${anon.toString().padStart(3)} / ${auth.toString().padStart(3)}  ${r.authLabel.padEnd(14)} ${r.path}`,
  );
}

// --- cron エンドポイント (POST) の検証 -----------------------------------
for (const r of cronTargets) {
  const res = await fetch(BASE + r.path, { method: 'POST', redirect: 'manual' });
  const status = res.status;
  // secret 無し・未ログインなら通ってはいけない
  if (status !== 403 && status !== 401) {
    mismatches.push(
      `${r.path}: 「${r.authLabel}」だが secret 無しの POST で ${status}`,
    );
  }
  console.log(`${status.toString().padStart(3)} / POST  ${r.authLabel.padEnd(14)} ${r.path}`);
}

console.log('\n=== 検証結果 ===');
console.log(`対象: ${targets.length + cronTargets.length} 本`);
if (mismatches.length === 0) {
  console.log('矛盾なし ✓');
} else {
  console.log(`矛盾 ${mismatches.length} 件:`);
  for (const m of mismatches) console.log('  !', m);
  process.exitCode = 1;
}
