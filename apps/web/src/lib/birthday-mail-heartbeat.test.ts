/**
 * 誕生日メール自動送信の「スケジューラ生存確認 (heartbeat)」に関するテスト。
 *
 * 背景: 「自動送信のはずなのになぜか届かない」という報告があり、調査の結果、
 * 送信トリガーが EC2 の OS cron に完全依存しており、cron が停止していても
 * アプリのログ・監査ログに一切残らないという盲点が判明した (根本対策として
 * アプリ内タイマー (lib/birthday-scheduler.ts) を追加した)。
 *
 * ここでは、その切り分けを可能にする土台となる recordBirthdayMailCheck() /
 * getBirthdayMailRunState().lastCheckAt が正しく動くことを検証する。
 * 実 DB は使わず、@idol/db を軽量なインメモリスタブに差し替える
 * (app-setting-site-visibility-lock.test.ts と同じ方式)。
 */

type Call = { op: string; args: unknown[] };

const calls: Call[] = [];

let appSettingRow: { key: string; value: string } | null = null;

jest.mock('@idol/db', () => {
  const prismaStub = {
    appSetting: {
      findUnique: (args: { where: { key: string } }) => {
        calls.push({ op: 'appSetting.findUnique', args: [args] });
        return Promise.resolve(appSettingRow ? { ...appSettingRow } : null);
      },
      upsert: (args: {
        where: { key: string };
        create: { key: string; value: string };
        update: { value: string };
      }) => {
        calls.push({ op: 'appSetting.upsert', args: [args] });
        appSettingRow = { key: args.where.key, value: args.create.value };
        return Promise.resolve({ ...appSettingRow });
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: async () => 1,
        appSetting: prismaStub.appSetting,
      }),
  };
  return {
    prisma: prismaStub,
    Prisma: { TransactionClient: class {} },
  };
});

import {
  recordBirthdayMailCheck,
  getBirthdayMailRunState,
  recordBirthdayMailRunResult,
  claimBirthdayMailRun,
} from './app-setting';
import { BIRTHDAY_MAIL_RUN_STATE_KEY } from '@idol/shared';

beforeEach(() => {
  calls.length = 0;
  appSettingRow = null;
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-13T03:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('recordBirthdayMailCheck (heartbeat)', () => {
  it('未設定の状態から呼んでも lastCheckAt が記録される', async () => {
    await recordBirthdayMailCheck();
    const state = await getBirthdayMailRunState();
    expect(state.lastCheckAt).toBe('2026-09-13T03:00:00.000Z');
  });

  it('AppSetting.key = birthdayMail.runState に保存される (実行結果と同じキーを共有)', async () => {
    await recordBirthdayMailCheck();
    expect(appSettingRow?.key).toBe(BIRTHDAY_MAIL_RUN_STATE_KEY);
  });

  it('既存の実行結果 (lastRunDate 等) を消さずに lastCheckAt だけを更新する', async () => {
    await claimBirthdayMailRun({ year: 2026, month: 9, day: 13 });
    await recordBirthdayMailRunResult({ status: 'sent', sent: 3, failed: 0 });

    jest.setSystemTime(new Date('2026-09-13T03:05:00.000Z'));
    await recordBirthdayMailCheck();

    const state = await getBirthdayMailRunState();
    // heartbeat だけ更新され、既存の実行結果フィールドはそのまま保持される。
    expect(state.lastCheckAt).toBe('2026-09-13T03:05:00.000Z');
    expect(state.lastStatus).toBe('sent');
    expect(state.lastSent).toBe(3);
  });

  it('複数回呼んでも毎回 lastCheckAt が最新の時刻に更新される (心拍が進む)', async () => {
    await recordBirthdayMailCheck();
    expect((await getBirthdayMailRunState()).lastCheckAt).toBe('2026-09-13T03:00:00.000Z');

    jest.setSystemTime(new Date('2026-09-13T03:01:00.000Z'));
    await recordBirthdayMailCheck();
    expect((await getBirthdayMailRunState()).lastCheckAt).toBe('2026-09-13T03:01:00.000Z');

    jest.setSystemTime(new Date('2026-09-13T03:02:00.000Z'));
    await recordBirthdayMailCheck();
    expect((await getBirthdayMailRunState()).lastCheckAt).toBe('2026-09-13T03:02:00.000Z');
  });

  it('破損した保存データがあっても heartbeat の記録自体は失敗しない', async () => {
    appSettingRow = { key: BIRTHDAY_MAIL_RUN_STATE_KEY, value: '{not-json' };
    await expect(recordBirthdayMailCheck()).resolves.toBeUndefined();
    const state = await getBirthdayMailRunState();
    expect(state.lastCheckAt).toBe('2026-09-13T03:00:00.000Z');
  });

  it('DB エラー時も例外を投げない (heartbeat 失敗が送信処理を止めてはいけない)', async () => {
    const { prisma } = jest.requireMock('@idol/db') as {
      prisma: { appSetting: { findUnique: () => Promise<unknown> } };
    };
    const original = prisma.appSetting.findUnique;
    prisma.appSetting.findUnique = () => Promise.reject(new Error('DB down'));
    try {
      await expect(recordBirthdayMailCheck()).resolves.toBeUndefined();
    } finally {
      prisma.appSetting.findUnique = original;
    }
  });
});
