import React from 'react';
import { Trophy } from 'lucide-react';
import { HighScoreEntry } from '../types';

interface HighScoreTableProps {
  entries: HighScoreEntry[];
  highlightId?: string | null;
  maxRows?: number;
}

export const HighScoreTable: React.FC<HighScoreTableProps> = ({
  entries,
  highlightId,
  maxRows = 5,
}) => {
  const visible = entries.slice(0, maxRows);

  return (
    <div className="w-full rounded-xl border border-cyan-500/20 bg-slate-950/75 p-3 backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between border-b border-slate-800/80 pb-1.5">
        <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-cyan-300 uppercase">
          <Trophy className="h-3.5 w-3.5 text-amber-400" />
          <span>Local Leaderboard</span>
        </div>
        <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          Top {visible.length}
        </span>
      </div>

      <div className="space-y-1">
        {visible.map((entry, idx) => {
          const isHighlighted = highlightId && entry.id === highlightId;
          const rankColor =
            idx === 0
              ? 'text-amber-400'
              : idx === 1
                ? 'text-slate-200'
                : idx === 2
                  ? 'text-orange-400'
                  : 'text-slate-500';

          return (
            <div
              key={entry.id}
              className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                isHighlighted
                  ? 'border border-cyan-400/50 bg-cyan-500/15 text-white'
                  : 'bg-slate-900/55 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`font-mono-num w-4 font-bold ${rankColor}`}>
                  {idx + 1}.
                </span>
                <span className="font-bold tracking-wider text-slate-100">
                  {entry.name}
                </span>
                {entry.isPlayer && (
                  <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                    YOU
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="hidden text-[11px] text-slate-400 sm:inline">
                  {entry.maxSpeedKmh} km/h
                </span>
                <span className="font-mono-num font-bold text-cyan-300">
                  {entry.score.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
