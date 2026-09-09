# API 仕様書ジェネレータ

`docs/api/mobile-api.md`（スマホアプリ開発者に渡す API 仕様書）を
**実コードから自動生成 → 実サーバーで検証** するためのスクリプト群です。

手書きの仕様書は必ず実装とズレます。ズレた仕様書は
「書いてあるのに動かない」という最悪の状態を生むため、生成方式にしています。

## 使い方

```bash
# 1. 抽出: apps/web/src/app/api/**/route.ts を走査して endpoints.json を作る
node tools/api-docs/extract.mjs

# 2. 生成: endpoints.json から docs/api/mobile-api.md を書き出す
node tools/api-docs/generate.mjs

# 3. 検証: 実際にサーバーを叩いて「認証区分」が実挙動と合っているか確認
#    (開発サーバを起動しておくこと)
node tools/api-docs/verify.mjs
```

**API を追加・変更したら 1 → 2 を再実行**してください（3 も推奨）。

### verify.mjs の環境変数

| 変数 | 既定値 | 用途 |
|---|---|---|
| `API_BASE` | `http://localhost:3111` | 対象サーバー |
| `API_EMAIL` | `fan@example.com` | 検証用ログイン |
| `API_PASSWORD` | `Test1234!` | 同上 |

## ファイル

| ファイル | 役割 |
|---|---|
| `extract.mjs` | route.ts を走査し、パス / メソッド / 認証ガード / 公開トグル / JSDoc を抽出 |
| `endpoints.json` | 抽出結果（生成物。手で編集しない） |
| `generate.mjs` | Markdown 仕様書を生成 |
| `verify.mjs` | 実サーバーに投げて認証区分の記載を検証 |

## なぜ verify.mjs が必要か（重要）

静的解析だけでは **3 件の誤分類** が実際に発生しました。

1. `/api/call/ice-servers`
   `resolveApiSession`（未ログインでも null を返す）を使っているので「任意」に見えるが、
   直後に自前で `errors.unauthorized()` を投げており実際は **401**。
2. `/api/contents/comments`
   GET は公開、POST はプラン必須と **メソッドで条件が違う**。
   一括表記だと GET も会員限定だと誤解される。
3. `/api/cron/birthday-mail` / `/api/subscriptions/monthly-bonus` (POST)
   `x-cron-secret` ヘッダで守られているだけで認証ヘルパを通らないため「任意」に見えるが、
   実際は **403**。これを「誰でも呼べる」と書くと
   *誕生日メールの一斉送信や月次ボーナス付与を第三者が実行できる* という
   極めて危険な誤記になる。

いずれも **実際にリクエストして初めて分かった** ものです。
`extract.mjs` には「誤分類の補正 1〜3」としてコメント付きで対策が入っています。

## 注意点

- `endpoints.json` と `mobile-api.md` は **生成物**です。直接編集しても次回生成で消えます。
  文面を変えたい場合は `generate.mjs` を直してください。
- 生成は **決定的**です（同じコードなら同じ出力）。差分が出たら実装が変わった証拠です。
- 管理者用 API（`/api/admin`, `/api/super-admin`）はアプリ向け仕様書からは除外しています。
