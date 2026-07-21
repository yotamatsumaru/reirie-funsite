'use client';

/**
 * あっち向いてホイ用キャラクター表示。
 *
 * - `imageUrls` (管理画面でアップロードした DB 駆動の画像 URL マップ) に pose の
 *   画像が設定されていれば、それを最優先で表示する。
 * - 未設定 / 画像読み込み失敗時は `CHARACTER_IMAGES_ENABLED` の静的ファイル方式
 *   (コード同梱の public/characters 配下の画像) にフォールバック。
 * - さらに失敗 / 未設定なら SVG で描いたプレースホルダーキャラにフォールバック。
 * - pose に応じて表情・向き (横顔) が変わる。
 *
 * pose:
 *   idle                       … 待機(正面)
 *   up / down / left / right   … あっち向いてホイの横顔
 */

import { useEffect, useState } from 'react';
import { pickCharacterImageUrl, type CharacterImageUrlMap } from '@idol/shared';
import {
  CHARACTER_IMAGES_ENABLED,
  CHARACTER_NAME,
  characterImageUrl,
  type CharacterPose,
} from './character';

type Props = {
  pose: CharacterPose;
  /** 管理画面でアップロードされたポーズ別画像 URL マップ (DB 駆動、任意)。 */
  imageUrls?: CharacterImageUrlMap;
  /**
   * このプレイで使用するキャラ画像のパターン番号 (1〜N)。
   * プレイ開始時に一度だけランダムに決め、全ポーズで同じ番号を優先的に使うことで
   * 「途中で別パターンの画像が混ざる」のを防ぎ、統一感を出す。
   * 当該ポーズにこの番号が未登録なら、登録済みの最小番号にフォールバックする。
   */
  variant?: number;
  /** 待機中のふわふわ揺れアニメを有効にするか。 */
  bob?: boolean;
  className?: string;
};

const FACE_DIRS = new Set<CharacterPose>(['up', 'down', 'left', 'right']);

export function CharacterAvatar({
  pose,
  imageUrls,
  variant = 1,
  bob = true,
  className = '',
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);

  // このプレイで選ばれたパターン番号 (variant) を全ポーズで優先的に使う。
  // 当該ポーズに当該パターンが無ければ、登録済みの最小番号にフォールバックする。
  // → プレイ内でパターンが揃い、「最初にパターン1が出たら以降もパターン1」を実現。
  const dbImageUrl = pickCharacterImageUrl(imageUrls?.[pose], variant);

  // pose が変わったら画像エラー状態をリセット
  useEffect(() => {
    setImageFailed(false);
  }, [pose]);

  // 優先度: 1) 管理画面アップロード画像 (DB) → 2) 静的ファイル (CHARACTER_IMAGES_ENABLED) → 3) SVG プレースホルダー
  const resolvedImageSrc = !imageFailed
    ? dbImageUrl ?? (CHARACTER_IMAGES_ENABLED ? characterImageUrl(pose) : null)
    : null;

  return (
    <div
      className={`relative mx-auto flex h-40 w-40 items-center justify-center ${
        bob ? 'animate-acchi-bob' : ''
      } ${className}`}
    >
      {/* 接地影 */}
      <span className="absolute bottom-1 left-1/2 h-3 w-24 -translate-x-1/2 rounded-[50%] bg-black/15 blur-[2px]" />

      {resolvedImageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedImageSrc}
          alt={`${CHARACTER_NAME} (${pose})`}
          onError={() => setImageFailed(true)}
          className="h-40 w-40 object-contain drop-shadow-md transition-transform duration-300"
          draggable={false}
        />
      ) : (
        <PlaceholderCharacter pose={pose} />
      )}
    </div>
  );
}

/**
 * コードだけで描くシンプルなちびキャラ (シルエット + 表情)。
 * 本人画像が用意できるまでの仮素材。
 */
function PlaceholderCharacter({ pose }: { pose: CharacterPose }) {
  const isFaceDir = FACE_DIRS.has(pose);
  // 横顔の "向き" 表現: left/right は反転と少し回転、up/down は傾き。
  const turnStyle: React.CSSProperties = isFaceDir
    ? {
        transform:
          pose === 'left'
            ? 'rotate(-8deg)'
            : pose === 'right'
              ? 'scaleX(-1) rotate(-8deg)'
              : pose === 'up'
                ? 'rotate(0deg) translateY(-2px)'
                : 'rotate(0deg) translateY(2px)',
      }
    : {};

  return (
    <svg
      viewBox="0 0 120 140"
      className="h-40 w-40 drop-shadow-md transition-transform duration-300"
      style={turnStyle}
      role="img"
      aria-label={`キャラクター (${pose})`}
    >
      <defs>
        <linearGradient id="acchi-hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#5b21b6" />
        </linearGradient>
        <linearGradient id="acchi-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>

      {/* 体 */}
      <ellipse cx="60" cy="120" rx="34" ry="20" fill="url(#acchi-body)" />

      {/* 手 (体の横に添える控えめな手) */}
      <Hands pose={pose} />

      {/* 頭 */}
      <g>
        {/* 髪(後ろ) */}
        <circle cx="60" cy="58" r="40" fill="url(#acchi-hair)" />
        {/* 顔 */}
        <circle cx="60" cy="62" r="32" fill="#fde8d4" />
        {/* 前髪 */}
        <path
          d="M28 50 Q60 20 92 50 Q92 36 60 28 Q28 36 28 50 Z"
          fill="url(#acchi-hair)"
        />
        {/* 表情 */}
        <Face pose={pose} />
      </g>
    </svg>
  );
}

function Face({ pose }: { pose: CharacterPose }) {
  // 顔の向き: 横顔(left/right)は目を片側に寄せる。up/down は目の位置を上下に。
  const dir = pose;

  if (dir === 'left' || dir === 'right') {
    // 横顔: 目・口を片側へ。SVG は left を基準に描き、right は親で scaleX(-1) 済み。
    return (
      <g>
        {/* 横顔の輪郭ハイライト(鼻先) */}
        <path d="M30 62 Q24 64 30 70" fill="none" stroke="#f0b48a" strokeWidth="2" />
        {/* 目(片方だけ) */}
        <ellipse cx="46" cy="58" rx="3.4" ry="4.6" fill="#3b2a4a" />
        {/* ほっぺ */}
        <circle cx="52" cy="70" r="5" fill="#fbb6ce" opacity="0.6" />
        {/* 口 */}
        <path d="M40 74 Q46 78 52 74" fill="none" stroke="#b45c7a" strokeWidth="2.2" strokeLinecap="round" />
      </g>
    );
  }

  if (dir === 'up') {
    return (
      <g>
        <ellipse cx="48" cy="52" rx="3.6" ry="3" fill="#3b2a4a" />
        <ellipse cx="72" cy="52" rx="3.6" ry="3" fill="#3b2a4a" />
        <circle cx="44" cy="64" r="5" fill="#fbb6ce" opacity="0.6" />
        <circle cx="76" cy="64" r="5" fill="#fbb6ce" opacity="0.6" />
        <path d="M52 64 Q60 60 68 64" fill="none" stroke="#b45c7a" strokeWidth="2.2" strokeLinecap="round" />
      </g>
    );
  }

  if (dir === 'down') {
    return (
      <g>
        <path d="M44 60 Q48 64 52 60" fill="none" stroke="#3b2a4a" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M68 60 Q72 64 76 60" fill="none" stroke="#3b2a4a" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="44" cy="68" r="5" fill="#fbb6ce" opacity="0.6" />
        <circle cx="76" cy="68" r="5" fill="#fbb6ce" opacity="0.6" />
        <path d="M52 74 Q60 70 68 74" fill="none" stroke="#b45c7a" strokeWidth="2.2" strokeLinecap="round" />
      </g>
    );
  }

  // idle … 正面のにこやか顔
  return (
    <g>
      <circle cx="48" cy="60" r="3.8" fill="#3b2a4a" />
      <circle cx="72" cy="60" r="3.8" fill="#3b2a4a" />
      {/* ハイライト */}
      <circle cx="49.2" cy="58.8" r="1.2" fill="#fff" />
      <circle cx="73.2" cy="58.8" r="1.2" fill="#fff" />
      <circle cx="42" cy="70" r="5.5" fill="#fbb6ce" opacity="0.6" />
      <circle cx="78" cy="70" r="5.5" fill="#fbb6ce" opacity="0.6" />
      <path d="M50 72 Q60 80 70 72" fill="none" stroke="#b45c7a" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  );
}

function Hands({ pose: _pose }: { pose: CharacterPose }) {
  // idle / 方向ポーズ: 小さな手を体の横に
  const common = { fill: '#fde8d4', stroke: '#f0b48a', strokeWidth: 1.5 };
  return (
    <g>
      <circle cx="26" cy="110" r="9" {...common} />
      <circle cx="94" cy="110" r="9" {...common} />
    </g>
  );
}
