# ReiRieRoom スマホアプリ向け API 仕様書

> このファイルは `tools/api-docs/` のスクリプトで **実コードから自動生成** しています。
> 手書きではないため実装とずれません。API を追加・変更したら再生成してください。
>
> ```bash
> node tools/api-docs/extract.mjs && node tools/api-docs/generate.mjs
> ```

最終生成: 2026-09-10 / アプリ向けエンドポイント **113 本**

---

## 1. 認証のしくみ

アプリは **Bearer トークン** を使います（Web はブラウザの Cookie）。
同じエンドポイントが両方に対応しているため、Web と同じ URL をそのまま呼べます。

### 1-1. ログイン

```http
POST /api/v1/auth/token
Content-Type: application/json

{ "email": "user@example.com", "password": "********" }
```

**レスポンス (200)**

```json
{
  "accessToken": "eyJhbGciOi...",   // 有効期限 1 時間
  "refreshToken": "eyJhbGciOi...",  // 更新用
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "user": {
    "id": "22222222-3333-4444-5555-666666666666",
    "email": "user@example.com",
    "displayName": "テストファン",
    "role": "USER",
    "plan": "FREE"
  }
}
```

### 1-2. 以降のリクエスト

```http
GET /api/me/card
Authorization: Bearer <accessToken>
```

### 1-3. トークンの更新

`accessToken` が切れたら（401 が返ったら）更新します。

```http
POST /api/v1/auth/token/refresh
Content-Type: application/json

{ "refreshToken": "<refreshToken>" }
```

### 1-4. SSE（リアルタイム通信）だけ例外

1on1 通話の待機列など Server-Sent Events を使うエンドポイントは、
`EventSource` がカスタムヘッダを送れないため **クエリパラメータ** で渡します。

```
GET /api/call/{roomId}/events?access_token=<accessToken>
```

---

## 2. 認証区分の読み方

一覧表の「認証」列は次の意味です。

| 表記 | 意味 | トークン |
|---|---|---|
| 公開 | 誰でも呼べる | 不要 |
| 任意 | 未ログインでも呼べるが、ログインすると内容が増える | あれば付ける |
| 会員 | ログイン必須 | **必須** |
| プラン | ログイン + プラン条件あり | **必須** |
| 管理者 | 運営専用（アプリでは通常使わない） | 必須 |
| 🔒 Cron専用 | サーバー内部の定期実行用。**アプリからは呼べません** | 不可 |

> **🔒 Cron専用 について**
> 誕生日メールの一斉送信や月次ボーナス付与など、**サーバーが自動実行する処理**です。
> `x-cron-secret` ヘッダ（または管理者権限）が必要で、
> 通常の会員トークンでは `403 FORBIDDEN` になります。アプリからは絶対に呼ばないでください。

「ゲート」列に記載があるものは、**運営が管理画面でその機能を非公開にしていると 404** になります。
アプリ側では「404 = 機能が閉じている」として、その画面を出さない扱いにしてください。

---

## 3. エラーレスポンス

エラーは全エンドポイント共通の形です。

```json
{ "error": { "code": "UNAUTHORIZED", "message": "ログインが必要です" } }
```

| HTTP | code | 意味 | アプリでの扱い |
|---|---|---|---|
| 400 | `BAD_REQUEST` | パラメータが不正 | 実装バグ。ログに残す |
| 401 | `UNAUTHORIZED` | 未ログイン / トークン無効・期限切れ | **トークン更新 → 失敗ならログイン画面へ** |
| 403 | `FORBIDDEN` | 権限なし | 「権限がありません」表示 |
| 403 | `PLAN_REQUIRED` | プランが足りない | **アップグレード案内を出す** |
| 404 | `NOT_FOUND` | 存在しない / **機能が非公開** | その画面・導線を隠す |
| 409 | `CONFLICT` | 競合（在庫切れ等） | 再取得して再表示 |
| 422 | `UNPROCESSABLE_ENTITY` | 入力値が不正 | 入力エラー表示 |
| 422 | `VALIDATION_ERROR` | スキーマ違反（`details` に詳細） | 入力エラー表示 |
| 422 | `PUI_INTEGRITY` | Pui 残高不足など | 「Pui が足りません」表示 |
| 429 | `RATE_LIMITED` | 回数上限（ゲームの1日上限など） | メッセージをそのまま表示 |
| 500 | `INTERNAL_ERROR` | サーバーエラー | リトライ or エラー表示 |

> **401 の扱いが最重要です。** `accessToken` は 1 時間で切れるため、
> 401 を受けたら自動でリフレッシュ → 元のリクエストを再送する処理を必ず入れてください。

---

## 4. ⚠️ アプリから使えない API

以下は **ブラウザの Cookie 前提** の実装で、Bearer トークンでは認証できません。
アプリでこれらが必要になったら、対応を別途ご相談ください。

| エンドポイント | 影響 |
|---|---|
| `/api/contact` | アプリからお問い合わせを送信できない |
| `/api/media/content-body-image/[id]` | **限定公開の画像がアプリで表示できない** |
| `/api/media/content-body-video/[id]` | **限定公開の本文動画がアプリで再生できない** |

> 画像・動画の 2 本は、ギャラリーや記事本文の**限定公開メディア**に影響します。
> 公開範囲が `PUBLIC` のものは表示できますが、会員限定のものは 404 になります。

---

## 5. エンドポイント一覧

### 5-1. 認証・アカウント

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| POST | `/api/auth/forgot-password` | 公開 | — | — |
| POST | `/api/auth/resend-verification-code` | 公開 | — | — |
| POST | `/api/auth/reset-password` | 公開 | — | — |
| POST | `/api/auth/signup` | 公開 | — | — |
| POST | `/api/auth/verify-email` | 公開 | — | — |
| GET | `/api/v1/auth/me` | 会員 | — | 現在の認証ユーザー情報と Pui 残高を返す |
| POST | `/api/v1/auth/token` | 公開 | — | email + password で API トークンを発行する |
| POST | `/api/v1/auth/token/refresh` | 公開 | — | refresh トークンで access トークンを再発行する |

### 5-2. 会員情報・Pui

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET / PATCH / DELETE | `/api/me` | 会員 | — | — |
| GET | `/api/me/card` | 会員 | — | 会員カード情報を取得 (会員番号を未付与なら採番する) |
| GET / POST / DELETE | `/api/me/email` | 会員 | — | … 現在のアドレスと、手続き中の申請の有無を返す |
| POST | `/api/me/email/verify` | 会員 | — | 確認コードを入力してメールアドレス変更を確定する |
| GET / POST | `/api/me/login-bonus` | 会員 | — | 毎日のログインボーナスを受け取る |
| GET | `/api/me/payments` | 会員 | — | — |
| GET | `/api/me/points` | 会員 | — | Pui 残高 & 取引履歴 (直近 50 件) |
| PUT | `/api/me/profile/preferred-name` | 会員 | — | REIRIE に呼んでほしい名前を更新 |
| GET / POST | `/api/me/social-share` | 会員 | — | SNS シェアによるポイント付与 (X のみ) |
| GET | `/api/me/summary` | 会員 | — | サイドバー等で使う会員概要 (プラン・ランク・保有 Pui) |

### 5-3. お知らせ

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/notices` | 任意 | — | 公開中のお知らせ一覧 |
| GET | `/api/notices/[id]` | 任意 | — | お知らせ詳細 |

### 5-4. ブログ・ギャラリー

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/contents` | 任意 | コンテンツ公開トグル | — |
| GET | `/api/contents/[slug]` | 任意 | コンテンツ公開トグル | — |
| GET | `/api/contents/albums` | 公開 | コンテンツ公開トグル | アルバムタブ用の一覧 (名前・絞り込みキー・件数) を返す。 |
| GET / POST | `/api/contents/comments` | GET:任意<br>POST:プラン | コンテンツ公開トグル | — |
| DELETE | `/api/contents/comments/[id]` | 会員 | — | — |

### 5-5. 動画

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/videos` | 任意 | — | — |
| GET | `/api/videos/[id]` | 会員 | — | — |
| GET | `/api/videos/[id]/hls/[...path]` | 会員 | — | HLS プレイリスト / セグメント プロキシ |
| POST | `/api/videos/[id]/playback` | 会員 | — | — |
| PATCH | `/api/videos/[id]/progress` | 会員 | — | 再生中のクライアントから視聴進捗を受け取り、視聴ログ 1 行を更新する。 |

### 5-6. ショップ・注文

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/cart` | 会員 | — | — |
| POST | `/api/cart/items` | 会員 | — | — |
| PATCH / DELETE | `/api/cart/items/[id]` | 会員 | — | — |
| GET | `/api/me/orders` | 会員 | — | — |
| GET | `/api/me/orders/[id]/invoice` | 会員 | — | 常に 404 (Not Found) を返す (ページ側 `notFound()` と同じ方針)。 |
| GET | `/api/me/orders/subscription/[paymentId]/invoice` | 会員 | — | 「支払明細書」を PDF でダウンロードする。 |
| GET | `/api/orders/[id]` | 会員 | — | — |
| POST | `/api/orders/checkout` | 会員 | — | — |
| GET | `/api/products` | 任意 | ショップ公開トグル | — |
| GET | `/api/products/[slug]` | 任意 | ショップ公開トグル | — |
| GET | `/api/products/categories` | 公開 | ショップ公開トグル | — |

### 5-7. サブスク

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| POST | `/api/subscriptions/cancel` | 会員 | — | — |
| POST | `/api/subscriptions/change-plan` | 会員 | — | — |
| POST | `/api/subscriptions/change-plan/cancel` | 会員 | — | — |
| POST | `/api/subscriptions/checkout` | 会員 | — | — |
| GET | `/api/subscriptions/me` | 会員 | — | — |
| GET / POST | `/api/subscriptions/monthly-bonus` | GET:会員<br>POST:🔒 Cron専用 | — | 月次ボーナスギフトを全アクティブ会員に付与する Cron 用エンドポイント。 |
| POST | `/api/subscriptions/portal` | 会員 | — | — |

### 5-8. Pui購入・景品交換

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/me/reward-catalog` | 会員 | — | 公開中の景品カタログ一覧 (会員向け) |
| GET | `/api/me/reward-downloads` | 会員 | — | その配布ファイル一覧を返す。 |
| GET | `/api/me/reward-downloads/[assetId]` | 会員 | — | (RewardRedemption が CANCELED 以外) であること。 |
| GET | `/api/me/reward-point-packs` | 会員 | — | 購入可能な Pui パック一覧 (会員向け) |
| POST | `/api/me/reward-points/purchase` | 会員 | — | 【2026-07 通貨名変更】URL 自体 (reward-points) は後方互換のため変更していない。 |
| GET / POST | `/api/me/reward-redemptions` | 会員 | — | 自分の景品交換履歴 |

### 5-9. ミニゲーム

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET / POST | `/api/me/games/acchi` | 会員 | ゲーム公開トグル | 本日の残りプレイ回数 & 残高を取得 |
| POST | `/api/me/games/acchi/buy-extra-play` | 会員 | ゲーム公開トグル | 実装本体は `/api/v1/games/acchi/buy-extra-play` と共通化されており、 |
| GET | `/api/me/games/memory` | 会員 | ゲーム公開トグル | 神経衰弱 (PUI メモリー) — 状態取得 |
| POST | `/api/me/games/memory/flip` | 会員 | ゲーム公開トグル | body: { index: number } |
| POST | `/api/me/games/memory/giveup` | 会員 | ゲーム公開トグル | 神経衰弱 — 途中でやめる |
| POST | `/api/me/games/memory/start` | 会員 | ゲーム公開トグル | 神経衰弱 — ゲーム開始 |
| GET / POST | `/api/me/games/slot` | 会員 | ゲーム公開トグル | 本日の残りプレイ回数・残高・配当表を取得 |
| POST | `/api/me/games/slot/buy-extra-play` | 会員 | ゲーム公開トグル | — |
| GET / POST | `/api/v1/games/acchi` | 会員 | ゲーム公開トグル | 本日の残りプレイ回数 & 残高 |
| GET | `/api/v1/games/acchi/assets` | 会員 | ゲーム公開トグル | あっちむいてPUI の表示素材 (キャラクター画像・ボイス) の URL を返す。 |
| POST | `/api/v1/games/acchi/buy-extra-play` | 会員 | ゲーム公開トグル | 実装本体は `/api/me/games/acchi/buy-extra-play` と共通化されており、 |
| GET | `/api/v1/games/memory` | 会員 | ゲーム公開トグル | 神経衰弱 (PUI メモリー) — 状態取得 |
| POST | `/api/v1/games/memory/flip` | 会員 | ゲーム公開トグル | body: { index: number } |
| POST | `/api/v1/games/memory/giveup` | 会員 | ゲーム公開トグル | 神経衰弱 — 途中でやめる |
| POST | `/api/v1/games/memory/start` | 会員 | ゲーム公開トグル | 神経衰弱 — ゲーム開始 |
| GET / POST | `/api/v1/games/slot` | 会員 | ゲーム公開トグル | 本日の残りプレイ回数・残高・配当表 |
| POST | `/api/v1/games/slot/buy-extra-play` | 会員 | ゲーム公開トグル | 実装本体は `/api/me/games/slot/buy-extra-play` と共通。 |

### 5-10. 恋愛ADV（ストーリー）

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/game/characters` | 公開 | ゲーム公開トグル | — |
| GET | `/api/game/characters/[slug]` | 任意 | ゲーム公開トグル | — |
| POST | `/api/game/gift` | 会員 | ゲーム公開トグル | PlayerProgress.affinity に affinityBoost を加算 |
| GET / POST | `/api/game/progress` | 会員 | ゲーム公開トグル | 自分の進捗 |
| POST | `/api/game/purchase` | 会員 | ゲーム公開トグル | — |
| GET / POST | `/api/game/save-slots` | 会員 | ゲーム公開トグル | セーブスロット一覧 |
| GET | `/api/game/scenarios/[id]` | 任意 | ゲーム公開トグル | — |
| POST | `/api/game/webhook` | 公開 | ゲーム公開トグル | Stripe Dashboard で `checkout.session.completed` イベントを購読する |

### 5-11. ReiRieRoom（MyRoom）

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/myroom/furnitures` | 公開 | MyRoom公開トグル | 会員向けの家具カタログ。 |

### 5-12. チケット・特典会

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/tickets/events` | 任意 | — | — |
| GET | `/api/tickets/events/[id]` | 任意 | — | — |
| GET / DELETE | `/api/tickets/link` | 会員 | — | — |
| POST | `/api/tickets/link/confirm` | 会員 | — | — |
| POST | `/api/tickets/link/start` | 会員 | — | — |
| GET | `/api/tickets/presale/grants` | 会員 | — | — |
| POST | `/api/tickets/presale/request` | 会員 | — | 1) ローチケ連携が LINKED 状態 |

### 5-13. 1on1通話

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/call/[roomId]/events` | 任意 | — | SSE (Server-Sent Events) でシグナリングメッセージを受信する。 |
| POST | `/api/call/[roomId]/signal` | 任意 | — | クライアントから offer / answer / ICE candidate を送信し、 |
| POST | `/api/call/events/[id]/enter-waiting` | 会員 | — | ファンが待機室ページにアクセスした際に呼ばれる "自動入室" エンドポイント。 |
| GET | `/api/call/events/[id]/queue/events` | 任意 | — | (Server-Sent Events) |
| GET | `/api/call/ice-servers` | 会員 | — | クライアント (CallRoom.tsx) が RTCPeerConnection を作成する直前に呼ぶ。 |
| POST | `/api/call/redeem` | プラン | — | シリアルコードを引き換えて CallTicket を発行する。 |
| GET | `/api/call/tickets/me` | 会員 | — | 自分の «まだ有効な» 1on1 チケット一覧 |

### 5-14. ライブ配信

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/live` | 任意 | — | — |
| POST | `/api/live/[id]/playback` | 会員 | — | — |

### 5-15. DM・お問い合わせ

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| POST | `/api/contact` | ⚠️ Cookie専用 | — | お問い合わせフォームの送信 (公開エンドポイント) |
| GET | `/api/me/contact-replies` | 会員 | — | 自分が受け取った運営からの返信一覧 |
| POST | `/api/me/contact-reply/read` | 会員 | — | マイページで運営からの返信 (お知らせ) を開いたときに既読化する。 |
| GET / POST | `/api/me/dm` | 会員 | DM公開トグル | 自分の DM 一覧 + 呼んでほしい名前 + NG ワード(クライアント事前判定用) |

### 5-16. 画像・メディア配信

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| GET | `/api/media/birthday-mail/[id]` | 公開 | — | (URL は uuid で推測困難。公開扱い)。 |
| GET | `/api/media/character-image/[id]` | 公開 | — | — |
| GET | `/api/media/content-body-image/[id]` | ⚠️ Cookie専用 | — | DB に保存された本文画像・ギャラリー写真を配信する (S3 未設定時のフォールバック保存先)。 |
| GET | `/api/media/content-body-video/[id]` | ⚠️ Cookie専用 | — | DB に保存されたブログ本文動画を配信する (S3 未設定時のフォールバック保存先)。 |
| GET | `/api/media/game-audio/[id]` | 公開 | — | — |
| GET | `/api/media/myroom-furniture/[id]` | 公開 | — | 【認証をかけていない理由】 |
| GET | `/api/media/product-image/[id]` | 公開 | — | — |
| GET | `/api/media/site-image/[id]` | 公開 | — | — |
| GET | `/api/media/video-thumbnail/[id]` | 公開 | — | DB (`Video.thumbnailData`) に保存された動画サムネイルを配信する。 |

### 5-17. その他

| メソッド | パス | 認証 | ゲート | 説明 |
|---|---|---|---|---|
| POST | `/api/cron/birthday-mail` | 🔒 Cron専用 | — | 誕生日メールの自動送信を実行する (冪等)。 |
| GET | `/api/maintenance-status` | 公開 | — | メンテナンスモードの ON/OFF だけを返す公開エンドポイント |
| POST | `/api/me/birthday-mail/read` | 会員 | — | マイページで誕生日メールを開いたときに既読化する。 |
| GET | `/api/postal-lookup` | 公開 | — | 郵便番号から住所を引く公開エンドポイント |

---

## 6. 主要レスポンス例

実際にローカル環境で取得した形です（値は型名に置き換えています）。

### GET /api/v1/auth/me

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "テストファン",
  "role": "USER",
  "plan": "FREE",
  "points": 156,
  "authSource": "bearer"
}
```

### GET /api/me/card

```json
{
  "memberNumber": "R-000123",
  "displayName": "テストファン",
  "email": "user@example.com",
  "points": 156,
  "plan": "FREE",
  "joinedAt": "2026-01-15T00:00:00.000Z"
}
```

### GET /api/me/points

```json
{
  "balance": 156,
  "transactions": [
    {
      "id": "uuid",
      "amount": 48,
      "balance": 156,
      "reason": "GAME_REWARD",
      "note": "神経衰弱 報酬",
      "createdAt": "2026-09-09T05:00:00.000Z"
    }
  ]
}
```

### GET /api/notices

```json
{
  "notices": [
    {
      "id": "uuid",
      "title": "お知らせタイトル",
      "body": "本文",
      "audience": "ALL",
      "publishedAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "hiddenCount": 2
}
```

### GET /api/contents?type=BLOG&page=1&limit=20

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "BLOG",
      "slug": "my-post",
      "title": "タイトル",
      "excerpt": "抜粋",
      "coverImageUrl": "/api/media/...",
      "accessLevel": "PUBLIC",
      "publishedAt": "2026-09-01T00:00:00.000Z",
      "authorName": "REIRIE",
      "tags": ["日常"],
      "viewCount": 120
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 42,
  "hasMore": true
}
```

### GET /api/contents/albums?type=GALLERY

```json
{
  "albums": [
    { "name": "2026 春ツアー", "key": "2026 春ツアー", "count": 12 },
    { "name": "その他", "key": "__none__", "count": 3 }
  ]
}
```

### GET /api/v1/games/slot

```json
{
  "date": "2026-09-09",
  "promoActive": false,
  "baseMaxPerDay": 5,
  "maxPerDay": 5,
  "playedToday": 0,
  "remaining": 5,
  "balance": 156,
  "maxPayout": 500,
  "payouts": { "SEVEN_TRIPLE": 500, "CHERRY_SINGLE": 8, "LOSE": 0 },
  "extraPlay": {
    "purchasedToday": 0,
    "maxPurchasesPerDay": 3,
    "costPui": 100,
    "canBuyMore": true
  }
}
```

### GET /api/me/contact-replies

```json
{
  "replies": [],
  "unreadCount": 0
}
```

### GET /api/maintenance-status

```json
{ "enabled": false }
```

---

## 7. 実装のヒント

### ページネーション

一覧系は `?page=1&limit=20` で、レスポンスに `page / limit / total / hasMore` が付きます。
`hasMore` が false になるまで読み進めてください。

### 画像 URL

`/api/media/...` のような**相対パス**で返ります。アプリではベース URL を前置してください。
（一部の API は絶対 URL で返します。`http` で始まるかを見て分岐すると安全です）

### 日時

すべて **ISO 8601 の UTC** です（例: `2026-09-09T05:00:00.000Z`）。
画面表示は日本時間へ変換してください。集計系（ゲームの1日上限など）は
サーバー側が日本時間で判定しています。

### 金額と Pui

金額は**円（整数）**、Pui も**整数**です。小数はありません。

### 機能の公開トグル

運営が管理画面で機能を非公開にすると、該当 API は **404** を返します。
403 ではなく 404 なのは、非公開の機能の存在自体を隠すためです。
アプリは 404 を「この機能は今使えない」と解釈し、タブや導線を隠してください。

---

## 8. この仕様書の正確性について

この仕様書は **実コードから自動生成** した上で、**実際にサーバーへリクエストして検証** しています。

```bash
# 抽出 → 生成 → 検証
node tools/api-docs/extract.mjs
node tools/api-docs/generate.mjs
node tools/api-docs/verify.mjs   # 認証区分が実挙動と一致するか確認
```

`verify.mjs` は GET エンドポイントを **トークン有り / 無しの両方** で叩き、
表に書かれた認証区分と実際の応答が矛盾しないかを確認します。
作成時点で **45 本を検証し矛盾ゼロ** です。

> 検証によって、コードの静的解析だけでは誤っていた **3 件** を発見・修正しました。
> ・`/api/call/ice-servers` … 「任意」と分類したが実際は 401（会員必須）
> ・`/api/contents/comments` … GET は公開、POST はプラン必須（メソッドで異なる）
> ・`/api/cron/birthday-mail` と `/api/subscriptions/monthly-bonus` (POST)
>   … 「任意（誰でも呼べる）」と分類したが実際は **403**。
>   誕生日メール一斉送信や月次ボーナス付与を第三者が実行できる、という
>   危険な誤記になっていたため 🔒 Cron専用 区分を追加した。
>
> API を追加したら再生成 + 再検証してください。
