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
