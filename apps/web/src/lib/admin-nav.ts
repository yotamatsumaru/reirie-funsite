/**
 * 管理メニュー (サイドバー) の表示判定。
 *
 * ロールごとの「どの管理画面に入れるか」は複数箇所で判定していて崩れやすいので、
 * ここに純粋関数として集約し、単体テストで固定する。
 *
 * 前提となるロールの権限:
 *   USER        … 管理画面なし
 *   ADMIN       … /admin のみ (通常管理画面)
 *   STAFF       … /super-admin のみ・閲覧専用
 *                 (admin/layout.tsx が ADMIN/SUPER_ADMIN しか通さないため /admin には入れない)
 *   SUPER_ADMIN … /admin と /super-admin の両方・全操作可
 */
import {
  USER_ROLES,
  canViewSuperAdmin,
  isAdmin,
  isStaff,
  type UserRoleLiteral,
} from '@idol/shared';

export type AdminNavVisibility = {
  /** 「管理ダッシュボード」(/admin) へのリンクを出すか */
  showAdminDashboard: boolean;
  /** スーパー管理画面 (/super-admin) へのリンクを出すか */
  showSuperAdmin: boolean;
  /** 管理セクション自体を出すか */
  showAdminSection: boolean;
  /** スーパー管理画面が閲覧専用か (STAFF) */
  superAdminReadOnly: boolean;
  /** スーパー管理リンクのラベル */
  superAdminLabel: string;
};

export function resolveAdminNavVisibility(
  // セッションのロールは string で流れてくることがあるため広めに受け、
  // 既知のロール以外は「権限なし」として扱う。
  rawRole: UserRoleLiteral | string | null | undefined,
): AdminNavVisibility {
  const role = (USER_ROLES as readonly string[]).includes(rawRole ?? '')
    ? (rawRole as UserRoleLiteral)
    : undefined;

  // STAFF は /admin に入れないので「管理ダッシュボード」は出さない。
  // (isAdmin() は STAFF も true になる階層判定のため、ここで明示的に除外する)
  const showAdminDashboard = isAdmin(role) && !isStaff(role);
  // スーパー管理画面は SUPER_ADMIN と STAFF が閲覧できる。
  const showSuperAdmin = canViewSuperAdmin(role);
  const superAdminReadOnly = isStaff(role);

  return {
    showAdminDashboard,
    showSuperAdmin,
    showAdminSection: showAdminDashboard || showSuperAdmin,
    superAdminReadOnly,
    superAdminLabel: superAdminReadOnly ? 'スタッフ管理（閲覧）' : 'スーパー管理者',
  };
}
