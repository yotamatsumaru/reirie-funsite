/**
 * /admin/game/characters/new — 新規キャラクター作成
 */
import type { Metadata } from 'next';
import { CharacterForm } from '../character-form';

export const metadata: Metadata = { title: 'キャラクター新規作成' };

export default function NewCharacterPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">キャラクター新規作成</h1>
      <CharacterForm mode="create" />
    </div>
  );
}
