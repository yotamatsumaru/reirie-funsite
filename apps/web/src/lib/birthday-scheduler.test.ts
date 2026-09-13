/**
 * lib/birthday-scheduler.ts (誕生日メール自動送信のアプリ内タイマー) のテスト。
 *
 * 実際の DB / メール送信には触れず、runBirthdayMailAutoSendAndAudit を
 * モックして「タイマーがどう呼び出すか」だけを検証する。
 */

jest.mock('./birthday-mail', () => ({
  runBirthdayMailAutoSendAndAudit: jest.fn(async () => ({
    status: 'not-due',
    message: 'mock',
    today: { year: 2026, month: 9, day: 13 },
    now: { hour: 3, minute: 0 },
    schedule: { enabled: true, hour: 12, minute: 0 },
    result: null,
  })),
}));

import { runBirthdayMailAutoSendAndAudit } from './birthday-mail';
import { startBirthdayMailScheduler } from './birthday-scheduler';

/**
 * tick() 内部の `await import('./birthday-mail')` + `await runBirthdayMailAutoSendAndAudit()`
 * を解決させるため、複数回マイクロタスクを掃き出す。
 * (jest.useFakeTimers はマクロタスクのみを制御するため、Promise チェーンは
 *  明示的に await Promise.resolve() を繰り返して進める必要がある。)
 */
async function flushMicrotasks(times = 10) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('startBirthdayMailScheduler', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.useFakeTimers();
    (runBirthdayMailAutoSendAndAudit as jest.Mock).mockClear();
    (runBirthdayMailAutoSendAndAudit as jest.Mock).mockImplementation(async () => ({
      status: 'not-due',
      message: 'mock',
      today: { year: 2026, month: 9, day: 13 },
      now: { hour: 3, minute: 0 },
      schedule: { enabled: true, hour: 12, minute: 0 },
      result: null,
    }));
    // globalThis のフラグを毎テストでリセット (多重起動防止フラグの検証のため)。
    delete (globalThis as { __birthdayMailSchedulerStarted?: boolean })
      .__birthdayMailSchedulerStarted;
  });

  afterEach(() => {
    jest.useRealTimers();
    logSpy.mockRestore();
  });

  it('起動直後に 1 回、runBirthdayMailAutoSendAndAudit を呼ぶ (デプロイ直後に 1 分待たず追いつく)', async () => {
    startBirthdayMailScheduler();
    await flushMicrotasks();

    expect(runBirthdayMailAutoSendAndAudit).toHaveBeenCalledWith({ via: 'scheduler' });
  });

  it('1 分ごとに再実行される (OS cron の 5 分より短い間隔で先に検出できるようにするため)', async () => {
    startBirthdayMailScheduler();
    await flushMicrotasks();
    const initialCalls = (runBirthdayMailAutoSendAndAudit as jest.Mock).mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect((runBirthdayMailAutoSendAndAudit as jest.Mock).mock.calls.length).toBeGreaterThan(
      initialCalls,
    );
  });

  it('2 回呼んでも setInterval は 1 つしか登録されない (多重起動防止)', async () => {
    startBirthdayMailScheduler();
    startBirthdayMailScheduler();
    await flushMicrotasks();

    (runBirthdayMailAutoSendAndAudit as jest.Mock).mockClear();
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    // 2 重登録されていれば 2 回呼ばれるはずだが、1 回だけであることを確認する。
    expect(runBirthdayMailAutoSendAndAudit).toHaveBeenCalledTimes(1);
  });

  it('内部で例外が発生してもタイマー自体は落ちない (次回リトライされる)', async () => {
    (runBirthdayMailAutoSendAndAudit as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    startBirthdayMailScheduler();
    await flushMicrotasks();

    expect(errSpy).toHaveBeenCalled();

    // 次の tick は正常に呼ばれる (プロセスが落ちていない証拠)。
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(
      (runBirthdayMailAutoSendAndAudit as jest.Mock).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);

    errSpy.mockRestore();
  });
});
