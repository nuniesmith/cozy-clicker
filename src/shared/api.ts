export type SimAction = 'eat' | 'sleep' | 'play';

export type StatId = 'hunger' | 'thirst' | 'energy' | 'fun';

export type UpgradeId = 'auto-eat' | 'double-coins' | 'slow-decay';

export type SimState = {
  stats: Record<StatId, number>;
  coins: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  lastSeen: number;
};

export const INITIAL_STATE: SimState = {
  stats: {
    hunger: 100,
    thirst: 100,
    energy: 100,
    fun: 100,
  },
  coins: 0,
  upgrades: {},
  lastSeen: Date.now(),
};

export const STAT_DECAY_PER_SECOND: Record<StatId, number> = {
  hunger: 0.1,
  thirst: 0.08,
  energy: 0.06,
  fun: 0.04,
};

export const ACTION_DELTAS: Record<
  SimAction,
  Partial<Record<StatId, number>> & { coins: number }
> = {
  eat: {
    hunger: 30,
    thirst: 20,
    energy: -10,
    fun: 5,
    coins: 1,
  },
  sleep: {
    energy: 40,
    thirst: 10,
    hunger: -5,
    fun: 10,
    coins: 1,
  },
  play: {
    fun: 35,
    energy: -15,
    hunger: -10,
    coins: 2,
  },
};

export const UPGRADES: Record<UpgradeId, { baseCost: number }> = {
  'auto-eat': { baseCost: 20 },
  'double-coins': { baseCost: 50 },
  'slow-decay': { baseCost: 100 },
};

export function clamp(
  value: number,
  min: number = 0,
  max: number = 100
): number {
  return Math.max(min, Math.min(value, max));
}

export function calcMood(state: SimState): number {
  const values = Object.values(state.stats);
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

export type ToServerMessage =
  | { type: 'action'; action: SimAction }
  | { type: 'poll' }
  | { type: 'buyUpgrade'; upgradeId: UpgradeId };

export type ToClientMessage =
  | { type: 'stateUpdate'; state: SimState }
  | { type: 'actionResult'; state: SimState }
  | { type: 'error'; message: string };
