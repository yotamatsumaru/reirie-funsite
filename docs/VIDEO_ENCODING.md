# 動画エンコード (MediaConvert + HLS) セットアップ手順

管理画面 `/admin/videos/new` で **「MediaConvert が未設定です」** と表示される場合の
設定手順書です。

## 全体構成

```
[管理者] 動画ファイル
    │ ① 署名付き PUT (/api/admin/videos/upload-url)
    ▼
[S3_VIDEO_BUCKET] source/YYYY/MM/<uuid>/<filename>   ← アップロード受け口 (非公開)
    │ ② MediaConvert CreateJob (/api/admin/videos/[id]/encode)
    │    Role = MEDIACONVERT_ROLE_ARN
    ▼
[S3_MEDIA_OUTPUT_BUCKET] hls/<videoId>/index.m3u8 + *.ts + thumbnail.*.jpg
    │ ③ EventBridge → video-job-complete Lambda
    │    POST /api/admin/videos/job-complete (x-cron-secret)
    │    → Video を READY 化 (s3HlsKey / thumbnailUrl / durationSeconds 確定)
    ▼
[CloudFront: CLOUDFRONT_VIDEO_DOMAIN]  ← オリジンは **出力バケット**
    │ ④ 署名付き URL (/api/videos/[id]/playback)
    ▼
[会員のブラウザ]  hls.js でプラン別画質に制限して再生
```

> **重要**: CloudFront 動画ディストリビューションのオリジンは
> **出力バケット (`S3_MEDIA_OUTPUT_BUCKET`)** です。
> HLS をアップロード受け口バケットに出力すると、CloudFront から参照できず
> 再生時に 403/404 になります。

---

## 必要な環境変数

### エンコード実行に必須（これが無いと「未設定です」表示になる）

| 変数 | 説明 |
| --- | --- |
| `S3_VIDEO_BUCKET` | アップロード受け口バケット（MediaConvert の入力元） |
| `S3_MEDIA_OUTPUT_BUCKET` | HLS 出力先バケット。未設定時は `S3_VIDEO_BUCKET` にフォールバック |
| `MEDIACONVERT_ROLE_ARN` | **MediaConvert が引き受ける IAM ロール ARN** |
| `AWS_REGION` | 既定 `ap-northeast-1` |

`MEDIACONVERT_ROLE_ARN` は「ジョブ投入元 (EC2) の権限」とは別物です。
MediaConvert はジョブに指定されたロールを自分で引き受けて S3 を読み書きするため、
**このロールが無いと CreateJob が必ず失敗します。**

### 再生に必須（エンコードはできるが再生できない場合）

| 変数 | 説明 |
| --- | --- |
| `CLOUDFRONT_VIDEO_DOMAIN` | 動画配信ディストリビューションのドメイン |
| `CLOUDFRONT_KEY_PAIR_ID` | 署名付き URL 用のパブリックキー ID |
| `CLOUDFRONT_PRIVATE_KEY` | 署名用の秘密鍵 (PEM) |

### 完了時の自動公開に必要

| 変数 | 説明 |
| --- | --- |
| `CRON_SECRET` | `video-job-complete` Lambda と共有する認証シークレット |

未設定でも動作しますが、エンコード完了後に管理画面から
**「手動で公開（READY化）」** を押す必要があります。

### 任意（既定値で動作）

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `MEDIACONVERT_OUTPUT_PREFIX` | `hls` | 出力プレフィックス |
| `MEDIACONVERT_QUALITIES` | `480p,720p,1080p` | 出力レンディション |
| `MEDIACONVERT_SEGMENT_SECONDS` | `6` | HLS セグメント長（秒） |
| `MEDIACONVERT_ENDPOINT` | (自動解決) | アカウント固有エンドポイント |
| `MEDIACONVERT_QUEUE_ARN` | (デフォルトキュー) | 専用キューを使う場合 |

---

## 手順 A: CDK でセットアップする（推奨）

`infra/lib/storage-stack.ts` が MediaConvert ロールを作成し、
必要な値を SSM Parameter Store に自動登録します。

```bash
# 1. Storage スタックを更新 (MediaConvert ロール + SSM パラメータを作成)
pnpm --filter @idol/infra cdk deploy 'idol-fansite-dev-storage'

# 2. EC2 スタックを更新 (PassRole 権限 + .env.production への注入)
pnpm --filter @idol/infra cdk deploy 'idol-fansite-dev-ec2'
```

作成される SSM パラメータ:

| パラメータ | 対応する環境変数 |
| --- | --- |
| `/<app>/<env>/mediaconvert/role-arn` | `MEDIACONVERT_ROLE_ARN` |
| `/<app>/<env>/mediaconvert/output-prefix` | `MEDIACONVERT_OUTPUT_PREFIX` |
| `/<app>/<env>/s3/media-output-bucket` | `S3_MEDIA_OUTPUT_BUCKET` |
| `/<app>/<env>/cloudfront/video-domain` | `CLOUDFRONT_VIDEO_DOMAIN` |
| `/<app>/<env>/cloudfront/asset-domain` | `CLOUDFRONT_ASSET_DOMAIN` |

### 既存インスタンスに反映する

EC2 を作り直さずに `.env.production` を更新する場合:

```bash
# SSM Session Manager で EC2 に接続してから
sudo -i -u ec2-user        # ⚠️ 必須: 接続直後は ssm-user のため Permission denied になる
cd ~/app

bash deploy/regenerate-env.sh
bash deploy/deploy.sh      # PM2 再起動で反映
```

`regenerate-env.sh` は SSM から MediaConvert / CloudFront / CRON_SECRET を読み直し、
不足があれば警告を出します。

---

## 手順 B: 手動でロールを作る場合

CDK を使わない場合は、以下の信頼ポリシーを持つロールを作成します。

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "mediaconvert.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

権限ポリシー（バケット名は実際の値に置換）:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSourceVideos",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": "arn:aws:s3:::<VIDEO_BUCKET>/source/*"
    },
    {
      "Sid": "ListSourceBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::<VIDEO_BUCKET>"
    },
    {
      "Sid": "WriteHlsOutput",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<MEDIA_OUTPUT_BUCKET>/hls/*"
    },
    {
      "Sid": "ListOutputBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::<MEDIA_OUTPUT_BUCKET>"
    }
  ]
}
```

さらに、ジョブを投入する側（EC2 のインスタンスロール）に以下が必要です:

```json
{
  "Effect": "Allow",
  "Action": [
    "mediaconvert:CreateJob",
    "mediaconvert:GetJob",
    "mediaconvert:ListJobs",
    "mediaconvert:DescribeEndpoints"
  ],
  "Resource": "*"
},
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "<作成したロールの ARN>",
  "Condition": {
    "StringEquals": { "iam:PassedToService": "mediaconvert.amazonaws.com" }
  }
}
```

---

## エンコード出力仕様

`apps/web/src/lib/mediaconvert.ts` で定義しています。

| 画質 | 解像度 | 最大ビットレート | プロファイル |
| --- | --- | --- | --- |
| 480p | 854x480 | 1.2 Mbps | H.264 Main |
| 720p | 1280x720 | 3.0 Mbps | H.264 Main |
| 1080p | 1920x1080 | 6.0 Mbps | H.264 High |

- レート制御: **QVBR**（品質基準の可変ビットレート）
- 音声: AAC-LC 128kbps / 48kHz / ステレオ
- GOP 長をセグメント長に揃え、`GopClosedCadence=1` で ABR 切り替えを安定化
- 入力の回転メタデータは `Rotate: AUTO` で自動補正（スマホ縦動画対応）
- サムネイル: `FRAME_CAPTURE` で 1 枚を `hls/<videoId>/thumbnail.0000000.jpg` に出力

プラン別の再生上限画質は `packages/shared/src/plan-benefits.ts` の
`MAX_VIDEO_QUALITY`（FREE=480p / STANDARD=720p / PREMIUM=1080p）で、
`HlsPlayer` の `maxHeight` によりクライアント側でレンディションを制限します。

---

## 手順 C: 実 AWS 環境へのデプロイとジョブ実行の検証

サンドボックスには AWS 認証情報が無いため、実際のジョブ実行は未検証です。
以下の順で本番/開発環境で確認してください。

前提値（`infra/cdk.json` の context）:

| 項目 | 値 |
| --- | --- |
| `appName` | `idol-fansite` |
| `envName` | `dev` |
| `region` | `ap-northeast-1` |
| `account` | `700918785224` |

### ⚠️ 最重要: 環境変数に頼らないコマンドを使う

`$env:APP` などの環境変数は **ターミナルを閉じると消えます**。
空のまま実行すると文字列連結が壊れ、次のような分かりにくい失敗をします。

| 書いたコマンド | 変数が空だと | 症状 |
| --- | --- | --- |
| `"$($env:APP)-$($env:ENV)-ec2"` | `--ec2` | `Since this app includes more than a single stack...` |
| `"/$($env:APP)/$($env:ENV)/mediaconvert/role-arn"` | `///mediaconvert/role-arn` | `can't be prefixed with "ssm"` |
| `--target $instanceId` | `--target` (値なし) | `expected one argument` |

**そのため本ドキュメントでは、以下の「変数を使わない版」を推奨します。**
値をベタ書きするので、ターミナルを開き直しても必ず動きます。

```powershell
# deploy — リポジトリに用意済みの npm script を使う (ワイルドカード指定)
cd $HOME\dev\reirie-funsite\infra
pnpm run deploy:storage      # = cdk deploy '*-storage' --require-approval never
pnpm run deploy:ec2          # = cdk deploy '*-ec2'     --require-approval never

# SSM 確認 — パスをベタ書き
aws ssm get-parameter --name "/idol-fansite/dev/mediaconvert/role-arn" `
  --query "Parameter.Value" --output text

aws ssm get-parameters-by-path --path "/idol-fansite/dev" --recursive `
  --query "Parameters[].Name" --output table

# EC2 接続 — ID を目で確認してから貼る
aws ec2 describe-instances `
  --filters "Name=tag:Application,Values=idol-fansite" `
            "Name=instance-state-name,Values=running" `
  --query "Reservations[].Instances[].[InstanceId,Tags[?Key=='Name'].Value|[0]]" `
  --output table

aws ssm start-session --target i-xxxxxxxxxxxxxxxxx   # ← 上で表示された ID に置換
# 接続後は必ず: sudo -i -u ec2-user   (ssm-user では Permission denied)
```

変数を使いたい場合は、**空でないことを必ず検証**してください。

```powershell
$env:APP = "idol-fansite"; $env:ENV = "dev"
if (-not $env:APP -or -not $env:ENV) { throw "APP/ENV が未設定です" }
"stack = $($env:APP)-$($env:ENV)-ec2"   # 目視確認してから実行する
```

### C-0. 事前準備（シェル別）

以降のコマンドは **bash（macOS / Linux / EC2 上）** と
**PowerShell（Windows）** で書き方が違います。自分の環境に合わせてください。

#### Windows / PowerShell の場合

`export` は bash 専用のコマンドです。PowerShell では `$env:` を使います。

```powershell
# 共通変数 (PowerShell)
$env:APP = "idol-fansite"
$env:ENV = "dev"
$env:AWS_REGION = "ap-northeast-1"

# 変数の展開は ${APP} ではなく $env:APP を使う
# 文字列連結する場合は "$($env:APP)-$($env:ENV)-storage" と書く
```

また、`cdk` コマンドは**リポジトリの `infra` ディレクトリ内**で実行する必要があります。
まだクローンしていない場合:

```powershell
# 任意の作業ディレクトリへ
cd $HOME\dev            # 無ければ mkdir $HOME\dev

git clone https://github.com/yotamatsumaru/reirie-funsite.git
cd reirie-funsite

# 依存インストール (初回のみ。Node.js 20.20+ と pnpm 9+ が必要)
pnpm install

# infra ディレクトリへ移動
cd infra
```

`pnpm` が無い場合:

```powershell
npm install -g pnpm@9.15.9
```

#### ⚠️ 必須: Lambda のビルド（`CannotFindAsset` 対策）

```
«CannotFindAsset» Cannot find asset at ...\functions\stripe-webhook\dist
```

上のエラーで `cdk diff` / `cdk deploy` が失敗する場合、
**`functions/stripe-webhook/dist` が未ビルド**です。

`functions/*/dist/` は `.gitignore` 対象（コミットされない）ため、
**クローン直後は必ず存在しません**。
かつ CDK は 1 スタックだけ指定しても `bin/app.ts` 全体を評価するため、
`WebhookStack` の `lambda.Code.fromAsset()` が解決できず、
**Storage / EC2 の deploy も道連れで失敗します。**

そのため、`cdk` を実行する前に必ず以下を実行してください。

```powershell
# リポジトリルートで
cd $HOME\dev\reirie-funsite

# 1. Prisma Client を生成 (Lambda が使う。エンジン .so.node もここで生成される)
pnpm db:generate

# 2. Stripe Webhook Lambda をビルド (dist/index.js + Prisma エンジンを配置)
pnpm --filter @idol/stripe-webhook build:full

# 3. 生成されたか確認 (index.js と .so.node があること)
dir functions\stripe-webhook\dist
```

bash の場合:

```bash
pnpm db:generate
pnpm --filter @idol/stripe-webhook build:full
ls -la functions/stripe-webhook/dist
```

期待される内容:

```
index.js
index.js.map
libquery_engine-rhel-openssl-3.0.x.so.node
```

ビルドが通ってから `cd infra` して `cdk` を実行します。

> 💡 `video-job-complete` Lambda は現時点で CDK に組み込まれていないため、
> こちらのビルドは `cdk` の実行には不要です。

#### bash（macOS / Linux）の場合

```bash
export APP=idol-fansite
export ENV=dev
export AWS_REGION=ap-northeast-1

git clone https://github.com/yotamatsumaru/reirie-funsite.git
cd reirie-funsite && pnpm install && cd infra
```

### C-1. 認証情報の確認

```bash
aws sts get-caller-identity
# Account が 700918785224 であることを確認
```

> ⚠️ 上の実行例では `Arn` が `arn:aws:iam::700918785224:root` になっていました。
> **ルートアカウントのアクセスキーでの運用は非推奨**です。
> 本番運用では IAM ユーザー / ロールに切り替えてください
> （ルートキーは無効化が AWS の推奨）。
> 検証目的で続行する場合はそのままでも動作します。

### C-2. 差分を確認してから deploy

いきなり deploy せず、必ず `diff` で変更内容を確認します。

```bash
cd infra

# Storage: MediaConvert ロール + SSM パラメータが追加されることを確認
pnpm cdk diff "${APP}-${ENV}-storage"

# EC2: iam:PassRole / ssm:PutParameter と UserData の変更を確認
pnpm cdk diff "${APP}-${ENV}-ec2"
```

`diff` に以下が出ていれば期待どおりです。

- `[+] AWS::IAM::Role` … `idol-fansite-dev-mediaconvert-role`
- `[+] AWS::SSM::Parameter` … `mediaconvert/role-arn` ほか計 5 個
- EC2 側 `[~] AWS::IAM::Policy` … `iam:PassRole` と `ssm:PutParameter`

> ⚠️ EC2 スタックは UserData を変更すると**インスタンスが置き換わる**ことがあります。
> `diff` の `may be replaced` 表示を必ず確認してください。
> 既存インスタンスを維持したい場合は **EC2 スタックを deploy せず**、
> Storage だけ deploy して C-5 の手順で `.env.production` を更新します。

```bash
# 1. Storage (ロール + SSM。既存リソースへの破壊的変更なし)
pnpm cdk deploy "${APP}-${ENV}-storage" --require-approval never

# 2. EC2 (IAM 権限 + UserData。置き換えの可否を確認したうえで)
pnpm cdk deploy "${APP}-${ENV}-ec2"
```

### C-3. SSM パラメータが作成されたか確認

```bash
aws ssm get-parameters-by-path \
  --path "/${APP}/${ENV}" --recursive \
  --query 'Parameters[].Name' --output table
```

以下が存在すれば OK です。

```
/idol-fansite/dev/mediaconvert/role-arn
/idol-fansite/dev/mediaconvert/output-prefix
/idol-fansite/dev/s3/media-output-bucket
/idol-fansite/dev/cloudfront/video-domain
/idol-fansite/dev/cloudfront/asset-domain
```

ロール ARN の実値:

```bash
aws ssm get-parameter --name "/${APP}/${ENV}/mediaconvert/role-arn" \
  --query 'Parameter.Value' --output text
# → arn:aws:iam::700918785224:role/idol-fansite-dev-mediaconvert-role
```

### C-4. EC2 に接続する（⚠️ `ssm-user` → `ec2-user` の切り替えが必須）

```bash
aws ssm start-session --target <instance-id>
```

接続すると `sh-5.2$` というプロンプトになりますが、
このとき**ログインユーザーは `ec2-user` ではなく `ssm-user`** です。
アプリは `/home/ec2-user/app` にあり、このディレクトリは
パーミッション `700`（所有者のみアクセス可）なので、
そのままスクリプトを叩くと必ず失敗します。

```
sh-5.2$ bash /home/ec2-user/app/deploy/regenerate-env.sh
bash: /home/ec2-user/app/deploy/regenerate-env.sh: Permission denied
```

**接続直後に必ず `ec2-user` へ切り替えてください。**

```bash
sudo -i -u ec2-user
```

切り替わったことを確認します。

```bash
whoami   # → ec2-user
pwd      # → /home/ec2-user
```

> `sudo -i` （ログインシェル）である点が重要です。
> `sudo -u ec2-user bash` だと `$HOME` が `/home/ssm-user` のままになり、
> `nvm` / `pnpm` / `pm2` が見つからず別のエラーになります。

切り替え後、MediaConvert の疎通を確認します。

```bash
# アカウント固有エンドポイントが取れるか (mediaconvert:DescribeEndpoints 権限の確認)
aws mediaconvert describe-endpoints --region ap-northeast-1

# ロールが存在し ARN が一致しているか
aws iam get-role --role-name "idol-fansite-dev-mediaconvert-role" \
  --query 'Role.Arn' --output text
# → arn:aws:iam::700918785224:role/idol-fansite-dev-mediaconvert-role
```

### C-5. `.env.production` へ反映

CDK でロールを作っても既存インスタンスの `.env.production` は自動更新されません。
**`ec2-user` に切り替えた状態で**以下を実行します（C-4 参照）。

```bash
sudo -i -u ec2-user          # ← まだ切り替えていない場合
cd ~/app

bash deploy/regenerate-env.sh
# → [regenerate-env]   set MEDIACONVERT_ROLE_ARN = arn:aws:… (len=…)
#    [regenerate-env]   set S3_MEDIA_OUTPUT_BUCKET = idol-fan… (len=…)
#    [regenerate-env][WARN] CloudFront 署名鍵が未登録です。… ← 手順 D で解消

bash deploy/deploy.sh        # PM2 再起動で反映
```

反映確認（値は出さずに変数名だけ）:

```bash
grep -E '^(MEDIACONVERT_ROLE_ARN|S3_VIDEO_BUCKET|S3_MEDIA_OUTPUT_BUCKET|CRON_SECRET)=' \
  ~/app/.env.production | cut -d= -f1
```

> `Permission denied` が出る場合は `ec2-user` に切り替わっていません。
> `whoami` で確認してください。

### C-6. アプリ側の設定状況を確認

管理画面 `/admin/videos/new` を開き、
**「現在のエンコード設定」** を展開します。

| 表示色 | 意味 | 次にやること |
| --- | --- | --- |
| 🔴 ローズ | エンコード不可（必須変数が欠落） | C-2〜C-5 を見直す |
| 🟡 アンバー | エンコードは可能／再生は不可 | 手順 D（署名鍵）を実施 |
| ⚪ スレート | 自動 READY 化が無効（`CRON_SECRET` 欠落） | Lambda を配置、または手動公開で運用 |
| 🟢 エメラルド | すべて設定済み | C-7 の実ジョブ検証へ |

JSON で確認する場合:

```bash
curl -s https://<your-domain>/api/admin/videos/encode-config \
  -H "Cookie: <管理者セッション>" | jq
```

期待値:

```json
{
  "encodeReady": true,
  "playbackReady": true,
  "automationReady": true,
  "missing": { "required": [], "playback": [], "automation": [] },
  "resolved": {
    "sourceBucket": "idol-fansite-dev-videos-700918785224",
    "outputBucket": "idol-fansite-dev-media-output-700918785224",
    "outputKeyPrefix": "hls",
    "usingSingleBucket": false
  }
}
```

> `usingSingleBucket: true` の場合は `S3_MEDIA_OUTPUT_BUCKET` が未設定で
> 入力バケットに出力しています。CloudFront のオリジンと不一致になるため、
> 再生時に 403/404 になります。必ず `false` にしてください。

### C-7. 実ジョブの検証（10〜30 秒程度の短い動画で）

1. `/admin/videos/new` から**短いテスト動画**をアップロードする
   （長尺だと課金と待ち時間が増えるため、まず 10〜30 秒で試す）
2. ジョブが投入されたことを確認する

```bash
aws mediaconvert list-jobs --region "$AWS_REGION" \
  --max-results 5 --order DESCENDING \
  --query 'Jobs[].{Id:Id,Status:Status,Video:UserMetadata.videoId,Err:ErrorMessage}' \
  --output table
```

`Status` の遷移: `SUBMITTED` → `PROGRESSING` → `COMPLETE`

3. 出力物が S3 に生成されたか確認

```bash
OUT=$(aws ssm get-parameter --name "/${APP}/${ENV}/s3/media-output-bucket" \
  --query 'Parameter.Value' --output text)
VIDEO_ID=<管理画面に表示された videoId>

aws s3 ls "s3://${OUT}/hls/${VIDEO_ID}/"
```

期待される出力:

```
index.m3u8                 ← マスタープレイリスト
index_480p.m3u8  + .ts
index_720p.m3u8  + .ts
index_1080p.m3u8 + .ts
thumbnail.0000000.jpg      ← サムネイル
```

4. 管理画面 `/admin/videos/<id>` で `s3HlsKey` が
   `hls/<videoId>/index.m3u8` になっていること、ステータスが **READY** に
   なっていることを確認する

   - READY にならない場合は `CRON_SECRET` 未設定か
     `video-job-complete` Lambda が未デプロイです。
     暫定は **「手動で公開（READY化）」** ボタンで回避できます。

5. 「プレビュー再生」で実際に再生できるか確認する
   （403 が出る場合は手順 D の署名鍵が未設定です）

### C-8. 失敗したときの調査

```bash
# ジョブの詳細 (ErrorCode / ErrorMessage を確認)
aws mediaconvert get-job --id <job-id> --region "$AWS_REGION" \
  --query 'Job.{Status:Status,Code:ErrorCode,Msg:ErrorMessage}'

# アプリ側のログ
pm2 logs --nostream --lines 100
```

| ErrorCode の傾向 | 原因 |
| --- | --- |
| `1434` / `Access Denied` (入力) | MediaConvert ロールに `source/*` の `s3:GetObject` が無い |
| `Access Denied` (出力) | 出力先が `hls/*` 以外、またはバケット名が違う |
| CreateJob 時に `AccessDeniedException` | EC2 ロールの `iam:PassRole` 対象 ARN 不一致 |
| `Unable to open input file` | `s3SourceKey` が実際のオブジェクトと不一致 |

---

## 手順 D: CloudFront 署名鍵の生成と登録

エンコード自体は署名鍵が無くても成功しますが、**再生ができません**
（`/api/videos/[id]/playback` が明示的にエラーを返します）。
鍵ペアの生成を伴うため自動化しておらず、以下は手動作業です。

### D-1. RSA 2048bit 鍵ペアを生成

CloudFront の署名付き URL は **RSA 2048bit / SHA-1** 固定です。

```bash
# 作業用ディレクトリ (Git 管理外で作業する)
mkdir -p ~/cf-keys && cd ~/cf-keys

# 秘密鍵
openssl genrsa -out cf-private.pem 2048
chmod 600 cf-private.pem

# 公開鍵 (CloudFront に登録するのはこちら)
openssl rsa -pubout -in cf-private.pem -out cf-public.pem

cat cf-public.pem
# -----BEGIN PUBLIC KEY-----
# MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
# -----END PUBLIC KEY-----
```

> ⚠️ `cf-private.pem` はリポジトリに絶対にコミットしないこと。
> 保管は SSM Parameter Store（SecureString）を正とし、
> ローカルの控えは登録後に削除するのが安全です。

### D-2. 公開鍵を CDK に渡して CloudFront に登録

`infra/bin/app.ts` は context `cloudfrontPublicKeyPem` を読み取り、
`StorageStack` で **PublicKey → KeyGroup → Distribution の `trustedKeyGroups`**
まで一括で設定します。さらに確定した Public Key ID を
`/${APP}/${ENV}/cloudfront/key-pair-id` へ自動登録します。

```bash
cd infra

# 改行を含む PEM をそのまま context に渡す
pnpm cdk deploy "${APP}-${ENV}-storage" \
  --require-approval never \
  --context cloudfrontPublicKeyPem="$(cat ~/cf-keys/cf-public.pem)"
```

> ⚠️ **重要**: この context は毎回の deploy で渡す必要があります。
> 次回 `cloudfrontPublicKeyPem` 無しで Storage を deploy すると
> KeyGroup と `trustedKeyGroups` が**削除され**、
> 署名なしで誰でも動画にアクセスできる状態になります。
>
> 恒久的に固定したい場合は `infra/cdk.json` の `context` に
> `"cloudfrontPublicKeyPem"` を追加します（**公開鍵なのでコミット可**）。

`cdk.json` に入れる場合の例（PEM の改行は `\n` でエスケープ）:

```jsonc
{
  "context": {
    "appName": "idol-fansite",
    "cloudfrontPublicKeyPem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----\n"
  }
}
```

変換コマンド:

```bash
# cdk.json に貼り付ける形の 1 行文字列を作る
python3 -c "import json,sys;print(json.dumps(open('$HOME/cf-keys/cf-public.pem').read()))"
```

### D-3. Key Pair ID（= Public Key ID）を確認

```bash
# CDK が SSM に自動登録した値
aws ssm get-parameter --name "/${APP}/${ENV}/cloudfront/key-pair-id" \
  --query 'Parameter.Value' --output text
# → K2ABCDEFGHIJKL   ← これが CLOUDFRONT_KEY_PAIR_ID
```

CloudFront から直接引く場合:

```bash
aws cloudfront list-public-keys \
  --query 'PublicKeyList.Items[].{Id:Id,Name:Name}' --output table
```

> `CLOUDFRONT_KEY_PAIR_ID` は **Public Key の ID**（`K...` で始まる）です。
> 旧来の「CloudFront キーペア（`APKA...`／ルートアカウント作成）」ではありません。
> KeyGroup の ID とも別物なので混同しないよう注意してください。

### D-4. 秘密鍵を SSM に SecureString で登録

こちらは自動化していないので手動登録が必要です。

```bash
aws ssm put-parameter \
  --name "/${APP}/${ENV}/cloudfront/private-key" \
  --type SecureString \
  --value "$(cat ~/cf-keys/cf-private.pem)" \
  --overwrite \
  --region "$AWS_REGION"
```

登録できたか（値は伏せて長さだけ）確認:

```bash
aws ssm get-parameter --name "/${APP}/${ENV}/cloudfront/private-key" \
  --with-decryption --query 'Parameter.Value' --output text | wc -c
# → 1700 前後
```

`key-pair-id` が SSM に無い場合（CDK を使わず手動で PublicKey を作った等）は
併せて登録します。

```bash
aws ssm put-parameter \
  --name "/${APP}/${ENV}/cloudfront/key-pair-id" \
  --type String --value "K2ABCDEFGHIJKL" --overwrite \
  --region "$AWS_REGION"
```

### D-5. EC2 の `.env.production` に反映

```bash
# EC2 上で (SSM 接続直後は ssm-user なので必ず切り替える)
sudo -i -u ec2-user
cd ~/app

bash deploy/regenerate-env.sh
# → set CLOUDFRONT_KEY_PAIR_ID = K2ABCDEF… (len=14)
#    set CLOUDFRONT_PRIVATE_KEY = (masked, len=1704)
#    ※ 「CloudFront 署名鍵が未登録です」の WARN が消えること

bash deploy/deploy.sh
```

`regenerate-env.sh` は `CLOUDFRONT_PRIVATE_KEY` が複数行であることを考慮して
ダブルクォートで囲んで書き込みます（他の変数と処理が分かれています）。

### D-6. 再生確認

1. 管理画面 `/admin/videos/new` の警告が消え、
   「現在のエンコード設定」が 🟢 になっていること
2. `/api/admin/videos/encode-config` が `"playbackReady": true` を返すこと
3. 管理画面 `/admin/videos/<id>` の「プレビュー再生」で再生できること
4. 署名なしの直リンクが **403** で拒否されること（重要）

```bash
DOMAIN=$(aws ssm get-parameter --name "/${APP}/${ENV}/cloudfront/video-domain" \
  --query 'Parameter.Value' --output text)

# 署名なしアクセス → 403 が正しい挙動
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://${DOMAIN}/hls/<videoId>/index.m3u8"
# → 403
```

`200` が返る場合は `trustedKeyGroups` が付いておらず、
**動画が誰でも視聴できる状態**です。D-2 の context 指定を確認してください。

### D-7. 鍵のローテーション

漏洩時や定期更新の手順です。ダウンタイムを避けるため、
**新しい鍵を KeyGroup に追加 → 切り替え → 旧鍵を削除** の順で行います。

1. D-1 で新しい鍵ペアを生成する
2. CloudFront の KeyGroup に新旧両方の PublicKey を含めて deploy
   （`storage-stack.ts` の `items: [publicKey]` に新鍵を追加）
3. SSM の `cloudfront/key-pair-id` と `cloudfront/private-key` を新鍵へ更新
4. `regenerate-env.sh` + `deploy.sh` を実行
5. 発行済み署名 URL の TTL 経過後、旧鍵を KeyGroup から削除して deploy

### D-8. 後片付け

```bash
# SSM に登録できたことを確認したら、ローカルの秘密鍵は削除する
shred -u ~/cf-keys/cf-private.pem 2>/dev/null || rm -f ~/cf-keys/cf-private.pem
```

---

## 動作確認まとめ（チェックリスト）

| # | 確認項目 | 確認方法 |
| --- | --- | --- |
| 1 | MediaConvert ロールが存在 | `aws iam get-role --role-name idol-fansite-dev-mediaconvert-role` |
| 2 | SSM に 5 パラメータが登録済み | `aws ssm get-parameters-by-path --path /idol-fansite/dev --recursive` |
| 3 | `.env.production` に反映済み | `grep -c MEDIACONVERT_ROLE_ARN .env.production` |
| 4 | `encodeReady: true` | `/api/admin/videos/encode-config` |
| 5 | ジョブが COMPLETE する | `aws mediaconvert list-jobs` |
| 6 | `hls/<id>/index.m3u8` が生成 | `aws s3 ls s3://<出力バケット>/hls/<id>/` |
| 7 | Video が READY になる | 管理画面 `/admin/videos/<id>` |
| 8 | `playbackReady: true` | `/api/admin/videos/encode-config` |
| 9 | 署名付き URL で再生できる | 管理画面「プレビュー再生」 |
| 10 | 署名なしは 403 | `curl https://<cf-domain>/hls/<id>/index.m3u8` |

---

## 付録: Windows / PowerShell 版コマンド一覧

本文の bash コマンドを PowerShell 用に書き換えたものです。
**値はすべてベタ書き**にしてあるので、ターミナルを開き直しても、
上から順にコピペするだけで動きます。

> 環境変数を使わないのは意図的です。`$env:APP` が空のまま
> `"$($env:APP)-$($env:ENV)-ec2"` を評価すると `--ec2` という
> 文字列になり、`cdk` がスタック名ではなくオプションと誤認します。

### 0. 準備

```powershell
# リポジトリを取得 (初回のみ)
mkdir $HOME\dev -Force | Out-Null
cd $HOME\dev
git clone https://github.com/yotamatsumaru/reirie-funsite.git
cd reirie-funsite
pnpm install

# ★ 必須: Lambda アセットをビルド (未ビルドだと CannotFindAsset で全 deploy が失敗)
pnpm db:generate
pnpm --filter @idol/stripe-webhook build:full
dir functions\stripe-webhook\dist    # index.js があることを確認
```

### 1. deploy（手順 C-2）

リポジトリに用意済みの npm script を使います。
ワイルドカード (`'*-ec2'`) がスクリプト内に書かれているため、
**環境変数もスタック名の入力も不要**です。

```powershell
cd $HOME\dev\reirie-funsite\infra

# 差分確認
pnpm cdk diff "idol-fansite-dev-storage"
pnpm cdk diff "idol-fansite-dev-ec2"

# deploy
pnpm run deploy:storage     # = cdk deploy '*-storage' --require-approval never
pnpm run deploy:ec2         # = cdk deploy '*-ec2'     --require-approval never
```

スタック名を直接指定したい場合はベタ書きします。

```powershell
pnpm cdk deploy "idol-fansite-dev-storage" --require-approval never
pnpm cdk deploy "idol-fansite-dev-ec2"
```

### 2. SSM 確認（手順 C-3）

```powershell
aws ssm get-parameters-by-path `
  --path "/idol-fansite/dev" --recursive `
  --query "Parameters[].Name" --output table

aws ssm get-parameter `
  --name "/idol-fansite/dev/mediaconvert/role-arn" `
  --query "Parameter.Value" --output text
```

> PowerShell の行継続はバックスラッシュ `\` ではなく
> **バッククォート `` ` ``** です。
>
> `can't be prefixed with "ssm"` というエラーが出たら、
> パスが `///mediaconvert/role-arn` のように壊れています
> （= 環境変数が空）。上のようにベタ書きしてください。

### 2.5. ⚠️ `deploy:ec2` は原則不要（インスタンスが作り直される）

**storage スタックが成功したら、`pnpm run deploy:ec2` は実行しないでください。**

`infra/lib/ec2-stack.ts` は `userDataCausesReplacement: true` を指定しています。
UserData を gzip 方式に変更した（PR #186）ため CFn 上の UserData に差分があり、
`deploy:ec2` を実行すると **EC2 インスタンスが置き換え（Replacement）** されます。

| 影響 | 内容 |
| --- | --- |
| インスタンス | `i-05f6c5bf19d1cfab6` が terminate され新規作成 |
| EBS | `deleteOnTermination: true` なので**ローカルのデータは消える** |
| ダウンタイム | 起動 + `pnpm install` + `next build` で **10〜20 分** |
| Elastic IP | CFn が付け替えるが、その間は疎通しない |
| 手動で入れた設定 | インスタンス上で直接編集したファイルは**すべて失われる** |

**エンコード設定の反映に EC2 の作り直しは必要ありません。**
`MEDIACONVERT_ROLE_ARN` 等は SSM Parameter Store 経由で配るため、
既存インスタンス上で `regenerate-env.sh` を流せば済みます。

```
storage スタックが SSM に書く
   └─ /idol-fansite/dev/mediaconvert/role-arn
   └─ /idol-fansite/dev/s3/media-output-bucket
        ↓  regenerate-env.sh が読む（EC2 上で実行）
   .env.production を更新
        ↓  deploy.sh
   PM2 再起動 → 反映完了
```

つまり **手順 3（次節）へ直行**してください。

<details>
<summary>どうしても EC2 を作り直す必要がある場合</summary>

`user-data.sh` 自体の修正を実機に反映したいときだけ実行します。
必ず先に差分を確認し、`Replacement: True` を目視してから進めてください。

```powershell
cd $HOME\dev\reirie-funsite\infra
npx cdk diff idol-fansite-dev-ec2
```

`AppInstance` に `replace` マークが付いていることを確認し、
ダウンタイムを取れるタイミングで実行します。

```powershell
pnpm run deploy:ec2
```

置き換え後は `.env.production` が user-data.sh により
SSM から**再生成される**ため、`regenerate-env.sh` は不要です。
代わりに起動ログを確認してください。

```bash
sudo tail -f /var/log/cloud-init-output.log
```

</details>

### 3. EC2 へ接続して反映（手順 C-5）

> ⚠️ PowerShell では `<` `>` が**リダイレクト演算子として予約**されています。
> `--target <instance-id>` と書くと
> `演算子 '<' は、今後の使用のために予約されています` エラーになります。

まずインスタンス ID を**一覧表示して目で確認**します。
変数に入れて直接渡すと、取得失敗時に `--target` が値なしになり
`expected one argument` で分かりにくく失敗します。

```powershell
aws ec2 describe-instances `
  --filters "Name=tag:Application,Values=idol-fansite" `
            "Name=instance-state-name,Values=running" `
  --query "Reservations[].Instances[].[InstanceId,InstanceType,PrivateIpAddress]" `
  --output table
```

```
------------------------------------------------------
|                 DescribeInstances                  |
+----------------------+------------+----------------+
|  i-05e35460834d4ef18 |  t3.small  |  10.0.1.23     |
+----------------------+------------+----------------+
```

表示された ID をそのまま貼り付けます。

```powershell
aws ssm start-session --target i-05f6c5bf19d1cfab6
```

> ⚠️ **接続直後は `ssm-user` です。必ず `ec2-user` に切り替えてください。**
> `/home/ec2-user` はパーミッション `700` なので、`ssm-user` のままでは
> `Permission denied` になります。

接続後（EC2 上の bash）:

```bash
sudo -i -u ec2-user     # ← 必須。これを忘れると Permission denied
whoami                  # → ec2-user であることを確認
cd ~/app

bash deploy/regenerate-env.sh
bash deploy/deploy.sh
```

### 4. ジョブ確認（手順 C-7）

```powershell
aws mediaconvert list-jobs --region ap-northeast-1 `
  --max-results 5 --order DESCENDING `
  --query "Jobs[].{Id:Id,Status:Status,Video:UserMetadata.videoId,Err:ErrorMessage}" `
  --output table

# 出力バケット名を確認
aws ssm get-parameter `
  --name "/idol-fansite/dev/s3/media-output-bucket" `
  --query "Parameter.Value" --output text
# → idol-fansite-dev-media-output-700918785224

# videoId は管理画面で確認した値に置き換える
aws s3 ls "s3://idol-fansite-dev-media-output-700918785224/hls/<ここにvideoId>/"
```

### 5. CloudFront 署名鍵（手順 D）

```powershell
# D-1. 鍵ペア生成 (Git for Windows 同梱の openssl が使えます)
mkdir $HOME\cf-keys -Force | Out-Null
cd $HOME\cf-keys
openssl genrsa -out cf-private.pem 2048
openssl rsa -pubout -in cf-private.pem -out cf-public.pem

# D-2. 公開鍵を context で渡して deploy
cd $HOME\dev\reirie-funsite\infra
$pubPem = Get-Content $HOME\cf-keys\cf-public.pem -Raw
if (-not $pubPem) { throw "公開鍵の読み込みに失敗しました" }

pnpm cdk deploy "idol-fansite-dev-storage" `
  --require-approval never `
  --context "cloudfrontPublicKeyPem=$pubPem"

# D-3. Key Pair ID を確認
aws ssm get-parameter `
  --name "/idol-fansite/dev/cloudfront/key-pair-id" `
  --query "Parameter.Value" --output text

# D-4. 秘密鍵を SSM SecureString へ登録
#      改行込みの値なのでファイル参照 (file://) を使うのが確実
aws ssm put-parameter `
  --name "/idol-fansite/dev/cloudfront/private-key" `
  --type SecureString `
  --value "file://$HOME\cf-keys\cf-private.pem" `
  --overwrite --region ap-northeast-1
```

> `--value "$(cat ...)"` は PowerShell では動きません。
> `aws` CLI の **`file://` 記法**を使うと改行がそのまま渡るので安全です。
> どうしても値渡ししたい場合は
> `$key = Get-Content cf-private.pem -Raw` として `--value $key` にします。

```powershell
# D-6. 署名なしアクセスが 403 になることを確認
$domain = aws ssm get-parameter `
  --name "/idol-fansite/dev/cloudfront/video-domain" `
  --query "Parameter.Value" --output text
$videoId = "<ここにvideoId>"

try {
  Invoke-WebRequest "https://$domain/hls/$videoId/index.m3u8" `
    -UseBasicParsing | Out-Null
  Write-Host "NG: 200 が返りました (trustedKeyGroups 未設定の疑い)" -ForegroundColor Red
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Write-Host "status=$code (403 なら正常)" -ForegroundColor Green
}
```

### 6. 後片付け（手順 D-8）

```powershell
Remove-Item $HOME\cf-keys\cf-private.pem -Force
```

### PowerShell / bash 記法対応表

| 用途 | bash | PowerShell |
| --- | --- | --- |
| 環境変数の設定 | `export APP=x` | `$env:APP = "x"` |
| 変数の参照 | `${APP}` | `$env:APP` |
| 文字列内で連結 | `"${APP}-${ENV}"` | `"$($env:APP)-$($env:ENV)"` |
| 行継続 | `\` | `` ` `` (バッククォート) |
| ファイル内容を渡す | `"$(cat f.pem)"` | `(Get-Content f.pem -Raw)` / `file://f.pem` |
| HTTP ステータス確認 | `curl -o /dev/null -w '%{http_code}'` | `Invoke-WebRequest` + `try/catch` |
| ディレクトリ作成 | `mkdir -p d` | `mkdir d -Force` |
| ホームディレクトリ | `~` | `$HOME` |

> ⚠️ **変数が空でも PowerShell はエラーを出しません。**
> 空文字として連結されるため、
> `"$($env:APP)-$($env:ENV)-ec2"` → `"--ec2"` のように
> 意図と違う文字列が静かに生成されます。
> 環境変数はターミナルを閉じると消えるので、
> 重要なコマンドでは**ベタ書き**か**事前検証**を推奨します。
>
> ```powershell
> if (-not $env:APP) { throw "APP が未設定です" }
> ```

## トラブルシューティング

| 症状 | 原因と対処 |
| --- | --- |
| 「エンコードを実行できません」 | `MEDIACONVERT_ROLE_ARN` 等が未設定。手順 A/B を実施 |
| ジョブ作成が `AccessDenied` で失敗 | EC2 ロールの `iam:PassRole` 対象がロール ARN と不一致 |
| ジョブが `ERROR` で終わる | MediaConvert ロールに入力 `source/*` の読み取り権限が無い |
| 再生時に 403 | CloudFront 署名鍵が未設定、または署名鍵がキーグループに未登録 |
| 再生時に 404 | HLS の出力先が CloudFront のオリジンバケットと不一致 |
| 完了しても READY にならない | `CRON_SECRET` 未設定 or Lambda 未デプロイ。「手動で公開」で回避可能 |
| `cdk` が `CannotFindAsset ...\functions\stripe-webhook\dist` | Lambda が未ビルド。`pnpm db:generate` → `pnpm --filter @idol/stripe-webhook build:full` を実行（手順 C-0） |
| `ParameterNotFound` (`mediaconvert/role-arn`) | Storage スタックの deploy が未完了。上記ビルド後に再実行 |
| PowerShell で `演算子 '<' は…予約されています` | `<instance-id>` 等のプレースホルダをそのまま入力している。実値/変数に置換する |
| PowerShell で `export : 用語 'export' は…認識されません` | `export` は bash 専用。`$env:APP = "…"` を使う（付録参照） |
| `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` | リポジトリ外で `pnpm` を実行している。`cd` でリポジトリ内に移動する |
| `cdk "deploy" "--ec2"` / `Since this app includes more than a single stack` | 環境変数が空でスタック名が `--ec2` に化けている。`pnpm run deploy:ec2` を使うかスタック名をベタ書きする |
| SSM で `can't be prefixed with "ssm"` | 同上。パスが `///mediaconvert/role-arn` に化けている。`"/idol-fansite/dev/..."` とベタ書きする |
| `argument --target: expected one argument` | インスタンス ID の取得に失敗し空文字が渡っている。`describe-instances` で一覧表示してから ID を貼る |
| `User data is limited to 16384 bytes` | UserData が上限超過。gzip 自己解凍方式で解消済み（下記参照） |
| `Value at 'description' failed to satisfy constraint` (`AWS::IAM::Role`) | IAM の description に日本語が入っている。ASCII に直す（下記参照。修正済み） |
| `deploy:ec2` でインスタンスが作り直された | `userDataCausesReplacement: true` の仕様。エンコード設定の反映に EC2 再作成は不要。付録 2.5 参照 |
| EC2 上で `bash …/deploy/regenerate-env.sh: Permission denied` | SSM 接続直後は `ssm-user`。`/home/ec2-user` は `700` のため読めない。`sudo -i -u ec2-user` で切り替える（下記参照） |
| `nvm: command not found` / `pnpm: command not found` | `sudo -u ec2-user bash` で入っている。`$HOME` が違うため PATH が通らない。`sudo -i -u ec2-user`（`-i` 付き）を使う |

### SSM Session Manager では `ssm-user` になる

`aws ssm start-session` で接続すると、プロンプトは `sh-5.2$` になりますが
**ログインユーザーは `ec2-user` ではなく `ssm-user`** です。

```
sh-5.2$ whoami
ssm-user
sh-5.2$ bash /home/ec2-user/app/deploy/regenerate-env.sh
bash: /home/ec2-user/app/deploy/regenerate-env.sh: Permission denied
```

アプリは `/home/ec2-user/app` にあり、`/home/ec2-user` は
パーミッション `700`（所有者のみアクセス可）なので、
`ssm-user` からはディレクトリを辿れません。
ファイルの実行権限の問題ではなく**親ディレクトリの権限**が原因です。

```bash
$ ls -ld /home/ec2-user
drwx------ 12 ec2-user ec2-user 4096 ... /home/ec2-user
   ^^^^^^ ← ec2-user 以外は x が無いので中に入れない
```

**対処: 接続直後に必ず切り替える。**

```bash
sudo -i -u ec2-user
whoami    # → ec2-user
cd ~/app
```

`-i`（ログインシェル）が重要です。

| コマンド | `$HOME` | `nvm`/`pnpm`/`pm2` | 判定 |
| --- | --- | --- | --- |
| `sudo -i -u ec2-user` | `/home/ec2-user` | ✅ 読み込まれる | ⭕ これを使う |
| `sudo -u ec2-user bash` | `/home/ssm-user` | ❌ PATH が通らない | ❌ 別のエラーになる |
| `sudo su - ec2-user` | `/home/ec2-user` | ✅ 読み込まれる | ⭕ 代替として可 |

`deploy.sh` は `. "$NVM_DIR/nvm.sh"`（`NVM_DIR="$HOME/.nvm"`）を実行するため、
`$HOME` が `/home/ec2-user` になっていないと `nvm.sh` が見つからず失敗します。

なお `sudo` 自体は `ssm-user` でも使えます（`root` 権限は付与済み）。
`sudo tail -f /var/log/cloud-init-output.log` のようなログ確認は
切り替えなしでも実行できます。

### IAM の description に日本語は使えない

以下のエラーは **IAM API の文字種制約**によるものです。

```
CREATE_FAILED | AWS::IAM::Role | MediaConvertRole
Resource handler returned message: "1 validation error detected:
 Value at 'description' failed to satisfy constraint:
 Member must satisfy regular expression pattern:
 [\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF]*
 (Service: Iam, Status Code: 400)"
```

許可されるのは以下だけで、**日本語 (U+3000 以降) は不可**です。

| 範囲 | 内容 |
| --- | --- |
| `\u0009` `\u000A` `\u000D` | タブ / LF / CR |
| `\u0020`–`\u007E` | ASCII 印字可能文字 |
| `\u00A1`–`\u00FF` | Latin-1 補助（`é` `ü` 等） |

**この罠が分かりにくい理由**:

| リソース | description に日本語 |
| --- | --- |
| `AWS::IAM::Role` / `AWS::IAM::ManagedPolicy` | ❌ HTTP 400 で失敗 |
| `AWS::SSM::Parameter` | ✅ 使える |
| `CfnOutput` | ✅ 使える |
| セキュリティグループ | ✅ 使える |

同じスタック内で「日本語 description が通る場所」と「落ちる場所」が
混在するため、SSM パラメータ 4 件が `CREATE_COMPLETE` した直後に
IAM ロールだけが落ち、**成功済みリソースまでロールバックで削除される**
という挙動になります。

**対処（実施済み）**: `infra/lib/storage-stack.ts` の description を ASCII 化。

```ts
this.mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
  roleName: prefix(config, 'mediaconvert-role'),
  assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
  // ASCII only (IAM constraint)
  description:
    'Service role assumed by AWS Elemental MediaConvert to read source videos from S3 and write HLS output',
});
```

**再発防止（実施済み）**: `infra/lib/iam-description-aspect.ts` に
CDK Aspect を追加し、`bin/app.ts` で全スタックに適用しています。
IAM 系リソースの description に非 ASCII が含まれると
**`cdk synth` の時点でエラー**になり、デプロイまで到達しません。

```
[Error at /idol-fansite-dev-storage/MediaConvertRole/Resource]
AWS::IAM::Role の description に IAM が許可しない文字が含まれています:
 'が' (U+304C), 'エ' (U+30A8), ...
```

今後 IAM ロール／マネージドポリシーを追加する際は、
description は英語（ASCII）で書き、日本語の説明はコード上のコメントに
残してください。

### UserData の 16KB 制限について

EC2 の UserData は **base64 デコード後で 16,384 バイト**が上限です。
`deploy/user-data.sh` は日本語コメントが多く（UTF-8 で 1 文字 3 バイト）、
素のまま渡すと約 21KB になり以下のエラーで `CREATE_FAILED` になります。

```
Resource handler returned message: "User data is limited to 16384 bytes"
```

`infra/lib/ec2-stack.ts` では **gzip + base64 の自己解凍方式**で対処しています。

```
[ラッパー (非圧縮・約1KB)]
  set -euo pipefail
  export APP_NAME='idol-fansite'                 ← 定数
  export MEDIACONVERT_ROLE_ARN='<Fn::ImportValue>' ← CFn トークン
  ...
  echo '<gzip+base64 の本体>' | base64 -d | gunzip > payload.sh
  exec bash payload.sh
```

- 本体 21KB → 圧縮後 約 10.8KB（上限の 66%、余裕 5.5KB）
- **重要**: `mediaConvertRole.roleArn` や `dbSecret.secretArn` は
  deploy 時に解決される **CFn トークン**です。
  圧縮する本体側に直接埋め込むと `${Token[TOKEN.1412]}` という文字列が
  そのまま焼き込まれ、実機で ARN が空になります。
  そのためトークンを含む値は**圧縮しないラッパー側で `export`** し、
  本体はそれを環境変数として受け取る構成にしています。
- 本体側は先頭で `require_var` により必須変数の存在を検証し、
  未設定なら即 `exit 1` します（壊れた `.env.production` での起動を防止）。
- `cdk synth` 時に 16KB 超過と未置換プレースホルダを検出して
  例外を投げるため、deploy 前に気付けます。

将来さらにスクリプトが大きくなった場合は、
S3 に置いて UserData 側で `aws s3 cp` して取得する方式に切り替えてください。
