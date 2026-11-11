import { soundEngine } from './audio';
import {
  FloatingText,
  GameStatus,
  HudSnapshot,
  InputState,
  Particle,
  Pickup,
  PickupKind,
  PlayerCar,
  SkidMark,
  TrafficCar,
  TrafficKind,
} from './types';

const LANE_CENTERS = [-0.75, -0.25, 0.25, 0.75];
const MAX_PARTICLES = 240;
const MAX_SKIDS = 90;
const COMBO_DURATION = 3.6;

interface RoadLight {
  y: number;
  side: -1 | 1;
}

interface BuildingSilhouette {
  y: number;
  side: -1 | 1;
  w: number;
  h: number;
  hue: string;
}

const TRAFFIC_CATALOG: Array<{
  kind: TrafficKind;
  color: string;
  accent: string;
  wFactor: number;
  hFactor: number;
  speedRange: [number, number];
  weight: number;
}> = [
  {
    kind: 'muscle',
    color: '#FF2A6D',
    accent: '#FFC8DD',
    wFactor: 0.98,
    hFactor: 1.0,
    speedRange: [240, 340],
    weight: 24,
  },
  {
    kind: 'taxi',
    color: '#FFB800',
    accent: '#1E293B',
    wFactor: 0.96,
    hFactor: 0.98,
    speedRange: [210, 290],
    weight: 22,
  },
  {
    kind: 'tuner',
    color: '#39FF14',
    accent: '#0B0E17',
    wFactor: 0.94,
    hFactor: 0.96,
    speedRange: [280, 390],
    weight: 18,
  },
  {
    kind: 'coupe',
    color: '#B24BF3',
    accent: '#E9D5FF',
    wFactor: 0.95,
    hFactor: 0.96,
    speedRange: [230, 320],
    weight: 20,
  },
  {
    kind: 'van',
    color: '#38BDF8',
    accent: '#E0F2FE',
    wFactor: 1.06,
    hFactor: 1.18,
    speedRange: [185, 255],
    weight: 10,
  },
  {
    kind: 'rig',
    color: '#64748B',
    accent: '#F59E0B',
    wFactor: 1.12,
    hFactor: 1.72,
    speedRange: [155, 215],
    weight: 7,
  },
];

export class RaceEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 800;
  private height: number = 600;
  private dpr: number = 1;
  private roadLeft: number = 160;
  private roadWidth: number = 480;
  private laneWidth: number = 120;

  private status: GameStatus = 'start';
  private rafId: number | null = null;
  private lastTime: number = 0;

  private player: PlayerCar;
  private traffic: TrafficCar[] = [];
  private pickups: Pickup[] = [];
  private particles: Particle[] = [];
  private skids: SkidMark[] = [];
  private floatingTexts: FloatingText[] = [];
  private roadLights: RoadLight[] = [];
  private buildings: BuildingSilhouette[] = [];

  private nextId: number = 1;
  private worldScroll: number = 0;
  private roadStripeOffset: number = 0;
  private speed: number = 420; // world px/s
  private elapsedRunTime: number = 0;
  private spawnTimer: number = 0.6;
  private pickupTimer: number = 3.2;

  private score: number = 0;
  private distancePx: number = 0;
  private combo: number = 1;
  private comboTimer: number = 0;
  private nearMisses: number = 0;
  private overtakes: number = 0;
  private maxSpeedKmh: number = 0;
  private bestCombo: number = 1;

  // Juice state
  private shakeIntensity: number = 0;
  private shakeX: number = 0;
  private shakeY: number = 0;
  private hitStopTimer: number = 0;
  private flashAlpha: number = 0;
  private flashColor: string = '#FF2A6D';
  private gameOverDelay: number = 0;
  private pendingGameOver: boolean = false;
  private exhaustTimer: number = 0;
  private prevWheelPos: { lx: number; rx: number; y: number } | null = null;

  private input: InputState = {
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false,
    touchTargetX: null,
    touchSteerDir: 0,
  };

  private onHudUpdate: (hud: HudSnapshot) => void;
  private onGameOver: (finalHud: HudSnapshot) => void;
  private hudEmitTimer: number = 0;

  constructor(
    canvas: HTMLCanvasElement,
    onHudUpdate: (hud: HudSnapshot) => void,
    onGameOver: (finalHud: HudSnapshot) => void
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = context;
    this.onHudUpdate = onHudUpdate;
    this.onGameOver = onGameOver;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 2,
        life: 0,
        maxLife: 1,
        color: '#00F0FF',
        drag: 0.96,
        shape: 'circle',
        rotation: 0,
        vRot: 0,
      });
    }

    this.player = this.createInitialPlayer();
    this.resize();
    this.initScenery();
    this.seedDemoTraffic();
  }

  private createInitialPlayer(): PlayerCar {
    const carW = Math.max(32, Math.min(48, this.laneWidth * 0.44));
    const carH = carW * 1.92;
    return {
      x: 0.25,
      y: this.height * 0.78,
      vx: 0,
      angle: 0,
      width: carW,
      height: carH,
      hull: 3,
      maxHull: 3,
      nitro: 55,
      isBoosting: false,
      invulnTimer: 0,
      shieldActive: false,
    };
  }

  public resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const w = rect ? rect.width : window.innerWidth;
    const h = rect ? rect.height : window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, Math.floor(w));
    this.height = Math.max(420, Math.floor(h));

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    // Road sizing that feels great on both mobile portrait & widescreen desktop
    const maxRoad = this.width < 640 ? this.width * 0.88 : Math.min(this.width * 0.62, 500);
    this.roadWidth = Math.max(270, Math.floor(maxRoad));
    this.roadLeft = Math.floor((this.width - this.roadWidth) / 2);
    this.laneWidth = this.roadWidth / 4;

    if (this.player) {
      this.player.width = Math.max(30, Math.min(48, this.laneWidth * 0.44));
      this.player.height = this.player.width * 1.92;
      this.player.y = this.height * (this.width < 640 ? 0.74 : 0.79);
    }
  }

  private initScenery(): void {
    this.roadLights = [];
    for (let y = -100; y < this.height + 200; y += 170) {
      this.roadLights.push({ y, side: -1 });
      this.roadLights.push({ y: y + 85, side: 1 });
    }
    this.buildings = [];
    const hues = ['#121829', '#161D31', '#101626', '#192238'];
    for (let y = -120; y < this.height + 240; y += 120) {
      this.buildings.push({
        y,
        side: -1,
        w: 40 + Math.random() * 65,
        h: 70 + Math.random() * 80,
        hue: hues[Math.floor(Math.random() * hues.length)],
      });
      this.buildings.push({
        y: y + 40,
        side: 1,
        w: 40 + Math.random() * 65,
        h: 70 + Math.random() * 80,
        hue: hues[Math.floor(Math.random() * hues.length)],
      });
    }
  }

  private seedDemoTraffic(): void {
    this.traffic = [];
    for (let i = 0; i < 4; i++) {
      this.spawnTrafficCar(-120 - i * 210, i % 4);
    }
  }

  public startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(rawDt, 0.05); // clamp dt for tab-switch safety

      this.update(dt);
      this.render();

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    soundEngine.updateEngine(0, false, false);
  }

  public setStatus(status: GameStatus): void {
    this.status = status;
    if (status !== 'playing') {
      soundEngine.updateEngine(0, false, false);
    }
  }

  public startNewRun(): void {
    soundEngine.startEngine();
    soundEngine.playStart();

    this.status = 'playing';
    this.player = this.createInitialPlayer();
    this.traffic = [];
    this.pickups = [];
    this.skids = [];
    this.floatingTexts = [];
    this.prevWheelPos = null;
    for (const p of this.particles) p.active = false;

    this.score = 0;
    this.distancePx = 0;
    this.elapsedRunTime = 0;
    this.speed = 470;
    this.combo = 1;
    this.comboTimer = 0;
    this.nearMisses = 0;
    this.overtakes = 0;
    this.maxSpeedKmh = 148;
    this.bestCombo = 1;
    this.spawnTimer = 0.35; // fast action within 1 second!
    this.pickupTimer = 2.4;
    this.shakeIntensity = 0;
    this.hitStopTimer = 0;
    this.flashAlpha = 0;
    this.pendingGameOver = false;
    this.gameOverDelay = 0;

    // Seed two starter cars well ahead so the highway feels alive on frame 1
    this.spawnTrafficCar(-80, 0);
    this.spawnTrafficCar(-310, 2);

    this.emitHud();
  }

  public setInput(partial: Partial<InputState>): void {
    Object.assign(this.input, partial);
  }

  public getRoadMetrics(): { roadLeft: number; roadWidth: number } {
    return { roadLeft: this.roadLeft, roadWidth: this.roadWidth };
  }

  public getPlayerX(): number {
    return this.player.x;
  }

  private roadXToPx(normX: number): number {
    return this.roadLeft + ((normX + 1) * 0.5) * this.roadWidth;
  }

  public pxToRoadX(px: number): number {
    return ((px - this.roadLeft) / this.roadWidth) * 2 - 1;
  }

  private getSnapshot(): HudSnapshot {
    const speedKmh = Math.round(this.speed * 0.32);
    return {
      score: Math.floor(this.score),
      speedKmh,
      combo: this.combo,
      comboTimer: this.combo > 1 ? Math.max(0, this.comboTimer / COMBO_DURATION) : 0,
      hull: this.player.hull,
      maxHull: this.player.maxHull,
      nitro: Math.round(this.player.nitro),
      isBoosting: this.player.isBoosting,
      shieldActive: this.player.shieldActive,
      nearMisses: this.nearMisses,
      overtakes: this.overtakes,
      distanceKm: Number((this.distancePx / 18000).toFixed(2)),
      maxSpeedKmh: Math.max(this.maxSpeedKmh, speedKmh),
      bestCombo: this.bestCombo,
    };
  }

  private emitHud(): void {
    this.onHudUpdate(this.getSnapshot());
  }

  private update(dt: number): void {
    // Screen shake decay always runs smoothly
    if (this.shakeIntensity > 0.1) {
      this.shakeX = (Math.random() * 2 - 1) * this.shakeIntensity;
      this.shakeY = (Math.random() * 2 - 1) * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.015, dt);
    } else {
      this.shakeIntensity = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }

    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.8);
    }

    if (this.status === 'paused') {
      return;
    }

    if (this.status === 'start') {
      this.updateAttractDemo(dt);
      return;
    }

    if (this.status === 'gameover') {
      this.updateParticles(dt);
      this.updateFloatingTexts(dt);
      return;
    }

    // Hit-stop freeze frame for juicy heavy impacts
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      return;
    }

    // Pending game-over dramatic slow-down beat
    if (this.pendingGameOver) {
      this.gameOverDelay -= dt;
      this.speed = Math.max(120, this.speed - dt * 420);
      this.scrollWorld(dt, this.speed);
      this.updateParticles(dt);
      this.updateFloatingTexts(dt);
      soundEngine.updateEngine(0.15, false, false);
      if (this.gameOverDelay <= 0) {
        this.pendingGameOver = false;
        this.status = 'gameover';
        this.onGameOver(this.getSnapshot());
      }
      return;
    }

    this.elapsedRunTime += dt;

    // Speed progression: snappy start, escalates smoothly to thrilling 300+ KM/H
    const difficultyRamp = Math.min(1, this.elapsedRunTime / 75);
    const baseCruise = 470 + difficultyRamp * 300;
    const braking = this.input.down;
    const wantsBoost = (this.input.boost || this.input.up) && this.player.nitro > 1;

    if (wantsBoost && !this.player.isBoosting && this.player.nitro >= 10) {
      this.player.isBoosting = true;
      soundEngine.playNitro();
      this.shakeIntensity = Math.max(this.shakeIntensity, 4.5);
      this.spawnBurst(this.roadXToPx(this.player.x), this.player.y + this.player.height * 0.45, '#00F0FF', 16, 260);
    } else if (!wantsBoost || this.player.nitro <= 0.2) {
      this.player.isBoosting = false;
    }

    if (this.player.isBoosting) {
      this.player.nitro = Math.max(0, this.player.nitro - dt * 27);
      if (this.player.nitro <= 0.2) {
        this.player.isBoosting = false;
      }
    } else {
      // Gentle passive trickle so player is never starved long
      this.player.nitro = Math.min(100, this.player.nitro + dt * 2.2);
    }

    let targetSpeed = baseCruise;
    if (this.player.isBoosting) {
      targetSpeed = baseCruise + 310;
    } else if (braking) {
      targetSpeed = Math.max(290, baseCruise * 0.66);
    }

    const accelRate = this.player.isBoosting ? 7.5 : braking ? 8.5 : 3.2;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * accelRate);

    const currentKmh = Math.round(this.speed * 0.32);
    if (currentKmh > this.maxSpeedKmh) this.maxSpeedKmh = currentKmh;

    soundEngine.updateEngine(
      Math.min(1, (this.speed - 300) / 680),
      this.player.isBoosting,
      true
    );

    // Tight steering physics
    this.updatePlayerSteering(dt);

    // Invulnerability blink & combo timer
    if (this.player.invulnTimer > 0) {
      this.player.invulnTimer = Math.max(0, this.player.invulnTimer - dt);
    }
    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.comboTimer = 0;
      }
    }

    // Score & distance
    const boostMult = this.player.isBoosting ? 2 : 1;
    this.distancePx += this.speed * dt;
    this.score += (this.speed * 0.11 * this.combo * boostMult) * dt;

    // Scroll scenery, traffic, pickups
    this.scrollWorld(dt, this.speed);
    this.updateExhaust(dt);
    this.updateTraffic(dt, difficultyRamp);
    this.updatePickups(dt);
    this.updateParticles(dt);
    this.updateSkids(dt);
    this.updateFloatingTexts(dt);

    // Spawn waves
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTrafficWave(difficultyRamp);
      const minInterval = Math.max(0.42, 1.05 - difficultyRamp * 0.56);
      const maxInterval = Math.max(0.68, 1.45 - difficultyRamp * 0.66);
      this.spawnTimer = minInterval + Math.random() * (maxInterval - minInterval);
    }

    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.spawnPickup();
      this.pickupTimer = 3.8 + Math.random() * 3.2;
    }

    // Throttled HUD update (~20fps is plenty for React DOM numbers, Canvas stays 60fps!)
    this.hudEmitTimer -= dt;
    if (this.hudEmitTimer <= 0) {
      this.hudEmitTimer = 0.05;
      this.emitHud();
    }
  }

  private updateAttractDemo(dt: number): void {
    this.speed = 440;
    this.scrollWorld(dt, this.speed);
    // Gentle AI lane weave on start screen
    const t = performance.now() * 0.001;
    const targetX = Math.sin(t * 0.75) * 0.52;
    const diff = targetX - this.player.x;
    this.player.vx = diff * 3.5;
    this.player.x += this.player.vx * dt;
    this.player.angle = Math.max(-0.18, Math.min(0.18, this.player.vx * 0.14));

    this.updateExhaust(dt);
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const car = this.traffic[i];
      car.y += (this.speed - car.speed) * dt;
      if (car.y > this.height + 160) {
        this.traffic.splice(i, 1);
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const lane = Math.floor(Math.random() * 4);
      this.spawnTrafficCar(-130, lane);
      this.spawnTimer = 0.9 + Math.random() * 0.7;
    }
    this.updateParticles(dt);
    this.updateSkids(dt);
  }

  private updatePlayerSteering(dt: number): void {
    const p = this.player;

    if (this.input.touchTargetX !== null) {
      // Responsive direct touch drag tracking
      const target = Math.max(-0.88, Math.min(0.88, this.input.touchTargetX));
      const delta = target - p.x;
      const maxSpeed = 4.2;
      p.vx = Math.max(-maxSpeed, Math.min(maxSpeed, delta * 14));
    } else {
      let dir = 0;
      if (this.input.left || this.input.touchSteerDir === -1) dir -= 1;
      if (this.input.right || this.input.touchSteerDir === 1) dir += 1;

      const accel = 16.5;
      const maxLateral = 2.45;
      if (dir !== 0) {
        // Extra snappy counter-steer if reversing direction
        const reversing = dir * p.vx < 0;
        p.vx += dir * accel * (reversing ? 1.8 : 1) * dt;
        p.vx = Math.max(-maxLateral, Math.min(maxLateral, p.vx));
      } else {
        // Tight grip damping so car stops drifting immediately when key released
        p.vx *= Math.pow(0.0008, dt);
        if (Math.abs(p.vx) < 0.02) p.vx = 0;
      }
    }

    p.x += p.vx * dt;

    // Guardrail collision check
    const railLimit = 0.87;
    if (p.x < -railLimit) {
      p.x = -railLimit;
      if (p.vx < -0.3) {
        this.spawnBurst(this.roadXToPx(-0.96), p.y, '#FFB800', 8, 170);
        this.shakeIntensity = Math.max(this.shakeIntensity, 2.5);
      }
      p.vx = Math.abs(p.vx) * 0.25;
    } else if (p.x > railLimit) {
      p.x = railLimit;
      if (p.vx > 0.3) {
        this.spawnBurst(this.roadXToPx(0.96), p.y, '#FFB800', 8, 170);
        this.shakeIntensity = Math.max(this.shakeIntensity, 2.5);
      }
      p.vx = -Math.abs(p.vx) * 0.25;
    }

    // Visual body roll / yaw angle
    const targetAngle = Math.max(-0.24, Math.min(0.24, p.vx * 0.11));
    p.angle += (targetAngle - p.angle) * Math.min(1, dt * 16);

    // Tire skid marks on sharp cuts or braking
    const px = this.roadXToPx(p.x);
    const wheelOffset = p.width * 0.36;
    const wy = p.y + p.height * 0.34;
    const lx = px - wheelOffset;
    const rx = px + wheelOffset;

    const isCuttingHard = Math.abs(p.vx) > 1.35 || (this.input.down && this.status === 'playing');
    if (isCuttingHard && this.prevWheelPos) {
      this.pushSkid(this.prevWheelPos.lx, this.prevWheelPos.y, lx, wy);
      this.pushSkid(this.prevWheelPos.rx, this.prevWheelPos.y, rx, wy);
    }
    this.prevWheelPos = { lx, rx, y: wy };
  }

  private pushSkid(x1: number, y1: number, x2: number, y2: number): void {
    if (this.skids.length >= MAX_SKIDS) {
      this.skids.shift();
    }
    this.skids.push({ x1, y1, x2, y2, alpha: 0.42, width: 3.5 });
  }

  private scrollWorld(dt: number, speed: number): void {
    const dy = speed * dt;
    this.worldScroll += dy;
    this.roadStripeOffset = (this.roadStripeOffset + dy) % 90;

    for (const light of this.roadLights) {
      light.y += dy;
      if (light.y > this.height + 120) {
        light.y -= this.height + 280;
      }
    }

    for (const b of this.buildings) {
      b.y += dy * 0.55; // subtle parallax depth
      if (b.y > this.height + 140) {
        b.y -= this.height + 320;
      }
    }
  }

  private updateExhaust(dt: number): void {
    this.exhaustTimer -= dt;
    const interval = this.player.isBoosting ? 0.014 : 0.035;
    if (this.exhaustTimer > 0) return;
    this.exhaustTimer = interval;

    const px = this.roadXToPx(this.player.x);
    const py = this.player.y + this.player.height * 0.48;
    const pipeOffset = this.player.width * 0.24;

    for (const side of [-1, 1]) {
      const color = this.player.isBoosting
        ? Math.random() > 0.4
          ? '#00F0FF'
          : '#A855F7'
        : Math.random() > 0.35
          ? '#FF9E00'
          : '#FF2A6D';

      this.spawnParticle({
        x: px + side * pipeOffset + (Math.random() - 0.5) * 3,
        y: py,
        vx: (Math.random() - 0.5) * 28,
        vy: (this.player.isBoosting ? 240 : 120) + Math.random() * 80,
        size: this.player.isBoosting ? 5.5 : 3.2,
        life: this.player.isBoosting ? 0.22 : 0.15,
        color,
        glow: true,
        drag: 0.94,
        shape: 'circle',
      });
    }
  }

  private spawnTrafficWave(difficultyRamp: number): void {
    // Choose 1..3 occupied lanes, always leaving at least 1 lane completely open!
    const maxCars = difficultyRamp < 0.25 ? 2 : 3;
    const count = Math.random() < 0.35 + difficultyRamp * 0.4 ? maxCars : 1;
    const lanes = [0, 1, 2, 3];
    // Shuffle lanes
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }

    const chosen = lanes.slice(0, count);
    chosen.forEach((lane, idx) => {
      // Stagger y slightly so waves look natural and weaveable
      const yOffset = -130 - idx * (55 + Math.random() * 65);
      // Avoid overlapping an already-spawned car in the same lane near top
      const blocked = this.traffic.some(
        (c) => c.lane === lane && c.y < 80
      );
      if (!blocked) {
        this.spawnTrafficCar(yOffset, lane);
      }
    });
  }

  private spawnTrafficCar(y: number, lane: number): void {
    const totalWeight = TRAFFIC_CATALOG.reduce((s, item) => s + item.weight, 0);
    let r = Math.random() * totalWeight;
    let spec = TRAFFIC_CATALOG[0];
    for (const item of TRAFFIC_CATALOG) {
      r -= item.weight;
      if (r <= 0) {
        spec = item;
        break;
      }
    }

    const baseW = this.player.width;
    const baseH = this.player.height;
    const speed =
      spec.speedRange[0] + Math.random() * (spec.speedRange[1] - spec.speedRange[0]);

    const canChangeLane =
      this.elapsedRunTime > 8 &&
      spec.kind !== 'rig' &&
      Math.random() < 0.22;

    this.traffic.push({
      id: this.nextId++,
      lane,
      x: LANE_CENTERS[lane],
      y,
      width: baseW * spec.wFactor,
      height: baseH * spec.hFactor,
      speed,
      kind: spec.kind,
      color: spec.color,
      accent: spec.accent,
      targetLane: lane,
      laneChangeTimer: canChangeLane ? 0.55 + Math.random() * 0.8 : 999,
      blinkerDir: 0,
      braking: false,
      grazed: false,
      passed: false,
      smashed: false,
      vx: 0,
      spin: 0,
      alpha: 1,
    });
  }

  private spawnPickup(): void {
    const lane = Math.floor(Math.random() * 4);
    const y = -80;
    // Pick type: nitro most common, chip common, shield when hull < max or occasional
    const roll = Math.random();
    let kind: PickupKind = 'nitro';
    if (roll < 0.18 && (!this.player.shieldActive || this.player.hull < this.player.maxHull)) {
      kind = 'shield';
    } else if (roll < 0.48) {
      kind = 'chip';
    }

    this.pickups.push({
      id: this.nextId++,
      lane,
      x: LANE_CENTERS[lane],
      y,
      kind,
      radius: Math.max(14, this.laneWidth * 0.16),
      pulse: Math.random() * Math.PI * 2,
      collected: false,
    });
  }

  private updateTraffic(dt: number, difficultyRamp: number): void {
    const px = this.roadXToPx(this.player.x);
    const py = this.player.y;
    const pw = this.player.width * 0.82;
    const ph = this.player.height * 0.84;

    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const car = this.traffic[i];

      if (car.smashed) {
        car.x += car.vx * dt;
        car.y += (this.speed * 0.55) * dt;
        car.spin += (car.vx >= 0 ? 1 : -1) * dt * 8.5;
        car.alpha -= dt * 1.4;
        if (car.alpha <= 0 || car.y > this.height + 200) {
          this.traffic.splice(i, 1);
        }
        continue;
      }

      // Relative vertical speed
      const relSpeed = this.speed - car.speed * (1 + difficultyRamp * 0.15);
      car.y += relSpeed * dt;

      // Occasional signaled lane change
      if (car.lane === car.targetLane && car.laneChangeTimer < 10) {
        car.laneChangeTimer -= dt;
        if (car.laneChangeTimer <= 0.75 && car.blinkerDir === 0) {
          const possibleDirs: Array<-1 | 1> = [];
          if (car.lane > 0) possibleDirs.push(-1);
          if (car.lane < 3) possibleDirs.push(1);
          const dir = possibleDirs[Math.floor(Math.random() * possibleDirs.length)];
          const candidateLane = car.lane + dir;
          const laneClear = !this.traffic.some(
            (other) =>
              other.id !== car.id &&
              (other.lane === candidateLane || other.targetLane === candidateLane) &&
              Math.abs(other.y - car.y) < car.height * 2.1
          );
          if (laneClear && car.y > 0 && car.y < this.player.y - 160) {
            car.blinkerDir = dir;
            car.targetLane = candidateLane;
          } else {
            car.laneChangeTimer = 999;
          }
        }
      }

      if (car.lane !== car.targetLane) {
        if (car.laneChangeTimer > 0) {
          car.laneChangeTimer -= dt;
        } else {
          const targetX = LANE_CENTERS[car.targetLane];
          const dx = targetX - car.x;
          car.x += dx * Math.min(1, dt * 6.5);
          if (Math.abs(dx) < 0.015) {
            car.x = targetX;
            car.lane = car.targetLane;
            car.blinkerDir = 0;
            car.laneChangeTimer = 999;
          }
        }
      }

      const cx = this.roadXToPx(car.x);
      const cy = car.y;
      const cw = car.width * 0.84;
      const ch = car.height * 0.86;

      // Collision AABB
      const dxPx = Math.abs(px - cx);
      const dyPx = Math.abs(py - cy);
      const collideX = (pw + cw) * 0.5;
      const collideY = (ph + ch) * 0.5;

      if (dxPx < collideX && dyPx < collideY) {
        if (this.player.isBoosting) {
          // NITRO SMASH!
          car.smashed = true;
          car.vx = px <= cx ? 2.4 : -2.4;
          this.player.nitro = Math.max(0, this.player.nitro - 12);
          this.score += 250 * this.combo;
          this.shakeIntensity = Math.max(this.shakeIntensity, 9);
          soundEngine.playSmash();
          this.spawnBurst((px + cx) * 0.5, (py + cy) * 0.5, '#00F0FF', 22, 340);
          this.spawnBurst((px + cx) * 0.5, (py + cy) * 0.5, '#FFB800', 12, 260);
          this.addFloatingText(cx, cy - 20, `SMASH! +${250 * this.combo}`, '#00F0FF', 1.15);
          continue;
        } else if (this.player.invulnTimer <= 0) {
          this.handlePlayerCrash(car, cx, cy);
          continue;
        }
      }

      // Near-miss detection (tight horizontal pass while overlapping vertically)
      const grazeX = collideX + this.player.width * 0.72;
      const grazeY = collideY + 12;
      if (!car.grazed && dxPx < grazeX && dyPx < grazeY && dxPx >= collideX * 0.92) {
        car.grazed = true;
        this.triggerNearMiss(cx, cy, px);
      }

      // Clean overtake
      if (!car.passed && cy - car.height * 0.5 > py + this.player.height * 0.5) {
        car.passed = true;
        this.overtakes++;
        this.score += 40 * this.combo;
      }

      if (car.y > this.height + 220 || car.y < -900) {
        this.traffic.splice(i, 1);
      }
    }
  }

  private triggerNearMiss(carX: number, carY: number, playerX: number): void {
    this.nearMisses++;
    this.combo = Math.min(8, this.combo + 1);
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    this.comboTimer = COMBO_DURATION;

    const bonus = 150 * this.combo;
    this.score += bonus;
    this.player.nitro = Math.min(100, this.player.nitro + 16);

    soundEngine.playNearMiss(this.combo);
    this.shakeIntensity = Math.max(this.shakeIntensity, 2.8);

    const midX = (carX + playerX) * 0.5;
    const midY = (carY + this.player.y) * 0.5;
    this.spawnBurst(midX, midY, '#00F0FF', 12, 220);
    this.spawnBurst(midX, midY, '#FFB800', 8, 180);
    this.addFloatingText(
      midX,
      midY - 38,
      `NEAR MISS! +${bonus}`,
      this.combo >= 4 ? '#FFB800' : '#00F0FF',
      1.05,
      this.combo > 1 ? `COMBO x${this.combo}` : undefined
    );
  }

  private handlePlayerCrash(car: TrafficCar, cx: number, cy: number): void {
    const px = this.roadXToPx(this.player.x);

    if (this.player.shieldActive) {
      // Shield absorbs hit cleanly!
      this.player.shieldActive = false;
      this.player.invulnTimer = 1.1;
      car.smashed = true;
      car.vx = px <= cx ? 2.1 : -2.1;
      soundEngine.playCrash(false);
      this.shakeIntensity = 10;
      this.flashColor = '#34D399';
      this.flashAlpha = 0.35;
      this.spawnBurst(px, this.player.y, '#34D399', 26, 320);
      this.addFloatingText(px, this.player.y - 40, 'SHIELD SAVED!', '#34D399', 1.15);
      return;
    }

    // Lose 1 Hull Pip
    this.player.hull = Math.max(0, this.player.hull - 1);
    this.player.invulnTimer = 1.5;
    this.combo = 1;
    this.comboTimer = 0;
    this.speed = Math.max(260, this.speed * 0.62);
    this.hitStopTimer = 0.045;
    this.shakeIntensity = this.player.hull === 0 ? 18 : 13;
    this.flashColor = '#FF2A6D';
    this.flashAlpha = this.player.hull === 0 ? 0.55 : 0.38;

    // Knock colliding car aside so player isn't trapped inside it
    car.smashed = true;
    car.vx = px <= cx ? 2.0 : -2.0;

    const hitX = (px + cx) * 0.5;
    const hitY = (this.player.y + cy) * 0.5;
    this.spawnBurst(hitX, hitY, '#FF2A6D', 26, 340);
    this.spawnBurst(hitX, hitY, '#FFB800', 18, 280);
    soundEngine.playCrash(this.player.hull === 0);

    if (this.player.hull <= 0) {
      this.pendingGameOver = true;
      this.gameOverDelay = 0.55;
      this.emitHud();
    } else {
      this.addFloatingText(px, this.player.y - 45, 'HULL HIT!', '#FF2A6D', 1.1);
    }
  }

  private updatePickups(dt: number): void {
    const px = this.roadXToPx(this.player.x);
    const py = this.player.y;

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.y += this.speed * 0.88 * dt;
      p.pulse += dt * 6;

      const cx = this.roadXToPx(p.x);
      const dist = Math.hypot(px - cx, py - p.y);
      if (dist < p.radius + this.player.width * 0.62) {
        soundEngine.playPickup(p.kind);
        if (p.kind === 'nitro') {
          this.player.nitro = Math.min(100, this.player.nitro + 38);
          this.score += 150;
          this.spawnBurst(cx, p.y, '#00F0FF', 16, 220);
          this.addFloatingText(cx, p.y - 18, '+38% NITRO', '#00F0FF', 1.0);
        } else if (p.kind === 'shield') {
          if (this.player.hull < this.player.maxHull) {
            this.player.hull++;
            this.addFloatingText(cx, p.y - 18, '+1 HULL REPAIR', '#34D399', 1.05);
          } else {
            this.player.shieldActive = true;
            this.addFloatingText(cx, p.y - 18, 'ENERGY SHIELD!', '#34D399', 1.05);
          }
          this.spawnBurst(cx, p.y, '#34D399', 18, 220);
        } else {
          const pts = 400 * this.combo;
          this.score += pts;
          this.spawnBurst(cx, p.y, '#FFB800', 16, 220);
          this.addFloatingText(cx, p.y - 18, `+${pts} TURBO CHIP`, '#FFB800', 1.05);
        }
        this.pickups.splice(i, 1);
        continue;
      }

      if (p.y > this.height + 80) {
        this.pickups.splice(i, 1);
      }
    }
  }

  private spawnParticle(opts: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    life: number;
    color: string;
    glow?: boolean;
    drag?: number;
    shape?: 'circle' | 'spark' | 'shard';
  }): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = opts.x;
        p.y = opts.y;
        p.vx = opts.vx;
        p.vy = opts.vy;
        p.size = opts.size;
        p.life = opts.life;
        p.maxLife = opts.life;
        p.color = opts.color;
        p.glow = opts.glow ?? false;
        p.drag = opts.drag ?? 0.95;
        p.shape = opts.shape ?? 'circle';
        p.rotation = Math.random() * Math.PI * 2;
        p.vRot = (Math.random() - 0.5) * 14;
        return;
      }
    }
  }

  private spawnBurst(x: number, y: number, color: string, count: number, maxSpeed: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = maxSpeed * (0.25 + Math.random() * 0.75);
      this.spawnParticle({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: 2.2 + Math.random() * 3.8,
        life: 0.25 + Math.random() * 0.35,
        color,
        glow: true,
        drag: 0.93,
        shape: Math.random() > 0.45 ? 'spark' : 'shard',
      });
    }
  }

  private updateParticles(dt: number): void {
    const dragFactor = Math.pow(0.08, dt);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag === 0.95 ? dragFactor * 0.98 + 0.02 : p.drag;
      p.vy *= p.drag === 0.95 ? dragFactor * 0.98 + 0.02 : p.drag;
      p.rotation += p.vRot * dt;
    }
  }

  private updateSkids(dt: number): void {
    const dy = this.speed * dt;
    for (let i = this.skids.length - 1; i >= 0; i--) {
      const s = this.skids[i];
      s.y1 += dy;
      s.y2 += dy;
      s.alpha -= dt * 0.55;
      if (s.alpha <= 0 || s.y1 > this.height + 60) {
        this.skids.splice(i, 1);
      }
    }
  }

  private addFloatingText(
    x: number,
    y: number,
    text: string,
    color: string,
    scale = 1,
    subtext?: string
  ): void {
    this.floatingTexts.push({
      x,
      y,
      vy: -68,
      text,
      subtext,
      color,
      life: 0.95,
      maxLife: 0.95,
      scale,
    });
  }

  private updateFloatingTexts(dt: number): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.vy *= 0.95;
      ft.life -= dt;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  // =========================================================================
  // RENDERING PIPELINE (60FPS CANVAS 2D)
  // =========================================================================

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(this.shakeX, this.shakeY);

    // 1. Night skyline backdrop
    ctx.fillStyle = '#090D16';
    ctx.fillRect(-20, -20, this.width + 40, this.height + 40);

    this.renderSideScenery(ctx);
    this.renderRoad(ctx);
    this.renderSkids(ctx);
    this.renderPickups(ctx);
    this.renderTraffic(ctx);
    this.renderPlayer(ctx);
    this.renderParticles(ctx);
    this.renderSpeedLines(ctx);
    this.renderFloatingTexts(ctx);

    // Impact flash overlay
    if (this.flashAlpha > 0) {
      ctx.fillStyle = this.flashColor;
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private renderSideScenery(ctx: CanvasRenderingContext2D): void {
    const roadRight = this.roadLeft + this.roadWidth;

    // Distant dark city silhouettes along margins
    for (const b of this.buildings) {
      const bx =
        b.side === -1
          ? this.roadLeft - 38 - b.w
          : roadRight + 38;
      if (bx + b.w < 0 || bx > this.width) continue;
      ctx.fillStyle = b.hue;
      ctx.fillRect(bx, b.y, b.w, b.h);
      // Subtle lit window strip
      ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
      ctx.fillRect(bx + 8, b.y + 12, b.w - 16, 4);
      ctx.fillStyle = 'rgba(255, 42, 109, 0.08)';
      ctx.fillRect(bx + 8, b.y + 28, b.w - 22, 4);
    }

    // Highway light poles & neon ground pools
    for (const light of this.roadLights) {
      const lx = light.side === -1 ? this.roadLeft - 14 : roadRight + 14;
      const glowX = light.side === -1 ? this.roadLeft + 14 : roadRight - 14;

      // Soft light cone onto shoulder
      const grad = ctx.createRadialGradient(glowX, light.y, 2, glowX, light.y, 75);
      grad.addColorStop(0, 'rgba(0, 240, 255, 0.14)');
      grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(glowX, light.y, 75, 0, Math.PI * 2);
      ctx.fill();

      // Pole fixture
      ctx.fillStyle = '#00F0FF';
      ctx.fillRect(lx - 2, light.y - 5, 4, 10);
    }
  }

  private renderRoad(ctx: CanvasRenderingContext2D): void {
    const roadRight = this.roadLeft + this.roadWidth;

    // Main asphalt bed
    const asphaltGrad = ctx.createLinearGradient(this.roadLeft, 0, roadRight, 0);
    asphaltGrad.addColorStop(0, '#131824');
    asphaltGrad.addColorStop(0.5, '#192030');
    asphaltGrad.addColorStop(1, '#131824');
    ctx.fillStyle = asphaltGrad;
    ctx.fillRect(this.roadLeft, -20, this.roadWidth, this.height + 40);

    // Subtle asphalt texture strips per lane
    ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
    ctx.fillRect(this.roadLeft + this.laneWidth, 0, this.laneWidth, this.height);
    ctx.fillRect(this.roadLeft + this.laneWidth * 3, 0, this.laneWidth, this.height);

    // Rumble strips / neon barriers on edges
    const stripSize = 36;
    const offset = this.worldScroll % (stripSize * 2);
    for (let y = -stripSize * 2 + offset; y < this.height + stripSize; y += stripSize * 2) {
      ctx.fillStyle = '#00F0FF';
      ctx.fillRect(this.roadLeft - 6, y, 6, stripSize);
      ctx.fillRect(roadRight, y, 6, stripSize);

      ctx.fillStyle = '#1E293B';
      ctx.fillRect(this.roadLeft - 6, y + stripSize, 6, stripSize);
      ctx.fillRect(roadRight, y + stripSize, 6, stripSize);
    }

    // Crisp inner shoulder lines
    ctx.fillStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.fillRect(this.roadLeft + 4, 0, 2, this.height);
    ctx.fillRect(roadRight - 6, 0, 2, this.height);

    // Center double yellow-amber divider
    const centerX = this.roadLeft + this.roadWidth * 0.5;
    ctx.fillStyle = 'rgba(255, 184, 0, 0.55)';
    ctx.fillRect(centerX - 3, 0, 2, this.height);
    ctx.fillRect(centerX + 1, 0, 2, this.height);

    // Dashed lane dividers (lanes 1|2 and 3|4)
    ctx.fillStyle = 'rgba(226, 232, 240, 0.42)';
    const dashLen = 42;
    const gapLen = 48;
    const step = dashLen + gapLen;
    for (let y = -step + this.roadStripeOffset; y < this.height + step; y += step) {
      ctx.fillRect(this.roadLeft + this.laneWidth - 1.5, y, 3, dashLen);
      ctx.fillRect(this.roadLeft + this.laneWidth * 3 - 1.5, y, 3, dashLen);
    }
  }

  private renderSkids(ctx: CanvasRenderingContext2D): void {
    for (const s of this.skids) {
      ctx.strokeStyle = `rgba(5, 7, 12, ${s.alpha})`;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
  }

  private renderPickups(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pickups) {
      const cx = this.roadXToPx(p.x);
      const scale = 1 + Math.sin(p.pulse) * 0.1;
      const r = p.radius * scale;

      const color =
        p.kind === 'nitro' ? '#00F0FF' : p.kind === 'shield' ? '#34D399' : '#FFB800';

      ctx.save();
      ctx.translate(cx, p.y);

      // Outer halo
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner glyph
      ctx.fillStyle = color;
      if (p.kind === 'nitro') {
        // Lightning bolt
        ctx.beginPath();
        ctx.moveTo(2, -r * 0.55);
        ctx.lineTo(-r * 0.35, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(-2, r * 0.55);
        ctx.lineTo(r * 0.35, -1);
        ctx.lineTo(0, -1);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'shield') {
        // Shield badge
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.5);
        ctx.lineTo(r * 0.42, -r * 0.25);
        ctx.lineTo(r * 0.34, r * 0.25);
        ctx.lineTo(0, r * 0.52);
        ctx.lineTo(-r * 0.34, r * 0.25);
        ctx.lineTo(-r * 0.42, -r * 0.25);
        ctx.closePath();
        ctx.fill();
      } else {
        // Diamond chip
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.52);
        ctx.lineTo(r * 0.48, 0);
        ctx.lineTo(0, r * 0.52);
        ctx.lineTo(-r * 0.48, 0);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private renderTraffic(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    for (const car of this.traffic) {
      const cx = this.roadXToPx(car.x);
      ctx.save();
      ctx.translate(cx, car.y);
      ctx.rotate(car.spin);
      ctx.globalAlpha = car.alpha;

      const w = car.width;
      const h = car.height;

      // Subtle shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      this.roundRect(ctx, -w * 0.5 + 3, -h * 0.5 + 5, w, h, 8);
      ctx.fill();

      // Headlight beam ahead (upward since traffic drives away/forward)
      const beamGrad = ctx.createLinearGradient(0, -h * 0.5, 0, -h * 0.5 - 65);
      beamGrad.addColorStop(0, 'rgba(255, 250, 220, 0.16)');
      beamGrad.addColorStop(1, 'rgba(255, 250, 220, 0)');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(-w * 0.38, -h * 0.5);
      ctx.lineTo(-w * 0.65, -h * 0.5 - 65);
      ctx.lineTo(w * 0.65, -h * 0.5 - 65);
      ctx.lineTo(w * 0.38, -h * 0.5);
      ctx.closePath();
      ctx.fill();

      if (car.kind === 'rig') {
        this.drawRig(ctx, w, h, car.color, car.accent);
      } else {
        this.drawSportCar(ctx, w, h, car.color, car.accent, car.kind === 'taxi');
      }

      // Taillights
      ctx.fillStyle = '#FF2A6D';
      ctx.fillRect(-w * 0.42, h * 0.44, w * 0.24, 4);
      ctx.fillRect(w * 0.18, h * 0.44, w * 0.24, 4);

      // Blinking turn signal if shifting lanes
      if (car.blinkerDir !== 0 && Math.floor(now / 130) % 2 === 0) {
        ctx.fillStyle = '#FFB800';
        const bx = car.blinkerDir === -1 ? -w * 0.52 : w * 0.42;
        ctx.fillRect(bx, h * 0.32, w * 0.12, 8);
        ctx.fillRect(bx, -h * 0.4, w * 0.12, 8);
      }

      ctx.restore();
    }
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.player;
    // Blink during invulnerability
    if (p.invulnTimer > 0 && Math.floor(p.invulnTimer * 18) % 2 === 0) {
      return;
    }

    const px = this.roadXToPx(p.x);
    const w = p.width;
    const h = p.height;

    ctx.save();
    ctx.translate(px, p.y);
    ctx.rotate(p.angle);

    // Neon cyan underglow
    const glowGrad = ctx.createRadialGradient(0, 0, w * 0.2, 0, 0, h * 0.72);
    glowGrad.addColorStop(
      0,
      p.isBoosting ? 'rgba(0, 240, 255, 0.42)' : 'rgba(0, 240, 255, 0.22)'
    );
    glowGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.95, h * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();

    // High-beam headlights illuminating road ahead
    const headGrad = ctx.createLinearGradient(0, -h * 0.45, 0, -h * 0.45 - 155);
    headGrad.addColorStop(0, 'rgba(186, 246, 255, 0.32)');
    headGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.moveTo(-w * 0.36, -h * 0.46);
    ctx.lineTo(-w * 1.15, -h * 0.46 - 155);
    ctx.lineTo(w * 1.15, -h * 0.46 - 155);
    ctx.lineTo(w * 0.36, -h * 0.46);
    ctx.closePath();
    ctx.fill();

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    this.roundRect(ctx, -w * 0.5 + 3, -h * 0.5 + 6, w, h, 9);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#090D16';
    ctx.fillRect(-w * 0.55, -h * 0.34, 4, h * 0.22);
    ctx.fillRect(w * 0.55 - 4, -h * 0.34, 4, h * 0.22);
    ctx.fillRect(-w * 0.55, h * 0.14, 4, h * 0.22);
    ctx.fillRect(w * 0.55 - 4, h * 0.14, 4, h * 0.22);

    // Main supercar chassis
    const bodyGrad = ctx.createLinearGradient(-w * 0.5, 0, w * 0.5, 0);
    bodyGrad.addColorStop(0, '#0891B2');
    bodyGrad.addColorStop(0.5, '#00F0FF');
    bodyGrad.addColorStop(1, '#0891B2');
    ctx.fillStyle = bodyGrad;
    this.roundRect(ctx, -w * 0.5, -h * 0.5, w, h, 9);
    ctx.fill();

    // Racing center stripe
    ctx.fillStyle = '#E0F2FE';
    ctx.fillRect(-w * 0.11, -h * 0.48, w * 0.22, h * 0.96);

    // Cockpit windshield + roof
    ctx.fillStyle = '#0B0E17';
    this.roundRect(ctx, -w * 0.36, -h * 0.22, w * 0.72, h * 0.44, 6);
    ctx.fill();

    // Windshield specular reflection
    ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h * 0.18);
    ctx.lineTo(w * 0.3, -h * 0.18);
    ctx.lineTo(w * 0.24, -h * 0.04);
    ctx.lineTo(-w * 0.24, -h * 0.04);
    ctx.closePath();
    ctx.fill();

    // Rear spoiler wing
    ctx.fillStyle = '#0F172A';
    this.roundRect(ctx, -w * 0.53, h * 0.36, w * 1.06, h * 0.1, 3);
    ctx.fill();
    ctx.fillStyle = '#00F0FF';
    ctx.fillRect(-w * 0.5, h * 0.39, w, 2);

    // Headlight tips
    ctx.fillStyle = '#E0F2FE';
    ctx.fillRect(-w * 0.4, -h * 0.49, w * 0.2, 4);
    ctx.fillRect(w * 0.2, -h * 0.49, w * 0.2, 4);

    // Glowing brake/tail light bar
    ctx.fillStyle = this.input.down ? '#FF0044' : '#FF2A6D';
    ctx.fillRect(-w * 0.4, h * 0.46, w * 0.8, 3.5);

    // Active energy shield ring
    if (p.shieldActive || p.isBoosting) {
      ctx.strokeStyle = p.isBoosting ? '#00F0FF' : '#34D399';
      ctx.lineWidth = p.isBoosting ? 2.5 : 2;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.76, h * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private drawSportCar(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    color: string,
    accent: string,
    isTaxi: boolean
  ): void {
    // Wheels
    ctx.fillStyle = '#090D16';
    ctx.fillRect(-w * 0.54, -h * 0.32, 4, h * 0.2);
    ctx.fillRect(w * 0.54 - 4, -h * 0.32, 4, h * 0.2);
    ctx.fillRect(-w * 0.54, h * 0.14, 4, h * 0.2);
    ctx.fillRect(w * 0.54 - 4, h * 0.14, 4, h * 0.2);

    // Body
    ctx.fillStyle = color;
    this.roundRect(ctx, -w * 0.5, -h * 0.5, w, h, 8);
    ctx.fill();

    // Hood accent
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.32;
    ctx.fillRect(-w * 0.15, -h * 0.46, w * 0.3, h * 0.26);
    ctx.globalAlpha = 1;

    // Cabin glass
    ctx.fillStyle = '#0F172A';
    this.roundRect(ctx, -w * 0.36, -h * 0.2, w * 0.72, h * 0.42, 5);
    ctx.fill();

    // Windshield highlight
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-w * 0.28, -h * 0.16, w * 0.56, h * 0.1);

    if (isTaxi) {
      ctx.fillStyle = '#FEF08A';
      this.roundRect(ctx, -w * 0.2, -h * 0.04, w * 0.4, h * 0.1, 2);
      ctx.fill();
    }
  }

  private drawRig(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    color: string,
    accent: string
  ): void {
    // Trailer
    ctx.fillStyle = '#334155';
    this.roundRect(ctx, -w * 0.5, -h * 0.26, w, h * 0.76, 5);
    ctx.fill();

    // Hazard stripe on trailer
    ctx.fillStyle = accent;
    ctx.fillRect(-w * 0.42, h * 0.35, w * 0.84, 6);

    // Cab
    ctx.fillStyle = color;
    this.roundRect(ctx, -w * 0.46, -h * 0.5, w * 0.92, h * 0.24, 6);
    ctx.fill();

    // Cab windshield
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-w * 0.36, -h * 0.44, w * 0.72, h * 0.09);
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      const ratio = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, ratio);
      ctx.fillStyle = p.color;

      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * ratio + 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'spark') {
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-p.size * 1.4, -1, p.size * 2.8, 2);
      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillRect(-p.size * 0.7, -p.size * 0.7, p.size * 1.4, p.size * 1.4);
      }
      ctx.restore();
    }
  }

  private renderSpeedLines(ctx: CanvasRenderingContext2D): void {
    const speedRatio = Math.max(0, (this.speed - 520) / 420);
    if (speedRatio <= 0.05 && !this.player.isBoosting) return;

    const intensity = this.player.isBoosting ? Math.max(0.6, speedRatio) : speedRatio * 0.65;
    const count = Math.floor(14 * intensity);
    ctx.save();
    ctx.strokeStyle = this.player.isBoosting
      ? 'rgba(0, 240, 255, 0.35)'
      : 'rgba(226, 232, 240, 0.2)';
    ctx.lineWidth = this.player.isBoosting ? 2 : 1.5;

    const t = performance.now() * 0.015;
    for (let i = 0; i < count; i++) {
      const isLeft = i % 2 === 0;
      const edgeX = isLeft
        ? Math.random() * (this.roadLeft + 45)
        : this.roadLeft + this.roadWidth - 45 + Math.random() * (this.width - (this.roadLeft + this.roadWidth) + 45);
      const y = ((i * 137 + t * 55) % (this.height + 120)) - 60;
      const len = 40 + intensity * 85;
      ctx.beginPath();
      ctx.moveTo(edgeX, y);
      ctx.lineTo(edgeX, y + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
    for (const ft of this.floatingTexts) {
      const ratio = ft.life / ft.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.min(1, ratio * 1.4);
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(16 * ft.scale)}px "Chakra Petch", sans-serif`;
      ctx.fillStyle = '#090D16';
      ctx.fillText(ft.text, ft.x + 1.5, ft.y + 1.5);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);

      if (ft.subtext) {
        ctx.font = `700 12px "Chakra Petch", sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ft.subtext, ft.x, ft.y + 16);
      }
      ctx.restore();
    }
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
