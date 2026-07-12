# Prisma Migrations

このディレクトリには本番DB(PostgreSQL/RDS)へ適用するマイグレーションを格納します。

## 適用方法（本番EC2 / CI）

```bash
# 環境変数 DATABASE_URL を設定したうえで
pnpm --filter @idol/db prisma:migrate:deploy
```

## AdminInvitation マイグレーション (PR-B)

`*_add_admin_invitation/migration.sql` は **新規テーブル `admin_invitations` の追加のみ**で、
既存テーブルへの破壊的変更を含みません。安全に適用できます。

### 既存DBが `db push` 運用だった場合の注意

`_prisma_migrations` 管理テーブルが未作成の環境で初めて `migrate deploy` を実行すると、
過去分も含めて適用しようとします。本マイグレーションのみを安全に適用したい場合は、
新規テーブル追加のみなので以下のいずれかで対応してください。

1. **SQL を直接実行**（最も安全・推奨）:
   ```bash
   psql "$DATABASE_URL" -f prisma/migrations/<timestamp>_add_admin_invitation/migration.sql
   ```
2. または `prisma db execute`:
   ```bash
   pnpm --filter @idol/db exec prisma db execute \
     --file prisma/migrations/<timestamp>_add_admin_invitation/migration.sql \
     --schema prisma/schema.prisma
   ```

いずれの場合も `admin_invitations` テーブルと `AdminInvitationStatus` enum が新規作成されるだけで、
既存データには影響しません。

## Announcement (お知らせ配信 + 一斉メール送信) マイグレーション

`20260712180000_add_announcements/migration.sql` は **新規テーブル `announcements` の追加のみ**で、
既存テーブルへの破壊的変更を含みません (User への追加は `authorId` の FK 参照のみ、リレーション自体は
既存カラムを変更しない)。安全に適用できます。

適用方法は上記と同様 (`prisma:migrate:deploy` または `psql -f migration.sql` / `prisma db execute --file`)。

### 検証済み事項 (このマイグレーション作成時にローカルPostgreSQLで確認)

1. `citext` / `pgcrypto` 拡張が有効な状態で、本マイグレーション単体を空のテーブルに適用 →
   `prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma --script`
   の差分が空 (= 生成される実DBスキーマは `schema.prisma` の定義と完全一致) であることを確認。
2. Prisma Client 経由での create / findUnique / update / delete が正常に動作することを確認。
3. 既存の各マイグレーションのパターンに合わせて `id UUID` カラムに `DEFAULT gen_random_uuid()` を
   **付与しない** ことを確認 (Prisma の `@default(uuid())` はDBデフォルトではなくクライアント側で
   UUID を生成する設計のため、他テーブルもDB側デフォルト無しで統一されている)。

### 前提: `_prisma_migrations` 管理テーブルが無い本番DBに初めて適用する場合

このリポジトリの過去マイグレーションは `db push` 運用からの移行期に作られたものが混在しており、
`_prisma_migrations` テーブルが本番RDSに存在しない場合は `migrate deploy` が過去分から
順に再生しようとして失敗することがある (例: `citext` 拡張が未作成、等)。
本番RDSの実スキーマが既に最新 (本マイグレーション追加前の状態) であることが分かっている場合は、
以下のいずれかで **このマイグレーションのみ** を安全に反映する:

```bash
# A. SQL を直接実行 (最も安全)
psql "$DATABASE_URL" -f prisma/migrations/20260712180000_add_announcements/migration.sql

# B. prisma db execute
pnpm --filter @idol/db exec prisma db execute \
  --file prisma/migrations/20260712180000_add_announcements/migration.sql \
  --schema prisma/schema.prisma

# 実行後、Prisma に「このマイグレーションは適用済み」と記録させる (migrate deploy の対象から外す)
pnpm --filter @idol/db exec prisma migrate resolve --applied 20260712180000_add_announcements
```
