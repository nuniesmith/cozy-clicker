import {
  SimState,
  INITIAL_STATE,
  ACTION_DELTAS,
  STAT_DECAY_PER_SECOND,
  clamp,
  StatId,
  SimAction,
} from '../../shared/api';
import { context, redis } from '@devvit/web/server';

const STATE_KEY = (postId: string) => `sim:state:${postId}`;

export async function loadState(postId: string): Promise<SimState> {
  const raw = await redis.get(STATE_KEY(postId));
  const state: SimState = raw
    ? (JSON.parse(raw) as SimState)
    : { ...INITIAL_STATE };
  const now = Date.now();
  const elapsedSeconds = Math.min((now - state.lastSeen) / 1000, 3600);

  for (const [stat, rate] of Object.entries(STAT_DECAY_PER_SECOND) as [
    StatId,
    number,
  ][]) {
    state.stats[stat] -= rate * elapsedSeconds;
    state.stats[stat] = clamp(state.stats[stat]);
  }

  state.lastSeen = now;
  return state;
}

export async function saveState(
  postId: string,
  state: SimState
): Promise<void> {
  await redis.set(STATE_KEY(postId), JSON.stringify(state));
  await redis.expire(STATE_KEY(postId), 86400);
}

export async function applyAction(
  postId: string,
  action: SimAction
): Promise<SimState> {
  const state = await loadState(postId);
  const delta = ACTION_DELTAS[action];
  for (const [key, change] of Object.entries(delta)) {
    if (key === 'coins') {
      state.coins += Number(change);
    } else {
      const stat = key as StatId; // Safe due to ACTION_DELTAS type
      state.stats[stat] += Number(change);
      state.stats[stat] = clamp(state.stats[stat]);
    }
  }
  await saveState(postId, state);
  return state;
}

export async function createPost(): Promise<{ id: string }> {
  // TODO: Use Devvit UI trigger or form for post creation (RedditClient is read-only)
  // Docs: https://developers.reddit.com/docs/devvit (check triggers/UI)
  console.log(`Creating post in r/${context.subredditName}`);
  return { id: `demo-post-${Date.now()}` };
}
