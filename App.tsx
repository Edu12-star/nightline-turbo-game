import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Flame,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { HighScoreTable } from './HighScoreTable';
import { soundEngine } from './audio';
import { RaceEngine } from './engine';
import {
  getBestScore,
  isQualifyingHighScore,
  loadDriverName,
  loadHighScores,
  loadMuted,
  saveDriverName,
  saveHighScore,
  saveMuted,
} from './storage';
import { GameStatus, HighScoreEntry, HudSnapshot } from './types';

const INITIAL_HUD: HudSnapshot = {
  score: 0,
  speedKmh: 148,
  combo: 1,
  comboTimer: 0,
  hull: 3,
  maxHull: 3,
  nitro: 55,
  isBoosting: false,
  shieldActive: false,
  nearMisses: 0,
  overtakes: 0,
  distanceKm: 0,
  maxSpeedKmh: 148,
  bestCombo: 1,
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<RaceEngine | null>(null);

  const [status, setStatus] = useState<GameStatus>('start');
  const statusRef = useRef<GameStatus>('start');
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [muted, setMuted] = useState<boolean>(() => {
    const m = loadMuted();
    soundEngine.setMuted(m);
    return m;
  });

  const [highScores, setHighScores] = useState<HighScoreEntry[]>(() => loadHighScores());
  const [bestScore, setBestScore] = useState<number>(() => getBestScore());
  const [driverName, setDriverName] = useState<string>(() => loadDriverName());
  const [scoreSaved, setScoreSaved] = useState<boolean>(false);
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);
  const [isNewRecord, setIsNewRecord] = useState<boolean>(false);
  const [qualifies, setQualifies] = useState<boolean>(false);
  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(false);

  // Track active steering touch separately from boost button
  const touchSteerRef = useRef<{
    id: number | null;
    startX: number;
    startRoadX: number;
    isDragging: boolean;
  }>({
    id: null,
    startX: 0,
    startRoadX: 0,
    isDragging: false,
  });

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const coarse =
      typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    setIsTouchDevice(coarse);
  }, []);

  const handleGameOver = useCallback((finalHud: HudSnapshot) => {
    setHud(finalHud);
    setStatus('gameover');
    statusRef.current = 'gameover';
    setScoreSaved(false);
    setSavedEntryId(null);

    const prevBest = getBestScore();
    setIsNewRecord(finalHud.score > prevBest && finalHud.score > 0);
    setQualifies(isQualifyingHighScore(finalHud.score));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new RaceEngine(
      canvas,
      (snapshot) => setHud(snapshot),
      handleGameOver
    );
    engineRef.current = engine;
    engine.startLoop();

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      engine.destroy();
      engineRef.current = null;
    };
  }, [handleGameOver]);

  const commitScoreIfPending = useCallback(() => {
    if (statusRef.current === 'gameover' && qualifies && !scoreSaved && hud.score > 0) {
      const cleanName = (driverName.trim().toUpperCase() || 'YOU').slice(0, 8);
      saveDriverName(cleanName);
      const updated = saveHighScore({
        name: cleanName,
        score: hud.score,
        nearMisses: hud.nearMisses,
        maxSpeedKmh: hud.maxSpeedKmh,
      });
      setHighScores(updated);
      setBestScore(updated[0]?.score ?? 0);
      setScoreSaved(true);
    }
  }, [driverName, hud.maxSpeedKmh, hud.nearMisses, hud.score, qualifies, scoreSaved]);

  const startRace = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    commitScoreIfPending();
    soundEngine.unlock();
    setScoreSaved(false);
    setSavedEntryId(null);
    setIsNewRecord(false);
    setStatus('playing');
    statusRef.current = 'playing';
    engine.startNewRun();
  }, [commitScoreIfPending]);

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (statusRef.current === 'playing') {
      setStatus('paused');
      statusRef.current = 'paused';
      engine.setStatus('paused');
    } else if (statusRef.current === 'paused') {
      setStatus('playing');
      statusRef.current = 'playing';
      engine.setStatus('playing');
    }
  }, []);

  const quitToMenu = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    commitScoreIfPending();
    setStatus('start');
    statusRef.current = 'start';
    engine.setStatus('start');
  }, [commitScoreIfPending]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundEngine.setMuted(next);
      saveMuted(next);
      return next;
    });
  }, []);

  const handleSaveScore = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (scoreSaved || hud.score <= 0) return;

      const cleanName = (driverName.trim().toUpperCase() || 'YOU').slice(0, 8);
      saveDriverName(cleanName);
      const updated = saveHighScore({
        name: cleanName,
        score: hud.score,
        nearMisses: hud.nearMisses,
        maxSpeedKmh: hud.maxSpeedKmh,
      });
      setHighScores(updated);
      setBestScore(updated[0]?.score ?? 0);
      const newest = updated.find(
        (item) => item.isPlayer && item.score === hud.score && item.name === cleanName
      );
      setSavedEntryId(newest?.id ?? null);
      setScoreSaved(true);
    },
    [driverName, hud.maxSpeedKmh, hud.nearMisses, hud.score, scoreSaved]
  );

  // Keyboard controls
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }

      const engine = engineRef.current;
      if (!engine) return;

      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        engine.setInput({ left: true, touchTargetX: null });
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        engine.setInput({ right: true, touchTargetX: null });
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        engine.setInput({ up: true, boost: true });
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        engine.setInput({ down: true });
      } else if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        e.preventDefault();
        if (statusRef.current === 'start') {
          startRace();
        } else if (statusRef.current === 'gameover') {
          startRace();
        } else if (statusRef.current === 'playing') {
          engine.setInput({ boost: true });
        }
      } else if (e.code === 'Enter') {
        if (statusRef.current === 'start' || statusRef.current === 'gameover') {
          e.preventDefault();
          startRace();
        } else if (statusRef.current === 'paused') {
          e.preventDefault();
          togglePause();
        }
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        if (statusRef.current === 'playing' || statusRef.current === 'paused') {
          e.preventDefault();
          togglePause();
        }
      } else if (e.code === 'KeyR') {
        if (statusRef.current === 'playing' || statusRef.current === 'paused' || statusRef.current === 'gameover') {
          e.preventDefault();
          startRace();
        }
      } else if (e.code === 'KeyM') {
        toggleMute();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine) return;

      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        engine.setInput({ left: false });
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        engine.setInput({ right: false });
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        engine.setInput({ up: false, boost: false });
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        engine.setInput({ down: false });
      } else if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        engine.setInput({ boost: false });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startRace, toggleMute, togglePause]);

  // Multi-touch steering on canvas (supports both relative drag & left/right hold zones)
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (statusRef.current !== 'playing') return;
    setIsTouchDevice(true);
    soundEngine.unlock();

    const engine = engineRef.current;
    if (!engine) return;

    if (touchSteerRef.current.id === null && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = t.clientX - rect.left;

      touchSteerRef.current = {
        id: t.identifier,
        startX: t.clientX,
        startRoadX: engine.getPlayerX(),
        isDragging: false,
      };

      // Initial tap-hold direction if user holds left or right side without dragging
      const dir = relX < rect.width * 0.5 ? -1 : 1;
      engine.setInput({ touchSteerDir: dir, touchTargetX: null });
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (statusRef.current !== 'playing') return;
    const engine = engineRef.current;
    if (!engine || touchSteerRef.current.id === null) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === touchSteerRef.current.id) {
        const dx = t.clientX - touchSteerRef.current.startX;
        if (Math.abs(dx) > 6) {
          touchSteerRef.current.isDragging = true;
        }
        if (touchSteerRef.current.isDragging) {
          const { roadWidth } = engine.getRoadMetrics();
          const normDelta = (dx / (roadWidth * 0.5)) * 1.15;
          const clamped = Math.max(
            -0.88,
            Math.min(0.88, touchSteerRef.current.startRoadX + normDelta)
          );
          engine.setInput({ touchTargetX: clamped, touchSteerDir: 0 });
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === touchSteerRef.current.id) {
        touchSteerRef.current.id = null;
        touchSteerRef.current.isDragging = false;
        engine.setInput({ touchTargetX: null, touchSteerDir: 0 });
      }
    }
  };

  const setBoostHeld = (held: boolean) => {
    soundEngine.unlock();
    engineRef.current?.setInput({ boost: held });
  };

  const setBrakeHeld = (held: boolean) => {
    engineRef.current?.setInput({ down: held });
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0B0E17] select-none">
      {/* 60FPS Game Canvas */}
      <canvas
        ref={canvasRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className="touch-canvas block h-full w-full"
      />

      {/* Active Gameplay HUD */}
      {(status === 'playing' || status === 'paused') && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-5">
          {/* Top HUD Bar */}
          <div className="flex items-start justify-between gap-2">
            {/* Score + Speed + Combo */}
            <div className="flex flex-col gap-1.5">
              <div className="rounded-xl border border-cyan-500/25 bg-slate-950/75 px-3.5 py-2 backdrop-blur-md">
                <div className="flex items-baseline gap-3">
                  <div>
                    <div className="text-[10px] font-bold tracking-widest text-cyan-400/80 uppercase">
                      Score
                    </div>
                    <div className="font-mono-num text-xl leading-none font-extrabold text-white sm:text-2xl">
                      {hud.score.toLocaleString()}
                    </div>
                  </div>

                  <div className="h-7 w-px bg-slate-800" />

                  <div>
                    <div className="flex items-center gap-1 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                      <Gauge className="h-3 w-3 text-cyan-400" />
                      Speed
                    </div>
                    <div className="font-mono-num text-base leading-none font-bold text-cyan-300 sm:text-lg">
                      {hud.speedKmh}
                      <span className="ml-1 text-[10px] font-semibold text-slate-400">
                        KM/H
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Combo Multiplier Pill */}
              {hud.combo > 1 && (
                <div
                  key={hud.combo}
                  className="combo-pop w-fit rounded-lg border border-amber-400/50 bg-amber-500/15 px-3 py-1 backdrop-blur-md"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm tracking-wider text-amber-300">
                      COMBO x{hud.combo}
                    </span>
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 to-rose-500 transition-[width] duration-75"
                        style={{ width: `${Math.round(hud.comboTimer * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Hull + Nitro + Action Buttons */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                {/* Hull + Nitro cluster */}
                <div className="rounded-xl border border-slate-700/70 bg-slate-950/75 px-3 py-2 backdrop-blur-md">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                      Hull
                    </span>
                    <div className="flex items-center gap-1">
                      {hud.shieldActive && (
                        <Shield className="mr-0.5 h-3.5 w-3.5 text-emerald-400" />
                      )}
                      {Array.from({ length: hud.maxHull }).map((_, idx) => (
                        <span
                          key={idx}
                          className={`h-2.5 w-4 rounded-sm transition-all ${
                            idx < hud.hull
                              ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.75)]'
                              : 'bg-slate-800'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Nitro Bar */}
                  <div className="flex items-center gap-2">
                    <Zap
                      className={`h-3.5 w-3.5 ${
                        hud.isBoosting
                          ? 'animate-pulse text-amber-300'
                          : hud.nitro >= 15
                            ? 'text-cyan-400'
                            : 'text-slate-500'
                      }`}
                    />
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800 sm:w-28">
                      <div
                        className={`h-full transition-[width] duration-75 ${
                          hud.isBoosting
                            ? 'bg-gradient-to-r from-cyan-300 via-white to-amber-300'
                            : 'bg-gradient-to-r from-cyan-500 to-sky-300'
                        }`}
                        style={{ width: `${hud.nitro}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Sound & Pause Buttons */}
                <div className="pointer-events-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/80 text-slate-200 backdrop-blur-md transition hover:border-cyan-400/60 hover:text-cyan-300 active:scale-95"
                  >
                    {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={togglePause}
                    aria-label="Pause game"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/80 text-slate-200 backdrop-blur-md transition hover:border-cyan-400/60 hover:text-cyan-300 active:scale-95"
                  >
                    <Pause className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Controls: Touch Buttons on mobile / subtle hint on desktop */}
          <div className="flex items-end justify-between">
            {isTouchDevice ? (
              <>
                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    setBrakeHeld(true);
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    setBrakeHeld(false);
                  }}
                  onTouchCancel={() => setBrakeHeld(false)}
                  className="pointer-events-auto flex h-14 w-20 items-center justify-center rounded-2xl border border-rose-500/35 bg-slate-950/70 text-xs font-bold tracking-wider text-rose-300 uppercase backdrop-blur-md active:scale-95 active:bg-rose-500/25"
                >
                  Brake
                </button>

                <button
                  type="button"
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    setBoostHeld(true);
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    setBoostHeld(false);
                  }}
                  onTouchCancel={() => setBoostHeld(false)}
                  className={`pointer-events-auto flex h-16 w-24 flex-col items-center justify-center rounded-2xl border text-xs font-bold tracking-wider uppercase backdrop-blur-md transition active:scale-95 ${
                    hud.isBoosting
                      ? 'border-amber-300 bg-cyan-500/40 text-white shadow-[0_0_24px_rgba(0,240,255,0.65)]'
                      : hud.nitro >= 12
                        ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                        : 'border-slate-700/60 bg-slate-950/60 text-slate-500'
                  }`}
                >
                  <Flame className="mb-0.5 h-5 w-5" />
                  Nitro
                </button>
              </>
            ) : (
              <div className="mx-auto rounded-full border border-slate-800/80 bg-slate-950/60 px-4 py-1 text-[11px] font-medium tracking-wider text-slate-400 backdrop-blur-sm">
                <span className="text-cyan-300">A / D</span> or{' '}
                <span className="text-cyan-300">◀ ▶</span> Steer &nbsp;•&nbsp;{' '}
                <span className="text-amber-300">SPACE</span> Nitro Overdrive &nbsp;•&nbsp;{' '}
                <span className="text-slate-200">P</span> Pause
              </div>
            )}
          </div>
        </div>
      )}

      {/* START SCREEN OVERLAY */}
      {status === 'start' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#0B0E17]/70 via-[#0B0E17]/55 to-[#0B0E17]/85 p-4 backdrop-blur-[2px]">
          <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-cyan-500/25 bg-slate-950/85 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
            {/* Top Utility Row */}
            <div className="flex w-full items-center justify-between">
              <div className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-0.5 text-[11px] font-bold tracking-widest text-cyan-300 uppercase">
                High-Speed Arcade
              </div>
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/80 text-slate-300 transition hover:border-cyan-400/60 hover:text-cyan-300"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>

            {/* Game Title */}
            <div className="text-center">
              <h1 className="font-display bg-gradient-to-r from-cyan-300 via-white to-amber-300 bg-clip-text text-4xl tracking-wider text-transparent uppercase drop-shadow-[0_2px_16px_rgba(0,240,255,0.35)] sm:text-5xl">
                Nightline
                <span className="block text-3xl text-cyan-400 sm:text-4xl">Turbo</span>
              </h1>
              <p className="mt-1.5 text-xs font-medium tracking-wide text-slate-300 sm:text-sm">
                Graze traffic for <span className="font-bold text-amber-300">Near-Miss Combos</span>.
                Ignite <span className="font-bold text-cyan-300">Nitro</span> to smash through.
              </p>
            </div>

            {/* Best Score Pill */}
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/75 px-3.5 py-1.5 text-xs">
              <span className="font-semibold tracking-wider text-slate-400 uppercase">
                Track Record:
              </span>
              <span className="font-mono-num font-extrabold text-amber-300">
                {bestScore.toLocaleString()}
              </span>
            </div>

            {/* Primary CTA */}
            <button
              type="button"
              onClick={startRace}
              className="neon-cta font-display flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-6 py-3.5 text-lg tracking-wider text-slate-950 uppercase transition hover:brightness-110 active:scale-[0.98]"
            >
              <Play className="h-5 w-5 fill-slate-950" />
              Race Now
            </button>

            {/* Compact Control Guide */}
            <div className="grid w-full grid-cols-2 gap-2 text-[11px] text-slate-300">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2">
                <div className="font-bold tracking-wider text-cyan-300 uppercase">Keyboard</div>
                <div className="mt-0.5 text-slate-400">
                  A/D or ◀ ▶ Steer • Space Nitro
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2">
                <div className="font-bold tracking-wider text-amber-300 uppercase">Touch</div>
                <div className="mt-0.5 text-slate-400">
                  Drag or Hold Sides • Nitro Btn
                </div>
              </div>
            </div>

            {/* High-Score Table */}
            <HighScoreTable entries={highScores} maxRows={5} />
          </div>
        </div>
      )}

      {/* PAUSE MODAL */}
      {status === 'paused' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md">
          <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-cyan-500/30 bg-slate-950/90 p-6 shadow-2xl">
            <h2 className="font-display text-2xl tracking-widest text-white uppercase">
              Paused
            </h2>
            <p className="font-mono-num text-sm text-cyan-300">
              Current Score: {hud.score.toLocaleString()}
            </p>

            <button
              type="button"
              onClick={togglePause}
              className="font-display mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm tracking-wider text-slate-950 uppercase transition hover:bg-cyan-300 active:scale-95"
            >
              <Play className="h-4 w-4 fill-slate-950" />
              Resume (P)
            </button>

            <button
              type="button"
              onClick={startRace}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-bold tracking-wider text-slate-200 uppercase transition hover:border-cyan-400/50 hover:text-cyan-300 active:scale-95"
            >
              <RotateCcw className="h-4 w-4" />
              Restart (R)
            </button>

            <button
              type="button"
              onClick={toggleMute}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs font-bold tracking-wider text-slate-300 uppercase transition hover:text-white"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              Sound: {muted ? 'Off' : 'On'}
            </button>

            <button
              type="button"
              onClick={quitToMenu}
              className="mt-1 text-xs font-semibold tracking-wider text-slate-400 uppercase transition hover:text-slate-200"
            >
              Back to Main Menu
            </button>
          </div>
        </div>
      )}

      {/* GAME OVER MODAL */}
      {status === 'gameover' && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-md">
          <div className="flex w-full max-w-md flex-col items-center gap-3.5 rounded-2xl border border-rose-500/35 bg-slate-950/90 p-5 shadow-2xl sm:p-6">
            {isNewRecord ? (
              <div className="rounded-full border border-amber-400/60 bg-amber-400/20 px-3.5 py-1 text-xs font-extrabold tracking-widest text-amber-300 uppercase">
                New Track Record!
              </div>
            ) : (
              <div className="rounded-full border border-rose-500/40 bg-rose-500/15 px-3.5 py-1 text-xs font-bold tracking-widest text-rose-300 uppercase">
                Run Complete
              </div>
            )}

            <div className="text-center">
              <div className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                Final Score
              </div>
              <div className="font-mono-num mt-0.5 text-4xl font-extrabold text-white sm:text-5xl">
                {hud.score.toLocaleString()}
              </div>
            </div>

            {/* Run Telemetry Stats */}
            <div className="grid w-full grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 text-center">
                <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Top Speed
                </div>
                <div className="font-mono-num mt-0.5 text-sm font-bold text-cyan-300">
                  {hud.maxSpeedKmh} <span className="text-[10px]">km/h</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 text-center">
                <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Near Miss
                </div>
                <div className="font-mono-num mt-0.5 text-sm font-bold text-amber-300">
                  {hud.nearMisses}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 text-center">
                <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  Max Combo
                </div>
                <div className="font-mono-num mt-0.5 text-sm font-bold text-rose-400">
                  x{hud.bestCombo}
                </div>
              </div>
            </div>

            {/* Save High Score Form (if qualifying) */}
            {qualifies && !scoreSaved && (
              <form
                onSubmit={handleSaveScore}
                className="flex w-full items-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-2"
              >
                <input
                  type="text"
                  maxLength={8}
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value.toUpperCase())}
                  placeholder="INITIALS"
                  aria-label="Driver name"
                  className="font-mono-num w-full rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-2 text-sm font-bold tracking-widest text-white uppercase outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-extrabold tracking-wider text-slate-950 uppercase transition hover:bg-amber-300 active:scale-95"
                >
                  Save Rank
                </button>
              </form>
            )}

            {/* Instant Restart CTA */}
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={startRace}
                className="neon-cta font-display flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-5 py-3.5 text-base tracking-wider text-slate-950 uppercase transition hover:brightness-110 active:scale-[0.98]"
              >
                <RotateCcw className="h-4 w-4 stroke-[2.5]" />
                Race Again
              </button>
              <button
                type="button"
                onClick={quitToMenu}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-bold tracking-wider text-slate-300 uppercase transition hover:border-slate-500 hover:text-white active:scale-95"
              >
                Menu
              </button>
            </div>

            <HighScoreTable
              entries={highScores}
              highlightId={savedEntryId}
              maxRows={5}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
