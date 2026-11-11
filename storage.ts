import { HighScoreEntry } from './types';

const SCORES_KEY = 'nightline_turbo_highscores_v1';
const SOUND_KEY = 'nightline_turbo_muted_v1';
const DRIVER_KEY = 'nightline_turbo_driver_v1';

const DEFAULT_SCORES: HighScoreEntry[] = [
  {
    id: 'seed-1',
    name: 'KAI',
    score: 14800,
    nearMisses: 18,
    maxSpeedKmh: 286,
    date: '2026-01-12',
  },
  {
    id: 'seed-2',
    name: 'VEX',
    score: 10500,
    nearMisses: 14,
    maxSpeedKmh: 268,
    date: '2026-01-10',
  },
  {
    id: 'seed-3',
    name: 'NOVA',
    score: 7200,
    nearMisses: 9,
    maxSpeedKmh: 249,
    date: '2026-01-08',
  },
  {
    id: 'seed-4',
    name: 'ZERO',
    score: 4500,
    nearMisses: 6,
    maxSpeedKmh: 232,
    date: '2026-01-05',
  },
  {
    id: 'seed-5',
    name: 'ACE',
    score: 2200,
    nearMisses: 3,
    maxSpeedKmh: 215,
    date: '2026-01-02',
  },
];

export function loadHighScores(): HighScoreEntry[] {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) {
      localStorage.setItem(SCORES_KEY, JSON.stringify(DEFAULT_SCORES));
      return [...DEFAULT_SCORES];
    }
    const parsed = JSON.parse(raw) as HighScoreEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...DEFAULT_SCORES];
    }
    return parsed.sort((a, b) => b.score - a.score).slice(0, 10);
  } catch {
    return [...DEFAULT_SCORES];
  }
}

export function saveHighScore(entry: Omit<HighScoreEntry, 'id' | 'date'>): HighScoreEntry[] {
  const existing = loadHighScores();
  const next: HighScoreEntry = {
    ...entry,
    name: (entry.name.trim().toUpperCase() || 'RACER').slice(0, 8),
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString().slice(0, 10),
    isPlayer: true,
  };
  const updated = [...existing, next]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(updated));
  } catch {
    // ignore storage quota errors
  }
  return updated;
}

export function isQualifyingHighScore(score: number): boolean {
  if (score <= 0) return false;
  const scores = loadHighScores();
  if (scores.length < 10) return true;
  return score > scores[scores.length - 1].score;
}

export function getBestScore(): number {
  const scores = loadHighScores();
  return scores.length > 0 ? scores[0].score : 0;
}

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, String(muted));
  } catch {
    // ignore
  }
}

export function loadDriverName(): string {
  try {
    return localStorage.getItem(DRIVER_KEY) || 'YOU';
  } catch {
    return 'YOU';
  }
}

export function saveDriverName(name: string): void {
  try {
    localStorage.setItem(DRIVER_KEY, name.trim().toUpperCase().slice(0, 8) || 'YOU');
  } catch {
    // ignore
  }
}
