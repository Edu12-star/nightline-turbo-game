export type GameStatus = 'start' | 'playing' | 'paused' | 'gameover';

export type TrafficKind = 'coupe' | 'muscle' | 'taxi' | 'tuner' | 'van' | 'rig';

export type PickupKind = 'nitro' | 'shield' | 'chip';

export interface PlayerCar {
  x: number; // normalized road coordinate: -1 (left shoulder) to +1 (right shoulder)
  y: number; // screen y in canvas logical pixels
  vx: number; // lateral velocity in normalized units/sec
  angle: number; // visual roll/yaw tilt in radians
  width: number;
  height: number;
  hull: number;
  maxHull: number;
  nitro: number; // 0..100
  isBoosting: boolean;
  invulnTimer: number; // seconds remaining of post-hit blink
  shieldActive: boolean; // bonus absorb shield
}

export interface TrafficCar {
  id: number;
  lane: number; // 0..3
  x: number; // normalized road coord
  y: number; // logical canvas y
  width: number;
  height: number;
  speed: number; // traffic forward speed in world units/sec
  kind: TrafficKind;
  color: string;
  accent: string;
  targetLane: number;
  laneChangeTimer: number; // countdown before shifting
  blinkerDir: -1 | 0 | 1;
  braking: boolean;
  grazed: boolean; // near-miss already awarded
  passed: boolean; // overtake already counted
  smashed: boolean; // knocked aside during nitro overdrive
  vx: number;
  spin: number;
  alpha: number;
}

export interface Pickup {
  id: number;
  lane: number;
  x: number;
  y: number;
  kind: PickupKind;
  radius: number;
  pulse: number;
  collected: boolean;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  glow?: boolean;
  drag: number;
  shape: 'circle' | 'spark' | 'shard';
  rotation: number;
  vRot: number;
}

export interface SkidMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  alpha: number;
  width: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  subtext?: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface HudSnapshot {
  score: number;
  speedKmh: number;
  combo: number;
  comboTimer: number; // 0..1 normalized remaining
  hull: number;
  maxHull: number;
  nitro: number; // 0..100
  isBoosting: boolean;
  shieldActive: boolean;
  nearMisses: number;
  overtakes: number;
  distanceKm: number;
  maxSpeedKmh: number;
  bestCombo: number;
}

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
  touchTargetX: number | null; // normalized road x (-1..1) if dragging
  touchSteerDir: -1 | 0 | 1; // tap-zone steering
}

export interface HighScoreEntry {
  id: string;
  name: string;
  score: number;
  nearMisses: number;
  maxSpeedKmh: number;
  date: string;
  isPlayer?: boolean;
}
