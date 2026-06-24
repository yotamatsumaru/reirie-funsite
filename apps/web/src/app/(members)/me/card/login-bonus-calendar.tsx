'use client';

/**
 * ログインボーナスを 7 日 (=loginStreakThreshold 日) サイクルのカード形式で
 * 視覚的に表示するコンポーネント。
 *
 * 状態:
 *  - claimed  : 受取済み (暗くし、CLAIM スタンプ風の表示)
 *  - today    : 本日受け取れる日 (拡大・発光・スパークルで強調)
 *  - upcoming : 未到来 (通常表示)
 * milestone (節目=7日目) は金色の特別デザイン。
 */
import type { LoginBonusDay } from '@idol/shared';

const DAY_LABEL = (n: number) => String(n).padStart(2, '0');

/** 状態に応じたコイン/ジェムの色 (ゲームUI風のバリエーション) */
function rewardIcon(day: LoginBonusDay) {
  if (day.isMilestone) {
    // 節目: 王冠
    return (
      <svg viewBox="0 0 48 48" className="h-9 w-9 drop-shadow" aria-hidden>
        <path
          d="M6 16l8 8 10-14 10 14 8-8-4 22H10z"
          fill="#fde047"
          stroke="#b45309"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="14" cy="16" r="2.5" fill="#fff7cd" />
        <circle cx="24" cy="10" r="2.5" fill="#fff7cd" />
        <circle cx="34" cy="16" r="2.5" fill="#fff7cd" />
      </svg>
    );
  }
  // 通常日: 偶数=ジェム / 奇数=コイン
  if (day.day % 2 === 0) {
    return (
      <svg viewBox="0 0 48 48" className="h-9 w-9 drop-shadow" aria-hidden>
        <path
          d="M14 8h20l8 12-18 22L6 20z"
          fill="#67e8f9"
          stroke="#0e7490"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M14 8l10 12 10-12M6 20h36" stroke="#0e7490" strokeWidth="1.2" fill="none" />
        <path d="M24 20v22" stroke="#0e7490" strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9 drop-shadow" aria-hidden>
      <circle cx="24" cy="24" r="17" fill="#fcd34d" stroke="#b45309" strokeWidth="2" />
      <circle cx="24" cy="24" r="12" fill="#fde68a" stroke="#d97706" strokeWidth="1.2" />
      <text
        x="24"
        y="30"
        textAnchor="middle"
        fontSize="14"
        fontWeight="bold"
        fill="#b45309"
        fontFamily="sans-serif"
      >
        P
      </text>
    </svg>
  );
}

function DayCard({ day }: { day: LoginBonusDay }) {
  const isToday = day.state === 'today';
  const isClaimed = day.state === 'claimed';
  const isMilestone = day.isMilestone;

  // カード本体の配色
  const cardBg = isMilestone
    ? 'from-amber-300 via-pink-400 to-fuchsia-500 border-amber-300'
    : isToday
      ? 'from-cyan-300 via-cyan-400 to-teal-400 border-fuchsia-400'
      : 'from-emerald-400 via-teal-500 to-teal-600 border-indigo-400';

  return (
    <div
      className={[
        'relative flex flex-col items-stretch rounded-xl transition-transform',
        isToday ? 'z-10 scale-105 sm:scale-110' : '',
      ].join(' ')}
    >
      {/* 上段: アイテムカード */}
      <div
        className={[
          'relative overflow-hidden rounded-t-xl border-2 bg-gradient-to-br px-1.5 pb-2 pt-2 text-white',
          cardBg,
          isToday ? 'shadow-[0_8px_24px_-4px_rgba(34,211,238,0.6)]' : 'shadow-md',
          isClaimed ? 'opacity-100' : '',
        ].join(' ')}
      >
        {/* DAY ラベル */}
        <div className="text-center leading-none">
          <p className="text-[8px] font-bold tracking-widest text-white/80">DAY</p>
          <p className="text-xl font-extrabold tabular-nums sm:text-2xl">{DAY_LABEL(day.day)}</p>
        </div>

        {/* アイコン */}
        <div className="mt-1 flex items-center justify-center">{rewardIcon(day)}</div>

        {/* 数量バッジ */}
        <div className="mt-1.5 flex justify-center">
          <span className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
            +{day.amount}pt
          </span>
        </div>

        {/* today の発光・スパークル */}
        {isToday && (
          <>
            <span className="pointer-events-none absolute -right-1 -top-1 text-lg text-yellow-300 drop-shadow">
              ✦
            </span>
            <span className="pointer-events-none absolute -left-1 top-6 text-sm text-yellow-200">
              ✧
            </span>
          </>
        )}

        {/* claimed のオーバーレイ + スタンプ */}
        {isClaimed && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/55">
            <span className="rotate-[-12deg] rounded-full border-2 border-teal-300 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-teal-200">
              CLAIM
            </span>
          </div>
        )}
      </div>

      {/* 下段: チケットスタブ */}
      <div
        className={[
          'relative rounded-b-xl border-2 border-t-0 px-1.5 py-1 text-center',
          isMilestone
            ? 'border-amber-300 bg-gradient-to-r from-cyan-200 to-fuchsia-200'
            : isToday
              ? 'border-fuchsia-400 bg-indigo-100'
              : 'border-indigo-400 bg-slate-200',
        ].join(' ')}
      >
        {isClaimed ? (
          <p className="text-[9px] font-bold text-slate-500">受取済み</p>
        ) : isToday ? (
          <p className="text-[9px] font-extrabold text-fuchsia-700">本日分</p>
        ) : (
          <p className="text-[9px] font-semibold text-slate-500">Day {day.day}</p>
        )}
        {/* バーコード風 */}
        <div className="mt-0.5 flex h-2 items-stretch justify-center gap-[1px] opacity-60">
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              className="w-[1.5px] bg-slate-800"
              style={{ height: i % 2 === 0 ? '100%' : '70%' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function LoginBonusCalendar({ days }: { days: LoginBonusDay[] }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-extrabold uppercase tracking-widest text-cyan-300">
          ✦ Login Bonus
        </p>
        <p className="text-xs font-extrabold uppercase tracking-widest text-cyan-300">
          {days.length}Days
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {days.map((d) => (
          <DayCard key={d.day} day={d} />
        ))}
      </div>
    </div>
  );
}
