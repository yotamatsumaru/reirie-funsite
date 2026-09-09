# 1on1 通話 — TURN サーバー設定手順

> **なぜこれが必要か（結論）**
> 現在 1on1 通話は **STUN のみ** で動いています。この状態だと
> **スマホのモバイル回線（4G/5G）から通話が繋がらないこと**があります。
> TURN を設定すると、この «繋がらない» をほぼ解消できます。
> **コードの変更は不要で、環境変数を 3 つ設定するだけ**です。

---

## 1. 用語（3 行で）

| 用語 | 役割 | たとえ |
|---|---|---|
| **STUN** | 自分のグローバル IP を教えてもらう | 「私の住所は何番地？」と聞く |
| **TURN** | 直接繋げない相手との通信を**中継**する | 直通で会えないので**郵便局を経由**する |
| ICE | 上記を使い最適な経路を選ぶ仕組み | 経路探し |

WebRTC は基本「端末どうしを直接（P2P）」繋ぎます。
しかし**直接繋げない回線**があり、そこで TURN が中継役になります。

---

## 2. なぜ STUN だけでは足りないのか

携帯キャリアの回線は **CGNAT（多重 NAT）** という構成が一般的で、
STUN で調べた住所に外から接続できず、**直接繋げません**。

繋がりにくい典型例：

- 📱 **スマホのモバイル回線（4G/5G）** ← ファンの方に最も多い
- 🏢 会社・学校のネットワーク（ファイアウォールで UDP 遮断）
- 🏨 ホテル・カフェの公衆 Wi-Fi

一般に **全体の 1〜2 割程度**が TURN 無しでは繋がらないとされています。
特典会で「繋がらない」という問い合わせが出るとしたら、まずここが原因です。

> ⚠️ **これは「PC とスマホの相性」の問題ではありません。**
> PC 同士でも、片方が制限の強い回線なら同じことが起こります。

---

## 3. 設定する環境変数（3 つ）

| 変数名 | 内容 | 例 |
|---|---|---|
| `TURN_URLS` | TURN サーバーの URL。複数は `,` か `;` 区切り | `turn:turn.example.com:3478,turns:turn.example.com:5349` |
| `TURN_USERNAME` | ユーザー名 | `abcd1234` |
| `TURN_CREDENTIAL` | パスワード | `xxxxxxxx` |

**3 つすべて揃っている場合のみ** TURN が有効になります。
1 つでも欠けると STUN のみで動作します（通話機能自体は止まりません）。

---

## 4. TURN サーバーの選び方

### 推奨：Cloudflare Calls（旧 Cloudflare TURN）

- 月 **1,000GB まで無料**（1on1 通話なら十分）
- サーバー構築・運用が不要
- 日本国内にも拠点があり遅延が小さい

**取得手順**

1. Cloudflare ダッシュボード → **Calls**（または Realtime）
2. 「**TURN App**」を作成
3. 表示される **TURN Server URL / Username / Credential** を控える

### 代替案

| 選択肢 | 費用 | 備考 |
|---|---|---|
| Twilio Network Traversal | 従量課金 | 実績豊富だが割高 |
| Metered TURN | 無料枠あり | 手軽 |
| coturn を自前構築（EC2） | サーバー代 | **運用の手間が大きく非推奨** |

> 💡 自前構築は、TLS 証明書の更新やポート開放（UDP 3478 等）の管理が必要です。
> 特典会の運用と並行するのは負担が大きいため、まず Cloudflare をおすすめします。

---

## 5. 本番環境への設定手順

このプロジェクトは **AWS SSM パラメータストア** から環境変数を読み込みます
（`deploy/user-data.sh` / `deploy/regenerate-env.sh`）。

### 手順 0：SSM のベースパスを確認する（推測しないこと）

パラメータは `/${APP_NAME}/${ENV_NAME}/...` という形式で保存されています。
**この値は環境ごとに異なる**ため、必ず実際の値を確認してください。

`regenerate-env.sh` を実行すると 1 行目に表示されます。

```bash
sudo bash ~/app/deploy/regenerate-env.sh | head -2
# → [regenerate-env] SSM base: /idol-fansite/dev (region: ap-northeast-1)
#                              ^^^^^^^^^^^^^^^^^ これがベースパス
```

> 💡 本番サーバーの実測値は **`/idol-fansite/dev`**（`APP_NAME=idol-fansite` / `ENV_NAME=dev`）でした。
> ホストによって異なる可能性があるため、作業するサーバー上で必ず確認してください。

### 手順 1：SSM にパラメータを登録

> 🚫 **EC2 サーバー上では実行できません（意図的な制限です）**
>
> EC2 のロールは **読み取りは全パス許可 / 書き込みは `cron/*` のみ** に
> 絞られています（`infra/lib/ec2-stack.ts`）。これは
> «サーバーが侵害されても Stripe の本番キー等を書き換えられない» ための
> 安全設計なので、**この制限を緩めないでください**。
>
> EC2 上で実行すると次のエラーになります（正常な動作です）。
> ```
> An error occurred (AccessDeniedException) when calling the PutParameter
> operation: ... is not authorized to perform: ssm:PutParameter
> ```
>
> **登録は手元の PC（管理者権限の AWS プロファイル）から行ってください。**
> サーバー上で行うのは「手順 2（反映）」だけです。

```bash
# ▼ 手元の PC で実行する（EC2 上ではない）
#    管理者権限のプロファイルを使う
export AWS_PROFILE=your-admin-profile

# 手順 0 で確認した値を入れる
SSM_BASE=/idol-fansite/dev
REGION=ap-northeast-1

aws ssm put-parameter --region "$REGION" --overwrite \
  --name "${SSM_BASE}/turn/urls" --type String \
  --value "turn:YOUR-TURN-HOST:3478,turns:YOUR-TURN-HOST:5349"

# 認証情報は SecureString（暗号化）で登録する
aws ssm put-parameter --region "$REGION" --overwrite \
  --name "${SSM_BASE}/turn/username" --type SecureString \
  --value "YOUR-USERNAME"

aws ssm put-parameter --region "$REGION" --overwrite \
  --name "${SSM_BASE}/turn/credential" --type SecureString \
  --value "YOUR-CREDENTIAL"
```

登録できたら、手元の PC で確認します。

```bash
aws ssm get-parameters-by-path --path "${SSM_BASE}/turn" \
  --region "$REGION" --query 'Parameters[].Name'
# → [ ".../turn/urls", ".../turn/username", ".../turn/credential" ]
```

> 既存パラメータの一覧を見たい場合：
> `aws ssm get-parameters-by-path --path "$SSM_BASE" --recursive --region "$REGION" --query 'Parameters[].Name'`

> 💡 **AWS CLI を使いたくない場合**はマネジメントコンソールからでも登録できます。
> Systems Manager → パラメータストア → 「パラメータの作成」で
> 名前に `/idol-fansite/dev/turn/urls` のようにフルパスを入力します
> （`urls` は「文字列」、`username` と `credential` は「安全な文字列」を選択）。

### 手順 2：サーバーに反映

**必ずアプリのディレクトリに移動してから実行してください。**
リポジトリ配置は環境により異なります（実測: `/home/ec2-user/app`）。

```bash
cd ~/app                      # 環境に合わせる。deploy/ がある場所
sudo bash deploy/regenerate-env.sh
```

反映後、**アプリを再起動します**。

```bash
bash ~/app/deploy/deploy.sh
```

> ⚠️ **`pm2 restart web` は使わないでください。**
> 環境変数は PM2 が `ecosystem.config.js` を **読み込む時**に
> `.env.production` からパースされます。`pm2 restart` は
> 既存プロセスの設定を使い回すため、**`.env.production` の変更が反映されません**。
> `deploy.sh` は `pm2 reload <ecosystem> --update-env` を実行し、
> 失敗時は `delete → start` で確実に立て直します。
>
> どうしても手動で行う場合は次のようにします。
> ```bash
> cd ~/app
> pm2 reload deploy/ecosystem.config.js --update-env \
>   || { pm2 delete web; pm2 start deploy/ecosystem.config.js; }
> pm2 save
> ```
>
> <details><summary>実験で確認した結果（クリックで展開）</summary>
>
> 同じ構成の最小再現環境で検証しました。
>
> ```
> 起動時                                   → MYVAR=BEFORE
> .env を AFTER に書き換え
> pm2 restart <name>                       → MYVAR=BEFORE  ← 反映されない
> pm2 reload <ecosystem> --update-env      → MYVAR=AFTER   ← 反映される
> ```
> </details>

成功すると次のように出力されます。

```
[regenerate-env] fetching TURN settings from SSM...
[regenerate-env]   set TURN_URLS = turn:tur… (len=52)
[regenerate-env]   set TURN_USERNAME = abcd123… (len=16)
[regenerate-env]   set TURN_CREDENTIAL = xxxxxxx… (len=32)
```

未設定の場合はこう出ます（**エラーではありません**）。

```
[regenerate-env]   skip TURN (未設定: STUN のみで動作します)
```

---

## 6. 設定できたかの確認

### 確認 A：API が TURN を返しているか

ログインした状態で以下にアクセスします（ブラウザでも可）。

```
https://<本番ドメイン>/api/call/ice-servers
```

**設定前**（STUN のみ）

```json
{"iceServers":[
  {"urls":"stun:stun.l.google.com:19302"},
  {"urls":"stun:stun1.l.google.com:19302"}]}
```

**設定後**（TURN が増える）

```json
{"iceServers":[
  {"urls":"stun:stun.l.google.com:19302"},
  {"urls":"stun:stun1.l.google.com:19302"},
  {"urls":["turn:turn.example.com:3478","turns:turn.example.com:5349"],
   "username":"testuser","credential":"testpass"}]}
```

> ⚠️ このエンドポイントは**ログイン必須**です（未ログインだと 401）。
> 認証情報を含むため、URL を第三者に共有しないでください。

### 確認 B：実際に中継されるか（推奨）

[Trickle ICE テストページ](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
に上記の TURN URL・ユーザー名・パスワードを入力し「Gather candidates」を実行します。

- `relay` という種別の候補が出れば **TURN は正常動作**
- `srflx` / `host` しか出ない場合は TURN が効いていません

### 確認 C：実機テスト（最終確認）

**スマホを Wi-Fi ではなくモバイル回線（4G/5G）にして** 通話してみてください。
Wi-Fi のままだとテストになりません（Wi-Fi では TURN 無しでも繋がることが多いため）。

---

## 7. うまくいかないときは

| 症状 | 確認すること |
|---|---|
| API に TURN が出ない | 3 つの変数がすべて設定されているか（1 つでも欠けると無効） |
| API に TURN が出ない | `bash deploy/deploy.sh` で再起動したか（`pm2 restart` では反映されません） |
| `AccessDeniedException` (`ssm:PutParameter`) | **EC2 上で登録しようとしている**。手元の PC の管理者プロファイルから実行する（EC2 は `cron/*` 以外書き込み不可。仕様です） |
| `No such file or directory` | アプリのディレクトリ（`cd ~/app` 等）に移動してから実行しているか |
| `Process or Namespace web not found` | PM2 に未登録。`pm2 start deploy/ecosystem.config.js` で起動する |
| `relay` 候補が出ない | 認証情報の有効期限切れ、URL のポート番号が正しいか |
| モバイル回線だけ繋がらない | `turns:`（TLS 版・ポート 5349）も併記すると改善することがあります |
| 音声だけ繋がり映像が出ない | 帯域不足の可能性。TURN とは別要因です |

---

## 8. 補足：セキュリティと費用

- 認証情報は **SecureString** で保存し、ログに出力しない設計です
  （`regenerate-env.sh` は先頭 8 文字のみ表示します）
- `/api/call/ice-servers` は**ログイン必須**にしてあり、認証情報が
  誰でも取得できる状態にはなっていません
- 現状は固定の認証情報を使う想定です。より厳密にするなら
  Cloudflare の Token API で**短命の認証情報**を都度発行する方式に
  拡張できます（`apps/web/src/app/api/call/ice-servers/route.ts` のコメント参照）
- TURN は**中継したときだけ**通信量を消費します。直接繋がる利用者の分は
  課金対象になりません

---

## 9. 関連ファイル

| ファイル | 役割 |
|---|---|
| `apps/web/src/app/api/call/ice-servers/route.ts` | ICE 設定を返す API |
| `apps/web/src/components/call/CallRoom.tsx` | 通話 UI / WebRTC 本体 |
| `deploy/user-data.sh` | 初回起動時の `.env.production` 生成 |
| `deploy/regenerate-env.sh` | 既存サーバーの環境変数更新 |
