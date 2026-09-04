'use client';

/**
 * DeviceSelect — カメラ / マイク / スピーカーを選ぶ <select>
 *
 * - 選択肢が 0 件のときは「見つかりません」を出して disabled
 * - 許可前は deviceId しか取れず label が空になるため、
 *   親側で needsPermissionForLabels() を見て案内を出す
 */

import type { ReactNode } from 'react';
import type { DeviceOption } from '@/lib/call-devices';

export type DeviceSelectProps = {
  id: string;
  label: string;
  icon?: ReactNode;
  options: DeviceOption[];
  value: string | null;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
  /** 選択肢が 0 件のときに出す文言 */
  emptyLabel?: string;
  hint?: string;
};

export function DeviceSelect({
  id,
  label,
  icon,
  options,
  value,
  onChange,
  disabled,
  emptyLabel = '見つかりません',
  hint,
}: DeviceSelectProps) {
  const isEmpty = options.length === 0;

  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-600"
      >
        {icon}
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || isEmpty}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition-colors focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        {isEmpty ? (
          <option value="">{emptyLabel}</option>
        ) : (
          options.map((o) => (
            <option key={o.deviceId} value={o.deviceId}>
              {o.label}
            </option>
          ))
        )}
      </select>
      {hint && <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}
