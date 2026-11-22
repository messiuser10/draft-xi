/** Simulation Lab (spec section 11, item 6): run a season or a Monte Carlo for any teams, and a one-click Test Draft. */
import type { AdminClubView, LabResultView } from '@draft-xi/server/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { Loading, Section, send, useAdminMutation, useAdminQuery } from './shared';

const PARAMS = [
  ['baseGoals', 'Base goals', 0.01],
  ['homeAdvantage', 'Home advantage', 0.01],
  ['sensitivity', 'Sensitivity', 0.01],
  ['chaos', 'Chaos', 0.05],
  ['aiSpread', 'AI spread', 0.05],
  ['aiCatchUp', 'AI catch-up', 0.05],
  ['form', 'Season form', 0.25],
] as const;

export function AdminLabPage() {
  const clubs = useAdminQuery<{ clubs: AdminClubView[] }>(['clubs'], '/api/admin/clubs');
  const [source, setSource] = useState<'clubs' | 'game'>('clubs');
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const [gameCode, setGameCode] = useState('');
  const [seed, setSeed] = useState('');
  const [mode, setMode] = useState<'season' | 'montecarlo'>('season');
  const [runs, setRuns] = useState(1000);
  const [params, setParams] = useState<Record<string, number>>({});
  const [result, setResult] = useState<LabResultView | null>(null);
  const [testTeams, setTestTeams] = useState(4);
  const [testCode, setTestCode] = useState<string | null>(null);
  const pool = clubs.data?.clubs.filter((c) => c.inPool) ?? [];
  const chosen = picked ?? new Set(pool.slice(0, 20).map((c) => c.id));

  const run = useAdminMutation(() =>
    send<LabResultView>('/api/admin/lab/run', 'POST', {
      source: source === 'game' ? { gameCode: gameCode.trim().toUpperCase() } : { clubIds: [...chosen] },
      mode,
      runs,
      ...(seed ? { seed: Number(seed) } : {}),
      params,
    }),
  );
  const testDraft = useAdminMutation(() => send<{ code: string }>('/api/admin/lab/test-draft', 'POST', { teams: testTeams, level: 'medium' }), 'Test Draft finished and simulated');

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <Section title="Simulation Lab">
          <div className="flex flex-wrap gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={source === 'clubs'} onChange={() => setSource('clubs')} /> Pick clubs
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={source === 'game'} onChange={() => setSource('game')} /> Load a game
            </label>
          </div>
          {source === 'clubs' ? (
            !clubs.data ? (
              <Loading />
            ) : (
              <>
                <p className="mt-2 text-xs text-slate-500">{chosen.size} clubs chosen (an even number, 2 to 20). Each plays its best XI.</p>
                <div className="mt-1 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto text-sm md:grid-cols-3">
                  {pool.map((c) => (
                    <label key={c.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={chosen.has(c.id)}
                        onChange={(e) => {
                          const n = new Set(chosen);
                          if (e.target.checked) n.add(c.id);
                          else n.delete(c.id);
                          setPicked(n);
                        }}
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )
          ) : (
            <input className="input mt-2 font-mono uppercase" placeholder="Game code" maxLength={6} value={gameCode} onChange={(e) => setGameCode(e.target.value)} aria-label="Game code" />
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
            <label className="text-xs">
              Mode
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'season' | 'montecarlo')}>
                <option value="season">One season</option>
                <option value="montecarlo">Monte Carlo</option>
              </select>
            </label>
            {mode === 'montecarlo' ? (
              <label className="text-xs">
                Seasons
                <input className="input" type="number" min={10} max={1000} step={10} value={runs} onChange={(e) => setRuns(Number(e.target.value))} />
              </label>
            ) : null}
            <label className="text-xs">
              Seed (blank = random)
              <input className="input" type="number" min={1} value={seed} onChange={(e) => setSeed(e.target.value)} />
            </label>
            {PARAMS.map(([key, label, step]) => (
              <label key={key} className="text-xs">
                {label} (blank = setting)
                <input
                  className="input"
                  type="number"
                  step={step}
                  value={params[key] ?? ''}
                  onChange={(e) => {
                    const next = { ...params };
                    if (e.target.value === '') delete next[key];
                    else next[key] = Number(e.target.value);
                    setParams(next);
                  }}
                />
              </label>
            ))}
          </div>
          <button type="button" className="btn-primary mt-3" disabled={run.isPending} onClick={() => run.mutate(undefined, { onSuccess: setResult })}>
            {run.isPending ? (mode === 'montecarlo' ? `Simulating ${runs} seasons…` : 'Simulating…') : 'Run'}
          </button>
        </Section>
        <Section title="Test Draft">
          <p className="text-sm text-slate-500">Creates a game with bot drafters, fast-forwards the whole draft and simulates the season.</p>
          <label className="mt-2 block text-xs">
            Drafting teams
            <input className="input" type="number" min={1} max={20} value={testTeams} onChange={(e) => setTestTeams(Number(e.target.value))} />
          </label>
          <button type="button" className="btn-secondary mt-2 w-full" disabled={testDraft.isPending} onClick={() => testDraft.mutate(undefined, { onSuccess: (o) => setTestCode(o.code) })}>
            {testDraft.isPending ? 'Drafting and simulating…' : 'Run a Test Draft'}
          </button>
          {testCode ? (
            <p className="mt-2 text-sm">
              Done: <Link to={`/results/${testCode}`} className="font-semibold underline">results for {testCode}</Link>
            </p>
          ) : null}
        </Section>
      </div>
      {result ? <LabResult r={result} /> : null}
    </>
  );
}

function LabResult({ r }: { r: LabResultView }) {
  const names = new Map(r.teams.map((t) => [t.id, t.name]));
  const s = r.summary;
  const stats: [string, string][] = [
    ['Goals per match', s.goalsPerMatch.toFixed(2)],
    ['Home win rate', `${Math.round(s.homeWinRate * 100)}%`],
    ['Draw rate', `${Math.round(s.drawRate * 100)}%`],
    [r.mode === 'season' ? 'Champion points' : 'Avg champion points', String(s.championPoints)],
    [r.mode === 'season' ? 'Bottom points' : 'Avg bottom points', String(s.bottomPoints)],
    ['Points spread', String(s.pointsSpread)],
  ];
  return (
    <Section title={`Result · seed ${r.seed}`}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {stats.map(([label, v]) => (
          <div key={label} className="rounded-xl bg-slate-100 p-2 dark:bg-night-900">
            <p className="text-[10px] font-bold uppercase text-slate-500">{label}</p>
            <p className="display text-2xl tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {r.table ? (
        <table className="mt-3 w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="text-left">#</th>
              <th className="text-left">Team</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>GD</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {r.table.map((row) => (
              <tr key={row.teamId} className="border-t border-slate-200 dark:border-white/5">
                <td className="py-0.5 tabular-nums">{row.position}</td>
                <td className="max-w-0 truncate">{names.get(row.teamId)}</td>
                <td className="text-center tabular-nums">{row.won}</td>
                <td className="text-center tabular-nums">{row.drawn}</td>
                <td className="text-center tabular-nums">{row.lost}</td>
                <td className="text-center tabular-nums">{row.goalDifference}</td>
                <td className="text-center font-bold tabular-nums">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {r.monteCarlo ? (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left">Team</th>
                <th>Title</th>
                <th>Top 4</th>
                <th>Avg pts</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {r.monteCarlo.rows.map((row) => (
                <tr key={row.teamId} className="border-t border-slate-200 dark:border-white/5">
                  <td className="max-w-0 truncate py-0.5">{row.name}</td>
                  <td className="text-center tabular-nums">{(row.titleChance * 100).toFixed(1)}%</td>
                  <td className="text-center tabular-nums">{(row.top4Chance * 100).toFixed(0)}%</td>
                  <td className="text-center tabular-nums">{row.avgPoints.toFixed(1)}</td>
                  <td className="text-center text-xs tabular-nums">
                    {row.minPoints} to {row.maxPoints}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-4">
            <Bars title="Goals per match (distribution)" values={r.monteCarlo.goalsHistogram} label={(i) => (i === 10 ? '10+' : String(i))} />
            <Bars title="Average points by finishing position" values={r.monteCarlo.pointsByPosition} label={(i) => String(i + 1)} />
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function Bars({ title, values, label }: { title: string; values: number[]; label: (i: number) => string }) {
  const max = Math.max(1, ...values);
  return (
    <figure>
      <figcaption className="text-xs font-semibold">{title}</figcaption>
      <div className="mt-1 flex h-32 items-end gap-0.5" role="img" aria-label={`${title}: ${values.map((v, i) => `${label(i)} ${Math.round(v)}`).join(', ')}`}>
        {values.map((v, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
            <div className="w-full rounded-t bg-pitch-500" style={{ height: `${(v / max) * 100}%` }} title={`${label(i)}: ${Math.round(v * 10) / 10}`} />
            <span className="text-[9px] text-slate-500">{label(i)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
