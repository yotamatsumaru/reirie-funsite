'use client';

/**
 * あっち向いてホイ用のサウンド再生フック。
 *
 * 特徴:
 *  - ファイルが存在しない / 読み込めない場合は黙ってスキップ (ボイス未配置でも安全)。
 *  - ボイス (voice=true) は VOICE_ENABLED が false のうちは鳴らさない。
 *  - ミュート状態は localStorage に保存し、リロードしても維持。
 *  - 自動再生ポリシー対策: 実際の再生はユーザー操作 (ボタン等) の延長で行われる想定。
 *  - Audio 要素はキーごとにキャッシュして使い回す。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SOUNDS,
  SE_ENABLED,
  VOICE_ENABLED,
  SOUND_MUTE_STORAGE_KEY,
  type SoundKey,
} from './sounds';

export type UseAcchiSound = {
  /** 指定キーのサウンドを鳴らす (ミュート/無効/未配置なら何もしない)。 */
  play: (key: SoundKey) => void;
  /** ミュート中か。 */
  muted: boolean;
  /** ミュートを切り替える。 */
  toggleMute: () => void;
};

export function useAcchiSound(): UseAcchiSound {
  const [muted, setMuted] = useState(false);
  const cacheRef = useRef<Map<SoundKey, HTMLAudioElement>>(new Map());
  // 読み込みに失敗した (= 存在しない) キーを覚えておき、再試行を避ける。
  const failedRef = useRef<Set<SoundKey>>(new Set());

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

  const getAudio = useCallback((key: SoundKey): HTMLAudioElement | null => {
    if (failedRef.current.has(key)) return null;
    const cached = cacheRef.current.get(key);
    if (cached) return cached;

    const def = SOUNDS[key];
    if (!def) return null;

    const audio = new Audio(def.src);
    audio.volume = def.volume;
    audio.preload = 'auto';
    // 読み込み失敗 (ファイル未配置など) を記録して以後スキップ。
    audio.addEventListener('error', () => {
      failedRef.current.add(key);
      cacheRef.current.delete(key);
    });
    cacheRef.current.set(key, audio);
    return audio;
  }, []);

  const play = useCallback(
    (key: SoundKey) => {
      if (muted) return;
      const def = SOUNDS[key];
      if (!def) return;
      // 種別ごとの有効/無効フラグ。
      if (def.voice ? !VOICE_ENABLED : !SE_ENABLED) return;

      const audio = getAudio(key);
      if (!audio) return;
      try {
        audio.currentTime = 0;
        // play() の Promise 拒否 (自動再生ブロック等) は握りつぶす。
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            /* 再生できなくてもゲーム進行は妨げない */
          });
        }
      } catch {
        /* 何もしない */
      }
    },
    [muted, getAudio],
  );

  return useMemo(() => ({ play, muted, toggleMute }), [play, muted, toggleMute]);
}
