'use client';

/**
 * あっち向いてホイ用のサウンド再生フック。
 *
 * 特徴:
 *  - 効果音 (SE) は静的ファイル。ボイスは引数 voiceUrls (slot→URL) から動的に解決。
 *  - URL が無い / 読み込めない場合は黙ってスキップ (ボイス未アップロードでも安全)。
 *  - ミュート状態は localStorage に保存し、リロードしても維持。
 *  - 自動再生ポリシー対策: 実際の再生はユーザー操作 (ボタン等) の延長で行われる想定。
 *  - Audio 要素はキーごとにキャッシュして使い回す。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AcchiVoiceUrlMap } from '@idol/shared';
import {
  SE,
  SE_ENABLED,
  SOUND_MUTE_STORAGE_KEY,
  buildVoiceDefs,
  type SoundDef,
  type SoundKey,
} from './sounds';

export type UseAcchiSound = {
  /** 指定キーのサウンドを鳴らす (ミュート/無効/未設定なら何もしない)。 */
  play: (key: SoundKey) => void;
  /**
   * 指定キーのサウンドを鳴らし、再生が終わる (または一定時間で打ち切る) まで待つ Promise を返す。
   * ミュート / 未設定 / 再生ブロック時は即座に解決するため、呼び出し側が固まることはない。
   * (例: 「またね」ボイスを鳴らし切ってからページ遷移したい場合に使う)
   */
  playToEnd: (key: SoundKey) => Promise<void>;
  /** ミュート中か。 */
  muted: boolean;
  /** ミュートを切り替える。 */
  toggleMute: () => void;
};

/** playToEnd の保険タイムアウト (ms)。音声が長すぎる/終了イベントが来ない場合に強制解決。 */
const PLAY_TO_END_MAX_WAIT_MS = 6000;

export function useAcchiSound(voiceUrls: AcchiVoiceUrlMap = {}): UseAcchiSound {
  const [muted, setMuted] = useState(false);
  const cacheRef = useRef<Map<SoundKey, HTMLAudioElement>>(new Map());
  // 読み込みに失敗した (= 存在しない) キーを覚えておき、再試行を避ける。
  const failedRef = useRef<Set<SoundKey>>(new Set());

  // SE + ボイスを統合したサウンド定義マップ。
  // voiceUrls が変わったら作り直す (= キャッシュもクリア)。
  const soundMap = useMemo<Partial<Record<SoundKey, SoundDef>>>(() => {
    return { ...SE, ...buildVoiceDefs(voiceUrls) };
  }, [voiceUrls]);

  useEffect(() => {
    // 定義が変わったら Audio キャッシュと失敗記録をリセット。
    cacheRef.current.clear();
    failedRef.current.clear();
  }, [soundMap]);

  // 初期ミュート状態を localStorage から復元。
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SOUND_MUTE_STORAGE_KEY);
      if (saved === '1') setMuted(true);
    } catch {
      /* localStorage 不可環境は既定 (ミュート解除) */
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SOUND_MUTE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* 保存できなくても動作は継続 */
      }
      return next;
    });
  }, []);

  const getAudio = useCallback(
    (key: SoundKey): HTMLAudioElement | null => {
      if (failedRef.current.has(key)) return null;
      const cached = cacheRef.current.get(key);
      if (cached) return cached;

      const def = soundMap[key];
      if (!def) return null;

      const audio = new Audio(def.src);
      audio.volume = def.volume;
      audio.preload = 'auto';
      audio.addEventListener('error', () => {
        failedRef.current.add(key);
        cacheRef.current.delete(key);
      });
      cacheRef.current.set(key, audio);
      return audio;
    },
    [soundMap],
  );

  const play = useCallback(
    (key: SoundKey) => {
      if (muted) return;
      const def = soundMap[key];
      if (!def) return; // 未設定 (ボイス未アップロード等) はスキップ。
      if (!def.voice && !SE_ENABLED) return;

      const audio = getAudio(key);
      if (!audio) return;
      try {
        audio.currentTime = 0;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            /* 自動再生ブロック等は握りつぶす */
          });
        }
      } catch {
        /* 何もしない */
      }
    },
    [muted, soundMap, getAudio],
  );

  const playToEnd = useCallback(
    (key: SoundKey): Promise<void> => {
      // 鳴らさないケースは即解決 (呼び出し側を絶対にブロックしない)。
      if (muted) return Promise.resolve();
      const def = soundMap[key];
      if (!def) return Promise.resolve();
      if (!def.voice && !SE_ENABLED) return Promise.resolve();

      const audio = getAudio(key);
      if (!audio) return Promise.resolve();

      return new Promise<void>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          audio.removeEventListener('ended', onEnded);
          audio.removeEventListener('error', onError);
        };
        const done = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        function onEnded() {
          done();
        }
        function onError() {
          done();
        }

        audio.addEventListener('ended', onEnded);
        audio.addEventListener('error', onError);
        // 保険: 終了イベントが来なくても必ず解決させる。
        timer = setTimeout(done, PLAY_TO_END_MAX_WAIT_MS);

        try {
          audio.currentTime = 0;
          const p = audio.play();
          if (p && typeof p.catch === 'function') {
            p.catch(() => {
              // 自動再生ブロック等。待たずに解決する。
              done();
            });
          }
        } catch {
          done();
        }
      });
    },
    [muted, soundMap, getAudio],
  );

  return useMemo(
    () => ({ play, playToEnd, muted, toggleMute }),
    [play, playToEnd, muted, toggleMute],
  );
}
