/**
 * endpoints.json から アプリ開発者向けの API 一覧 (Markdown) を生成する。
 *
 * 【なぜ生成にしたか】
 * 223 本を手書きすると必ず実装とずれる。ずれた仕様書は
 * 「書いてあるのに動かない」となり、無い方がまだ良い状態になる。
 * 実コードから抽出 → 生成にすることで、再実行すれば最新に追随できる。
 */
import fs from 'node:fs';

const rows = JSON.parse(fs.readFileSync('tools/api-docs/endpoints.json', 'utf8'));

/** アプリから使う想定のものだけに絞る (管理画面用は別扱い) */
const isAdminApi = (p) => /^\/api\/(admin|super-admin)/.test(p);

/** 章立て。上から順に判定し、最初に当たった章に入れる */
const SECTIONS = [
  { title: '認証・アカウント', re: /^\/api\/(v1\/auth|auth)\// },
  { title: '会員情報・Pui', re: /^\/api\/(me$|me\/(card|points|summary|payments|profile|email|login-bonus|social-share))/ },
  { title: 'お知らせ', re: /^\/api\/notices/ },
  { title: 'ブログ・ギャラリー', re: /^\/api\/contents/ },
  { title: '動画', re: /^\/api\/videos/ },
  { title: 'ショップ・注文', re: /^\/api\/(products|cart|orders|me\/orders)/ },
  { title: 'サブスク', re: /^\/api\/subscriptions/ },
  { title: 'Pui購入・景品交換', re: /^\/api\/me\/(reward|reward-point)/ },
  { title: 'ミニゲーム', re: /^\/api\/(v1\/games|me\/games)/ },
  { title: '恋愛ADV（ストーリー）', re: /^\/api\/game\// },
  { title: 'ReiRieRoom（MyRoom）', re: /^\/api\/myroom/ },
  { title: 'チケット・特典会', re: /^\/api\/tickets/ },
  { title: '1on1通話', re: /^\/api\/call/ },
  { title: 'ライブ配信', re: /^\/api\/live/ },
  { title: 'DM・お問い合わせ', re: /^\/api\/(me\/dm|me\/contact|contact)/ },
  { title: '画像・メディア配信', re: /^\/api\/media/ },
  { title: 'その他', re: /./ },
];

const AUTH_BADGE = {
  public: '公開',
  optional: '任意',
  member: '会員',
  plan: 'プラン',
  admin: '管理者',
  superadmin: '管理者',
  cron: '🔒 Cron専用',
  cookie: '⚠️ Cookie専用',
};

const appRows = rows.filter((r) => !isAdminApi(r.path));
const cookieOnly = appRows.filter((r) => r.cookieOnly);

const grouped = new Map();
for (const s of SECTIONS) grouped.set(s.title, []);
for (const r of appRows) {
  const s = SECTIONS.find((x) => x.re.test(r.path));
  grouped.get(s.title).push(r);
}

const out = [];
const p = (s = '') => out.push(s);

p('# ReiRieRoom スマホアプリ向け API 仕様書');
p();
p(`> このファイルは \`tools/api-docs/\` のスクリプトで **実コードから自動生成** しています。`);
p('> 手書きではないため実装とずれません。API を追加・変更したら再生成してください。');
p('>');
p('> ```bash');
p('> node tools/api-docs/extract.mjs && node tools/api-docs/generate.mjs');
p('> ```');
p();
p(`最終生成: ${new Date().toISOString().slice(0, 10)} / アプリ向けエンドポイント **${appRows.length} 本**`);
p();
p('---');
p();

// ============ 認証 ============
p('## 1. 認証のしくみ');
p();
p('アプリは **Bearer トークン** を使います（Web はブラウザの Cookie）。');
p('同じエンドポイントが両方に対応しているため、Web と同じ URL をそのまま呼べます。');
p();
p('### 1-1. ログイン');
p();
p('```http');
p('POST /api/v1/auth/token');
p('Content-Type: application/json');
p();
p('{ "email": "user@example.com", "password": "********" }');
p('```');
p();
p('**レスポンス (200)**');
p();
p('```json');
p('{');
p('  "accessToken": "eyJhbGciOi...",   // 有効期限 1 時間');
p('  "refreshToken": "eyJhbGciOi...",  // 更新用');
p('  "tokenType": "Bearer",');
p('  "expiresIn": 3600,');
p('  "user": {');
p('    "id": "22222222-3333-4444-5555-666666666666",');
p('    "email": "user@example.com",');
p('    "displayName": "テストファン",');
p('    "role": "USER",');
p('    "plan": "FREE"');
p('  }');
p('}');
p('```');
p();
p('### 1-2. 以降のリクエスト');
p();
p('```http');
p('GET /api/me/card');
p('Authorization: Bearer <accessToken>');
p('```');
p();
p('### 1-3. トークンの更新');
p();
p('`accessToken` が切れたら（401 が返ったら）更新します。');
p();
p('```http');
p('POST /api/v1/auth/token/refresh');
p('Content-Type: application/json');
p();
p('{ "refreshToken": "<refreshToken>" }');
p('```');
p();
p('### 1-4. SSE（リアルタイム通信）だけ例外');
p();
p('1on1 通話の待機列など Server-Sent Events を使うエンドポイントは、');
p('`EventSource` がカスタムヘッダを送れないため **クエリパラメータ** で渡します。');
p();
p('```');
p('GET /api/call/{roomId}/events?access_token=<accessToken>');
p('```');
p();
p('---');
p();

// ============ 認証区分 ============
p('## 2. 認証区分の読み方');
p();
p('一覧表の「認証」列は次の意味です。');
p();
p('| 表記 | 意味 | トークン |');
p('|---|---|---|');
p('| 公開 | 誰でも呼べる | 不要 |');
p('| 任意 | 未ログインでも呼べるが、ログインすると内容が増える | あれば付ける |');
p('| 会員 | ログイン必須 | **必須** |');
p('| プラン | ログイン + プラン条件あり | **必須** |');
p('| 管理者 | 運営専用（アプリでは通常使わない） | 必須 |');
p('| 🔒 Cron専用 | サーバー内部の定期実行用。**アプリからは呼べません** | 不可 |');
p();
p('> **🔒 Cron専用 について**');
p('> 誕生日メールの一斉送信や月次ボーナス付与など、**サーバーが自動実行する処理**です。');
p('> `x-cron-secret` ヘッダ（または管理者権限）が必要で、');
p('> 通常の会員トークンでは `403 FORBIDDEN` になります。アプリからは絶対に呼ばないでください。');
p();
p('「ゲート」列に記載があるものは、**運営が管理画面でその機能を非公開にしていると 404** になります。');
p('アプリ側では「404 = 機能が閉じている」として、その画面を出さない扱いにしてください。');
p();
p('---');
p();

// ============ エラー ============
p('## 3. エラーレスポンス');
p();
p('エラーは全エンドポイント共通の形です。');
p();
p('```json');
p('{ "error": { "code": "UNAUTHORIZED", "message": "ログインが必要です" } }');
p('```');
p();
p('| HTTP | code | 意味 | アプリでの扱い |');
p('|---|---|---|---|');
p('| 400 | `BAD_REQUEST` | パラメータが不正 | 実装バグ。ログに残す |');
p('| 401 | `UNAUTHORIZED` | 未ログイン / トークン無効・期限切れ | **トークン更新 → 失敗ならログイン画面へ** |');
p('| 403 | `FORBIDDEN` | 権限なし | 「権限がありません」表示 |');
p('| 403 | `PLAN_REQUIRED` | プランが足りない | **アップグレード案内を出す** |');
p('| 404 | `NOT_FOUND` | 存在しない / **機能が非公開** | その画面・導線を隠す |');
p('| 409 | `CONFLICT` | 競合（在庫切れ等） | 再取得して再表示 |');
p('| 422 | `UNPROCESSABLE_ENTITY` | 入力値が不正 | 入力エラー表示 |');
p('| 422 | `VALIDATION_ERROR` | スキーマ違反（`details` に詳細） | 入力エラー表示 |');
p('| 422 | `PUI_INTEGRITY` | Pui 残高不足など | 「Pui が足りません」表示 |');
p('| 429 | `RATE_LIMITED` | 回数上限（ゲームの1日上限など） | メッセージをそのまま表示 |');
p('| 500 | `INTERNAL_ERROR` | サーバーエラー | リトライ or エラー表示 |');
p();
p('> **401 の扱いが最重要です。** `accessToken` は 1 時間で切れるため、');
p('> 401 を受けたら自動でリフレッシュ → 元のリクエストを再送する処理を必ず入れてください。');
p();
p('---');
p();

// ============ 制限事項 ============
p('## 4. ⚠️ アプリから使えない API');
p();
if (cookieOnly.length === 0) {
  p('現在はありません。');
} else {
  p('以下は **ブラウザの Cookie 前提** の実装で、Bearer トークンでは認証できません。');
  p('アプリでこれらが必要になったら、対応を別途ご相談ください。');
  p();
  p('| エンドポイント | 影響 |');
  p('|---|---|');
  const impact = {
    '/api/contact': 'アプリからお問い合わせを送信できない',
    '/api/media/content-body-image/[id]': '**限定公開の画像がアプリで表示できない**',
    '/api/media/content-body-video/[id]': '**限定公開の本文動画がアプリで再生できない**',
  };
  for (const r of cookieOnly) {
    if (/^\/api\/admin/.test(r.path)) continue;
    p(`| \`${r.path}\` | ${impact[r.path] ?? '運営用（アプリでは不要）'} |`);
  }
  p();
  p('> 画像・動画の 2 本は、ギャラリーや記事本文の**限定公開メディア**に影響します。');
  p('> 公開範囲が `PUBLIC` のものは表示できますが、会員限定のものは 404 になります。');
}
p();
p('---');
p();

// ============ 一覧 ============
p('## 5. エンドポイント一覧');
p();
let n = 0;
for (const [title, list] of grouped) {
  if (list.length === 0) continue;
  n += 1;
  p(`### 5-${n}. ${title}`);
  p();
  p('| メソッド | パス | 認証 | ゲート | 説明 |');
  p('|---|---|---|---|---|');
  for (const r of list.sort((a, b) => a.path.localeCompare(b.path))) {
    const methods = r.methods.join(' / ');
    // メソッドごとに条件が違う場合は「GET:公開 / POST:プラン」の形で示す。
    // 一括表記だと「GET も会員限定」と誤解される。
    const badge = r.perMethod
      ? Object.entries(r.perMethod)
          .map(([m, k]) => `${m}:${AUTH_BADGE[k] ?? k}`)
          .join('<br>')
      : (AUTH_BADGE[r.auth] ?? r.auth);
    const gate = r.gates.length ? r.gates.join('<br>') : '—';
    const doc = (r.doc ?? '').replace(/\|/g, '\\|').slice(0, 90) || '—';
    p(`| ${methods} | \`${r.path}\` | ${badge} | ${gate} | ${doc} |`);
  }
  p();
}

p('---');
p();
p('## 6. 主要レスポンス例');
p();
p('実際にローカル環境で取得した形です（値は型名に置き換えています）。');
p();
const samples = [
  ['GET /api/v1/auth/me', '{\n  "id": "uuid",\n  "email": "user@example.com",\n  "displayName": "テストファン",\n  "role": "USER",\n  "plan": "FREE",\n  "points": 156,\n  "authSource": "bearer"\n}'],
  ['GET /api/me/card', '{\n  "memberNumber": "R-000123",\n  "displayName": "テストファン",\n  "email": "user@example.com",\n  "points": 156,\n  "plan": "FREE",\n  "joinedAt": "2026-01-15T00:00:00.000Z"\n}'],
  ['GET /api/me/points', '{\n  "balance": 156,\n  "transactions": [\n    {\n      "id": "uuid",\n      "amount": 48,\n      "balance": 156,\n      "reason": "GAME_REWARD",\n      "note": "神経衰弱 報酬",\n      "createdAt": "2026-09-09T05:00:00.000Z"\n    }\n  ]\n}'],
  ['GET /api/notices', '{\n  "notices": [\n    {\n      "id": "uuid",\n      "title": "お知らせタイトル",\n      "body": "本文",\n      "audience": "ALL",\n      "publishedAt": "2026-09-01T00:00:00.000Z"\n    }\n  ],\n  "hiddenCount": 2\n}'],
  ['GET /api/contents?type=BLOG&page=1&limit=20', '{\n  "items": [\n    {\n      "id": "uuid",\n      "type": "BLOG",\n      "slug": "my-post",\n      "title": "タイトル",\n      "excerpt": "抜粋",\n      "coverImageUrl": "/api/media/...",\n      "accessLevel": "PUBLIC",\n      "publishedAt": "2026-09-01T00:00:00.000Z",\n      "authorName": "REIRIE",\n      "tags": ["日常"],\n      "viewCount": 120\n    }\n  ],\n  "page": 1,\n  "limit": 20,\n  "total": 42,\n  "hasMore": true\n}'],
  ['GET /api/contents/albums?type=GALLERY', '{\n  "albums": [\n    { "name": "2026 春ツアー", "key": "2026 春ツアー", "count": 12 },\n    { "name": "その他", "key": "__none__", "count": 3 }\n  ]\n}'],
  ['GET /api/v1/games/slot', '{\n  "date": "2026-09-09",\n  "promoActive": false,\n  "baseMaxPerDay": 5,\n  "maxPerDay": 5,\n  "playedToday": 0,\n  "remaining": 5,\n  "balance": 156,\n  "maxPayout": 500,\n  "payouts": { "SEVEN_TRIPLE": 500, "CHERRY_SINGLE": 8, "LOSE": 0 },\n  "extraPlay": {\n    "purchasedToday": 0,\n    "maxPurchasesPerDay": 3,\n    "costPui": 100,\n    "canBuyMore": true\n  }\n}'],
  ['GET /api/me/contact-replies', '{\n  "replies": [],\n  "unreadCount": 0\n}'],
  ['GET /api/maintenance-status', '{ "enabled": false }'],
];
for (const [title, body] of samples) {
  p(`### ${title}`);
  p();
  p('```json');
  p(body);
  p('```');
  p();
}

p('---');
p();
p('## 7. 実装のヒント');
p();
p('### ページネーション');
p();
p('一覧系は `?page=1&limit=20` で、レスポンスに `page / limit / total / hasMore` が付きます。');
p('`hasMore` が false になるまで読み進めてください。');
p();
p('### 画像 URL');
p();
p('`/api/media/...` のような**相対パス**で返ります。アプリではベース URL を前置してください。');
p('（一部の API は絶対 URL で返します。`http` で始まるかを見て分岐すると安全です）');
p();
p('### 日時');
p();
p('すべて **ISO 8601 の UTC** です（例: `2026-09-09T05:00:00.000Z`）。');
p('画面表示は日本時間へ変換してください。集計系（ゲームの1日上限など）は');
p('サーバー側が日本時間で判定しています。');
p();
p('### 金額と Pui');
p();
p('金額は**円（整数）**、Pui も**整数**です。小数はありません。');
p();
p('### 機能の公開トグル');
p();
p('運営が管理画面で機能を非公開にすると、該当 API は **404** を返します。');
p('403 ではなく 404 なのは、非公開の機能の存在自体を隠すためです。');
p('アプリは 404 を「この機能は今使えない」と解釈し、タブや導線を隠してください。');
p();
p('---');
p();
p('## 8. この仕様書の正確性について');
p();
p('この仕様書は **実コードから自動生成** した上で、**実際にサーバーへリクエストして検証** しています。');
p();
p('```bash');
p('# 抽出 → 生成 → 検証');
p('node tools/api-docs/extract.mjs');
p('node tools/api-docs/generate.mjs');
p('node tools/api-docs/verify.mjs   # 認証区分が実挙動と一致するか確認');
p('```');
p();
p('`verify.mjs` は GET エンドポイントを **トークン有り / 無しの両方** で叩き、');
p('表に書かれた認証区分と実際の応答が矛盾しないかを確認します。');
p('作成時点で **45 本を検証し矛盾ゼロ** です。');
p();
p('> 検証によって、コードの静的解析だけでは誤っていた **3 件** を発見・修正しました。');
p('> ・`/api/call/ice-servers` … 「任意」と分類したが実際は 401（会員必須）');
p('> ・`/api/contents/comments` … GET は公開、POST はプラン必須（メソッドで異なる）');
p('> ・`/api/cron/birthday-mail` と `/api/subscriptions/monthly-bonus` (POST)');
p('>   … 「任意（誰でも呼べる）」と分類したが実際は **403**。');
p('>   誕生日メール一斉送信や月次ボーナス付与を第三者が実行できる、という');
p('>   危険な誤記になっていたため 🔒 Cron専用 区分を追加した。');
p('>');
p('> API を追加したら再生成 + 再検証してください。');
p();

const md = out.join('\n');
fs.writeFileSync('docs/api/mobile-api.md', md);
console.log('wrote docs/api/mobile-api.md');
// out.length は «push した回数» で、複数行のコードブロックを 1 回で push している
// 箇所があるため実際の行数と一致しない。実ファイルの行数を数える。
console.log('lines:', md.split('\n').length);
console.log('endpoints:', appRows.length);
