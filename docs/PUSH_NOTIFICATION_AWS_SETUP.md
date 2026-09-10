# プッシュ通知（Amazon SNS）セットアップ手順書

スマホアプリの ①`POST/DELETE /api/push/devices` と ②「キュー遷移時の SNS Publish」を
動かすために必要な **AWS 側の作業**をまとめたものです。

---

## ⚠️ 最初に：この手順書の位置づけ

| | 状態 |
|---|---|
| **AWS の設定作業**（この手順書） | 👤 **お客様に実施いただく必要があります** |
| サーバー側のコード実装（①②） | 🤖 こちらで実装します（**AWS 設定完了後**） |
| アプリ側 | ✅ 実装済み（開発者様より） |

コード実装を先に済ませても、**AWS の設定が無いと 1 通も届きません**。
逆に、AWS の設定さえ終われば実装は短時間で入ります。
そのため **AWS 設定を先に進めていただく**のが最短です。

> 🔴 **こちらで実施できない理由**
> プラットフォームアプリケーションの作成には
> **Firebase と Apple Developer の認証情報**（お客様の資産）が必要です。
> また AWS への書き込み権限も、EC2 のロールには意図的に付与されていません
> （後述の「なぜ EC2 から登録できないのか」参照）。

---

## 0. 全体像（先に絵で把握してください）

```
 ① 端末登録
   アプリ ──[デバイストークン]──> POST /api/push/devices
                                      │
                                      ├─ SNS CreatePlatformEndpoint
                                      │    → エンドポイント ARN が返る
                                      └─ push_devices テーブルに保存

 ② 通知送信（スタッフが「次の人へ」を押したとき）
   POST /api/admin/call/events/{id}/next
        │
        ├─ 呼ばれた人  → SNS Publish(call_your_turn)  「順番です！」
        └─ 次の待機者  → SNS Publish(call_next)       「まもなくです」
                              │
                              ▼
                    SNS Platform Application
                       ├─ FCM  → Android
                       └─ APNs → iPhone
```

**ポイント**：SNS は「トピック」ではなく **エンドポイント ARN を直接 Publish** します
（1 人に 1 通送るため）。トピックの作成は不要です。

---

## 1. お客様にご用意いただくもの（チェックリスト）

このあとの作業で必要になるものです。**先に揃えてください。**

### Android（FCM）

- [ ] **Firebase プロジェクト**（アプリ開発者様が既にお持ちのはずです）
- [ ] **サービスアカウントの秘密鍵 JSON ファイル**（`service.json`）

> ⚠️ **「サーバーキー」ではありません。**
> 以前は「サーバーキー」という文字列を使う方式でしたが、
> **Google が 2024 年 6 月に廃止**しました。現在は JSON ファイルを使う
> **トークン方式（FCM HTTP v1）**が必須です。
> 古い記事を見て「サーバーキー」を探すと見つからず混乱しますのでご注意ください。

**取得手順（アプリ開発者様に依頼してください）**

1. [Firebase コンソール](https://console.firebase.google.com/) を開く
2. 対象プロジェクト → ⚙️ **プロジェクトの設定**
3. **サービス アカウント** タブ
4. 「**新しい秘密鍵の生成**」→ JSON ファイルがダウンロードされる

> 🔐 この JSON は**パスワードと同じ**です。メールやチャットに平文で貼らず、
> パスワード付き ZIP や共有ストレージ経由で受け渡してください。

### iOS（APNs）

- [ ] **APNs 認証キー**（`.p8` ファイル）
- [ ] **Key ID**（10 文字。例 `ABCD123456`）
- [ ] **Team ID**（10 文字。Apple Developer の右上に表示）
- [ ] **Bundle ID**（例 `jp.co.example.idolapp`）

**取得手順（アプリ開発者様に依頼してください）**

1. [Apple Developer](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles**
2. **Keys** → ＋ で新規作成
3. **Apple Push Notifications service (APNs)** にチェック → Continue → Register
4. `.p8` ファイルをダウンロード

> 🔴 **`.p8` は一度しかダウンロードできません。** 紛失したら作り直しになります。
> 必ず安全な場所に保管してください。

### AWS

- [ ] **管理者権限の AWS プロファイル**（手元の PC で `aws` コマンドが使える状態）
      またはマネジメントコンソールへのログイン

---

## 2. ⚠️ 開発用と本番用は別物です

APNs には **Sandbox（開発）** と **Production（本番）** の 2 つの環境があります。

| アプリの配布方法 | 使う環境 |
|---|---|
| Xcode から実機に直接インストール | **Sandbox** |
| TestFlight | **Production** |
| App Store | **Production** |

**トークンに互換性はありません。** 環境を間違えると
「エラーは出ないのに届かない」という一番厄介な症状になります。

そのため、**プラットフォームアプリケーションは 3 つ作成します**。

| 用途 | プラットフォーム |
|---|---|
| Android | `GCM`（FCM） |
| iOS 本番 | `APNS` |
| iOS 開発 | `APNS_SANDBOX` |

Android には Sandbox/Production の区別はありません（1 つで足ります）。

---

## 3. プラットフォームアプリケーションを作成する

### 方法 A：マネジメントコンソール（推奨・迷いにくい）

#### A-1. Android（FCM）

1. [Amazon SNS コンソール](https://console.aws.amazon.com/sns/home) を開く
2. **リージョンが `アジアパシフィック (東京) ap-northeast-1` になっているか確認**
   （他リージョンで作ると、アプリから見つからず原因究明に時間を取られます）
3. 左メニュー **プッシュ通知** → 「**プラットフォームアプリケーションの作成**」
4. 入力：
   - **アプリケーション名**：`idol-fansite-dev-android`
   - **プッシュ通知プラットフォーム**：`Firebase Cloud Messaging (FCM)`
   - **認証方法**：**トークン**（推奨）を選択
   - **サービス JSON ファイル**：手順 1 で取得した JSON をアップロード
5. 「**プラットフォームアプリケーションの作成**」
6. 表示された **ARN を控える**
   （例 `arn:aws:sns:ap-northeast-1:123456789012:app/GCM/idol-fansite-dev-android`）

#### A-2. iOS 本番

1. 同じく「プラットフォームアプリケーションの作成」
2. 入力：
   - **アプリケーション名**：`idol-fansite-dev-ios`
   - **プッシュ通知プラットフォーム**：`Apple iOS/VoIP/Mac`
   - **プッシュ証明書タイプ**：`トークン`
   - 「**本番稼働用に使用されます**」に **チェックを入れる**
   - **署名キー**：`.p8` ファイルをアップロード
   - **署名キー ID**：Key ID（10 文字）
   - **チーム ID**：Team ID（10 文字）
   - **バンドル ID**：アプリの Bundle ID
3. ARN を控える

#### A-3. iOS 開発

A-2 と同じ内容で、**「本番稼働用に使用されます」のチェックを外して**もう 1 つ作成します。
アプリケーション名は `idol-fansite-dev-ios-sandbox` としてください。

### 方法 B：AWS CLI（手元の PC で実行）

> 🚫 **EC2 サーバー上では実行しないでください**（次章の理由を参照）。

`.p8` と `service.json` を手元に置いた状態で実行します。

#### ⚠️ Android は「よく紹介されている書き方」では失敗します

ネット上の記事では次の形がよく紹介されていますが、**エラーになります**。

```bash
# 🚫 これは動きません
aws sns create-platform-application --platform GCM \
  --attributes PlatformCredential="$(cat service.json)"
```

```
Error parsing parameter '--attributes': Expected: '=', received: '"' for input:
PlatformCredential={"type":"service_account","project_id":...
                    ^
```

`--attributes` の `キー=値,キー=値` という短縮記法は
**値の中のカンマとダブルクォートを区切り文字として解釈してしまう**ためです。
service.json はカンマだらけなので必ず壊れます。

**回避策：`--attributes` 自体を JSON で渡します。**

**macOS / Linux（bash）**

```bash
export AWS_PROFILE=your-admin-profile
REGION=ap-northeast-1

# --- Android (FCM) ---
# service.json を「1 個の文字列」に畳んでから JSON の値として渡す
SERVICE_JSON=$(jq -c . < service.json)
ATTRS=$(jq -nc --arg c "$SERVICE_JSON" '{PlatformCredential:$c}')

aws sns create-platform-application --region "$REGION" \
  --name idol-fansite-dev-android \
  --platform GCM \
  --attributes "$ATTRS"

# --- iOS 本番 ---
# .p8 はカンマを含まないので短縮記法でも通る（改行も保持されます）
aws sns create-platform-application --region "$REGION" \
  --name idol-fansite-dev-ios \
  --platform APNS \
  --attributes \
PlatformCredential="$(cat AuthKey_ABCD123456.p8)",\
PlatformPrincipal=ABCD123456,\
ApplePlatformTeamID=TEAM123456,\
ApplePlatformBundleID=jp.co.example.idolapp

# --- iOS 開発 ---
# --platform を APNS_SANDBOX に、--name を ...-ios-sandbox に変えるだけ
```

**Windows（PowerShell）**

PowerShell は `export` も `VAR=値` も使えません。書き方が変わります。

```powershell
$env:AWS_PROFILE = "your-admin-profile"
$REGION = "ap-northeast-1"

# --- Android (FCM) ---
$ServiceJson = (Get-Content service.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 20)
$Attrs = @{ PlatformCredential = $ServiceJson } | ConvertTo-Json -Compress

aws sns create-platform-application --region $REGION `
  --name idol-fansite-dev-android `
  --platform GCM `
  --attributes $Attrs

# --- iOS 本番 ---
$P8 = Get-Content AuthKey_ABCD123456.p8 -Raw
$IosAttrs = @{
  PlatformCredential    = $P8
  PlatformPrincipal     = "ABCD123456"
  ApplePlatformTeamID   = "TEAM123456"
  ApplePlatformBundleID = "jp.co.example.idolapp"
} | ConvertTo-Json -Compress

aws sns create-platform-application --region $REGION `
  --name idol-fansite-dev-ios `
  --platform APNS `
  --attributes $IosAttrs
```

> 💡 行の継続はバックスラッシュ `\` ではなく **バッククォート `` ` ``** です。
> `\` を使うと `--name: 認識されません` のようなエラーになります。

> ✅ **上記 4 パターンは実際に AWS CLI（v1.46.1）で実行して検証済みです。**
> ローカルに受信サーバーを立てて送信内容を捕捉し、
> `.p8` の改行が保持されること・service.json が壊れずに届くことを確認しました。
> （エラーになる短縮記法の例も、上記のエラーメッセージを実際に再現したものです。）

---

## 4. SSM パラメータストアに ARN を登録する

アプリ本体は **SSM パラメータストア**から環境変数を読み込みます
（`deploy/user-data.sh` / `deploy/regenerate-env.sh`）。
手順 3 で控えた ARN をここに入れます。

### 手順 4-0：SSM のベースパスを確認する（推測しないこと）

パラメータは `/${APP_NAME}/${ENV_NAME}/...` の形式です。**環境ごとに違います。**

```bash
# サーバー上で実行
sudo bash ~/app/deploy/regenerate-env.sh | head -2
# → [regenerate-env] SSM base: /idol-fansite/dev (region: ap-northeast-1)
#                              ^^^^^^^^^^^^^^^^^ これ
```

> 💡 実測値は **`/idol-fansite/dev`** でした。ホストによって異なる可能性があるため、
> 作業するサーバー上で必ず確認してください。

### 🚫 なぜ EC2 サーバーから登録できないのか

EC2 のロールは **読み取りは全パス許可 / 書き込みは `cron/*` のみ**に絞られています
（`infra/lib/ec2-stack.ts` の `PutCronSecret`）。
これは「**サーバーが侵害されても Stripe の本番キー等を書き換えられない**」ための
安全設計です。**この制限は緩めないでください。**

EC2 上で実行すると次のエラーになります（**正常な動作です**）。

```
An error occurred (AccessDeniedException) when calling the PutParameter
operation: ... is not authorized to perform: ssm:PutParameter
```

**登録は手元の PC またはコンソールから**行ってください。

### 手順 4-1：登録

**macOS / Linux（bash）**

```bash
export AWS_PROFILE=your-admin-profile
SSM_BASE=/idol-fansite/dev        # 手順 4-0 で確認した値
REGION=ap-northeast-1

aws ssm put-parameter --region "$REGION" --overwrite \
  --name "${SSM_BASE}/push/sns/android-arn" --type String \
  --value "arn:aws:sns:ap-northeast-1:123456789012:app/GCM/idol-fansite-dev-android"

aws ssm put-parameter --region "$REGION" --overwrite \
  --name "${SSM_BASE}/push/sns/ios-arn" --type String \
  --value "arn:aws:sns:ap-northeast-1:123456789012:app/APNS/idol-fansite-dev-ios"

aws ssm put-parameter --region "$REGION" --overwrite \
  --name "${SSM_BASE}/push/sns/ios-sandbox-arn" --type String \
  --value "arn:aws:sns:ap-northeast-1:123456789012:app/APNS_SANDBOX/idol-fansite-dev-ios-sandbox"
```

**Windows（PowerShell）**

```powershell
$env:AWS_PROFILE = "your-admin-profile"
$SSM_BASE = "/idol-fansite/dev"
$REGION   = "ap-northeast-1"

aws ssm put-parameter --region $REGION --overwrite `
  --name "$SSM_BASE/push/sns/android-arn" --type String `
  --value "arn:aws:sns:ap-northeast-1:123456789012:app/GCM/idol-fansite-dev-android"
```

> ARN は秘密情報ではないため `String` で問題ありません
> （`.p8` や `service.json` は SNS 側に保管され、SSM には入れません）。

### 手順 4-2：確認

```bash
aws ssm get-parameters-by-path --path "${SSM_BASE}/push/sns" \
  --region "$REGION" --query 'Parameters[].Name'
```

3 つ表示されれば OK です。

> 💡 **コンソールから登録する場合**
> Systems Manager → パラメータストア → 「パラメータの作成」
> 名前に `/idol-fansite/dev/push/sns/android-arn` のように**フルパス**を入力し、
> タイプは「文字列」を選択します。

---

## 5. EC2 に SNS の権限を追加する（CDK の変更が必要）

現在の EC2 ロールには **SNS の権限がありません**。
このままだとサーバーから `CreatePlatformEndpoint` / `Publish` を呼べず、
次のエラーになります。

```
AccessDeniedException: ... is not authorized to perform: sns:CreatePlatformEndpoint
```

`infra/lib/ec2-stack.ts` に次の設定を追加する必要があります
（**コード変更はこちらで対応します**。デプロイのみお願いすることになります）。

```ts
// プッシュ通知 (Amazon SNS モバイルプッシュ)
// エンドポイントの作成・更新・削除と、個別端末への Publish のみ許可する。
// トピックの作成や購読者一覧の取得は不要なので付与しない。
role.addToPolicy(
  new iam.PolicyStatement({
    sid: 'MobilePushNotification',
    actions: [
      'sns:CreatePlatformEndpoint',
      'sns:GetEndpointAttributes',
      'sns:SetEndpointAttributes',
      'sns:DeleteEndpoint',
      'sns:Publish',
    ],
    resources: [
      // プラットフォームアプリケーションと、その配下のエンドポイント
      `arn:aws:sns:${this.region}:${this.account}:app/*/${config.appName}-${config.envName}-*`,
      `arn:aws:sns:${this.region}:${this.account}:endpoint/*/${config.appName}-${config.envName}-*/*`,
    ],
  }),
);
```

ARN はそれぞれ次の形式になるため、上のパターンで一致します。

```
プラットフォームアプリ : arn:aws:sns:<region>:<account>:app/GCM/idol-fansite-dev-android
エンドポイント（端末） : arn:aws:sns:<region>:<account>:endpoint/GCM/idol-fansite-dev-android/<uuid>
```

> 💡 **リソースを `*` にしない理由**
> `sns:Publish` を `*` にすると、**全 SNS トピックに送信できる**ロールになります。
> 万一サーバーが侵害された場合の影響範囲が大きく広がるため、
> このアプリのプラットフォームアプリケーション配下に限定しています。
>
> ⚠️ そのため **手順 3 のアプリケーション名は
> `idol-fansite-dev-` で始まる名前**にしてください。
> 別の名前で作ると、この権限では触れません
> （`AuthorizationError` になります）。
>
> なお `envName` は環境ごとに変わります（`dev` / `stg` / `prod`）。
> 手順 4-0 で確認したベースパスと同じ値です。

反映は CDK のデプロイです。

```bash
cd infra
pnpm cdk deploy '<Ec2スタック名>'
```

---

## 6. サーバーに反映する

```bash
cd ~/app                      # deploy/ がある場所（実測: /home/ec2-user/app）
git pull
sudo bash deploy/regenerate-env.sh
bash deploy/deploy.sh
```

> ⚠️ **`pm2 restart web` は使わないでください。**
> 環境変数は PM2 が `ecosystem.config.js` を**読み込む時**に
> `.env.production` からパースされます。`pm2 restart` は既存プロセスの設定を
> 使い回すため、**`.env.production` の変更が反映されません**
> （最小再現環境で検証済み。`restart` では古い値が残りました）。
> `deploy.sh` は `pm2 reload <ecosystem> --update-env` を実行し、
> 失敗時は `delete → start` で確実に立て直します。

---

## 7. 動作確認

### 7-1. AWS 側だけで確認する（アプリ不要）

まずアプリ抜きで「AWS の設定が正しいか」だけを切り分けます。
アプリ開発者様から**実機のデバイストークン**を 1 つもらってください。

```bash
REGION=ap-northeast-1
APP_ARN=arn:aws:sns:ap-northeast-1:123456789012:app/GCM/idol-fansite-dev-android
DEVICE_TOKEN=<実機のトークン>

# エンドポイントを作る
ENDPOINT_ARN=$(aws sns create-platform-endpoint --region "$REGION" \
  --platform-application-arn "$APP_ARN" \
  --token "$DEVICE_TOKEN" \
  --query 'EndpointArn' --output text)
echo "$ENDPOINT_ARN"

# テスト送信
# ⚠️ --message-structure json のときは "default" キーが必須です（無いと InvalidParameter）
aws sns publish --region "$REGION" \
  --target-arn "$ENDPOINT_ARN" \
  --message-structure json \
  --message '{"default":"順番が近づいています","GCM":"{\"notification\":{\"title\":\"テスト\",\"body\":\"届きましたか？\"},\"data\":{\"type\":\"call_next\"}}"}'
```

> 💡 `GCM` の値は **JSON を文字列にしたもの**（＝二重エスケープ）です。
> ここを普通の JSON オブジェクトにすると通りません。上記をそのままお使いください。
>
> iOS をテストする場合は `GCM` を `APNS`（Sandbox なら `APNS_SANDBOX`）に、
> 中身を `{\"aps\":{\"alert\":{\"title\":\"テスト\",\"body\":\"届きましたか？\"}}}` に変えます。

**ここで届けば AWS 側の設定は完了**です。届かない場合は次章へ。

### 7-2. アプリと繋いで確認する

サーバー実装が入ったあとの確認項目です。

| 確認項目 | 期待する結果 |
|---|---|
| アプリ起動 → `POST /api/push/devices` | `200 { "ok": true }` |
| DB `push_devices` | 行が 1 件増える |
| 同じ端末でもう一度ログイン | 行が**増えない**（重複しない） |
| スタッフが「次の人へ」 | 呼ばれた人に `call_your_turn` |
| 同上 | 次の待機者に `call_next` |
| ログアウト → `DELETE /api/push/devices/{token}` | `200`・DB から消える |
| ログアウト後にもう一度 Publish | **届かない** |

---

## 8. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| `InvalidParameter: Invalid parameter: Attributes Reason: Platform credentials are invalid` | FCM の JSON が壊れている / 古いサーバーキーを入れた | サービスアカウント JSON を再取得。**「サーバーキー」ではありません** |
| iOS だけ届かない | Sandbox / Production の取り違え | Xcode 直インストールは `APNS_SANDBOX`、TestFlight・App Store は `APNS` |
| エラーは出ないが届かない | 同上、またはエンドポイントが無効化されている | `aws sns get-endpoint-attributes` で `Enabled` を確認 |
| `EndpointDisabled` | トークンが失効（アプリ削除・再インストール） | エンドポイントを削除し、アプリ再起動時に再登録させる |
| `AccessDeniedException: sns:CreatePlatformEndpoint` | EC2 ロールに SNS 権限が無い | 手順 5 の CDK デプロイ |
| `AccessDeniedException: ssm:PutParameter` | EC2 上で登録しようとした | **正常な動作**。手元の PC から実行（手順 4） |
| `NotFound: PlatformApplication does not exist` | リージョン違い | 東京リージョン `ap-northeast-1` で作成したか確認 |
| PowerShell で `export : 用語 'export' は認識されません` | bash の書き方を使っている | `$env:AWS_PROFILE = "..."` に置き換え（手順 3 方法 B） |
| PowerShell で `--name: 認識されません` | 行継続に `\` を使っている | バックスラッシュ `\` → バッククォート `` ` `` |

---

## 9. サーバー実装の予定（参考）

AWS 設定が完了しだい、こちらで実装します。**お客様の作業はありません。**

### `push_devices` テーブル

```sql
CREATE TABLE push_devices (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         text NOT NULL,
  token_type    text NOT NULL,          -- 'fcm' | 'apns'
  platform      text NOT NULL,          -- 'android' | 'ios'
  endpoint_arn  text NOT NULL,
  app_version   text,
  last_seen_at  timestamp(3),
  created_at    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamp(3) NOT NULL,
  UNIQUE (token)
);
```

> `UNIQUE (token)` にする理由：
> **端末を家族で使い回したり、別アカウントでログインし直した**場合に、
> 同じトークンが複数ユーザーに紐づくと**他人の通知が届きます**。
> トークン単位で一意にし、登録時に `user_id` を上書きします。

### ① `POST /api/push/devices`

```http
POST /api/push/devices
Authorization: Bearer <token>
{ "token": "...", "tokenType": "fcm", "platform": "android", "appVersion": "1.0.0" }
→ 200 { "ok": true }
```

```http
DELETE /api/push/devices/{token}
→ 200 { "ok": true }
```

### ② キュー遷移時の Publish

`POST /api/admin/call/events/{id}/next`（スタッフの「次の人へ」）の
トランザクション**完了後**に送信します。

| 通知種別 | 送信先 | タイミング |
|---|---|---|
| `call_your_turn` | `IN_MAIN_ROOM` になった人 | 「次の人へ」実行時 |
| `call_next` | `aheadCount` が 0 になった人 | 同上 |
| `call_event_started` | 参加者全員 | イベントが `LIVE` になったとき |

> ⚠️ **トランザクション内では送信しません。**
> 送信は数百ミリ秒かかることがあり、DB ロックを保持したまま外部 API を叩くと
> 「次の人へ」ボタン全体が詰まります。また送信に失敗しても
> **キューの進行は止めてはいけません**（通知が届かないより、
> 進行が止まるほうが現場では致命的です）。失敗はログに残すだけにします。

---

## 10. まとめ：お願いする作業

| # | 作業 | 実施者 | 所要 |
|---|---|---|---|
| 1 | Firebase のサービスアカウント JSON を取得 | アプリ開発者様 | 5 分 |
| 2 | APNs 認証キー `.p8` / Key ID / Team ID / Bundle ID を取得 | アプリ開発者様 | 10 分 |
| 3 | SNS プラットフォームアプリケーションを 3 つ作成 | お客様（AWS） | 15 分 |
| 4 | ARN を SSM に登録（**手元の PC から**） | お客様（AWS） | 5 分 |
| 5 | CDK に SNS 権限を追加してデプロイ | コード変更はこちら / デプロイはお客様 | 10 分 |
| 6 | サーバー反映（`regenerate-env.sh` → `deploy.sh`） | お客様 | 5 分 |
| 7 | ①② のサーバー実装 | こちら | — |

**手順 3 で作成した 3 つの ARN をお知らせいただければ、実装に進めます。**
