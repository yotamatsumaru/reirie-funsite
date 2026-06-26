/**
 * ミニゲーム「あっち向いてホイ」純粋ロジックの単体テスト
 */
import {
  judgeJanken,
  judgeAcchi,
  isJankenHand,
  isAcchiDirection,
  remainingPlays,
  ACCHI_MAX_PLAYS_PER_DAY,
  ACCHI_WIN_REWARD,
} from './mini-game';

describe('judgeJanken', () => {
  it('同じ手はあいこ', () => {
    expect(judgeJanken('ROCK', 'ROCK')).toBe('DRAW');
    expect(judgeJanken('SCISSORS', 'SCISSORS')).toBe('DRAW');
    expect(judgeJanken('PAPER', 'PAPER')).toBe('DRAW');
  });

  it('グーはチョキに勝つ', () => {
    expect(judgeJanken('ROCK', 'SCISSORS')).toBe('WIN');
    expect(judgeJanken('SCISSORS', 'ROCK')).toBe('LOSE');
  });

  it('チョキはパーに勝つ', () => {
    expect(judgeJanken('SCISSORS', 'PAPER')).toBe('WIN');
    expect(judgeJanken('PAPER', 'SCISSORS')).toBe('LOSE');
  });

  it('パーはグーに勝つ', () => {
    expect(judgeJanken('PAPER', 'ROCK')).toBe('WIN');
    expect(judgeJanken('ROCK', 'PAPER')).toBe('LOSE');
  });
});

describe('judgeAcchi', () => {
  it('じゃんけんがあいこならゲームもDRAW', () => {
    expect(judgeAcchi('DRAW', 'UP', 'UP')).toBe('DRAW');
    expect(judgeAcchi('DRAW', 'UP', 'DOWN')).toBe('DRAW');
  });

  it('じゃんけんに勝ち、方向が一致すればプレイヤー勝利', () => {
    expect(judgeAcchi('WIN', 'LEFT', 'LEFT')).toBe('WIN');
  });

  it('じゃんけんに勝っても方向が外れたら勝負つかず(DRAW)', () => {
    expect(judgeAcchi('WIN', 'LEFT', 'RIGHT')).toBe('DRAW');
  });

  it('じゃんけんに負け、方向が一致すればプレイヤー敗北', () => {
    expect(judgeAcchi('LOSE', 'UP', 'UP')).toBe('LOSE');
  });

  it('じゃんけんに負けても方向が外れたら勝負つかず(DRAW)', () => {
    expect(judgeAcchi('LOSE', 'UP', 'DOWN')).toBe('DRAW');
  });
});

describe('isJankenHand / isAcchiDirection', () => {
  it('有効な手だけ true', () => {
    expect(isJankenHand('ROCK')).toBe(true);
    expect(isJankenHand('rock')).toBe(false);
    expect(isJankenHand(undefined)).toBe(false);
  });

  it('有効な方向だけ true', () => {
    expect(isAcchiDirection('UP')).toBe(true);
    expect(isAcchiDirection('up')).toBe(false);
    expect(isAcchiDirection(null)).toBe(false);
  });
});

describe('remainingPlays', () => {
  it('未プレイなら上限と同じ', () => {
    expect(remainingPlays(0)).toBe(ACCHI_MAX_PLAYS_PER_DAY);
  });

  it('上限を超えても負にはならない', () => {
    expect(remainingPlays(ACCHI_MAX_PLAYS_PER_DAY + 3)).toBe(0);
  });

  it('途中なら残り回数を返す', () => {
    expect(remainingPlays(2, 5)).toBe(3);
  });
});

describe('定数', () => {
  it('報酬と上限は正の整数', () => {
    expect(Number.isInteger(ACCHI_WIN_REWARD)).toBe(true);
    expect(ACCHI_WIN_REWARD).toBeGreaterThan(0);
    expect(Number.isInteger(ACCHI_MAX_PLAYS_PER_DAY)).toBe(true);
    expect(ACCHI_MAX_PLAYS_PER_DAY).toBeGreaterThan(0);
  });
});
