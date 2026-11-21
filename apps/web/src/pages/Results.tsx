/** Season Complete (spec section 10): table, awards, draft grades, head to head, share and host actions. */
import type { AwardPlayerView, LeagueTeamView, ResultsView } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ClubShield } from '../components/Kickoff';
import { Pitch } from '../components/Pitch';
import { TeamBadge } from '../components/TeamBadge';
import { DISCLAIMER } from '../components/Layout';
import { api } from '../lib/api';
import { usePool } from '../lib/pool';
import { BAND_BORDER, bandFor, DEFAULT_BANDS, useSite } from '../lib/session';
import { useGame, useRematch, useToasts } from '../lib/socket';
import { PageSkeleton } from '../components/Skeleton';
import { ErrorCard } from '../components/ErrorBoundary';

export function useResults(code: string, season: number | null) {
  return useQuery({
    queryKey: ['results', code, season],
    staleTime: Infinity,
    queryFn: () => api<ResultsView>(`/api/games/${code}/results${season ? `?season=${season}` : ''}`),
  });
}

export function TeamMark({ team, size = 'sm' }: { team: LeagueTeamView; size?: 'sm' | 'md' }) {
  return team.kind === 'human' ? (
    <TeamBadge color={team.primaryColor} monogram={team.monogram} size={size === 'sm' ? 'sm' : 'md'} />
  ) : (
    <ClubShield primary={team.primaryColor} secondary={team.secondaryColor} text={team.monogram} size={size} />
  );
}

const TAG_STYLE = {
  Steal: 'bg-pitch-500 text-night-950',
  Fair: 'bg-slate-200 text-slate-800 dark:bg-night-700 dark:text-slate-200',
  Reach: 'bg-red-500 text-white',
} as const;

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-pitch-500';
  if (grade.startsWith('B')) return 'text-sky-500';
  if (grade.startsWith('C')) return 'text-gold-500';
  return 'text-red-500';
}

export function ResultsPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const [params, setParams] = useSearchParams();
  const seasonParam = Number(params.get('season')) || null;
  const { snapshot } = useGame(code);
  const results = useResults(code, seasonParam);
  const pool = usePool();
  if (results.error) return <ErrorCard title="Could not load this page" message={results.error.message} />;
  if (!results.data) return <PageSkeleton label="Loading results" />;
  const r = results.data;
  const teams = new Map(r.teams.map((t) => [t.id, t]));
  const champion = r.championTeamId ? teams.get(r.championTeamId) : undefined;
  const isHost = Boolean(snapshot?.me.isHost || snapshot?.me.isAdmin);

  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="display text-pitch-500">{r.gameName}</p>
          <h1 className="display text-4xl">Season {r.season} complete</h1>
        </div>
        {r.seasonCount > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            Season
            <select className="input min-h-11 w-20" value={r.season} onChange={(e) => setParams({ season: e.target.value })}>
              {Array.from({ length: r.seasonCount }, (_, i) => i + 1).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        ) : null}
        <Link to={`/season/${code}`} className="btn-ghost">
          Replay season
        </Link>
      </header>

      {champion ? (
        <section className="card flex items-center gap-4 bg-gradient-to-r from-gold-500/20 to-transparent p-5">
          <span className="text-5xl" aria-hidden>
            🏆
          </span>
          <div className="min-w-0 flex-1">
            <p className="display text-gold-500">Champions</p>
            <Link to={`/team/${code}/${champion.id}?season=${r.season}`} className="display block truncate text-3xl hover:underline">
              {champion.name}
            </Link>
            <p className="text-sm text-slate-500">
              {r.finalTable[0]?.points} points · {champion.kind === 'human' ? 'a drafted team' : 'AI club'}
            </p>
          </div>
          <TeamMark team={champion} size="md" />
        </section>
      ) : null}

      <Share results={r} teams={teams} isHost={isHost} code={code} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <FinalTable results={r} teams={teams} code={code} />
        <div className="grid content-start gap-4">
          <Awards results={r} />
          {r.awards?.teamOfTheSeason ? (
            <section className="card p-4">
              <h2 className="display text-xl">Team of the Season · {r.awards.teamOfTheSeason.formation}</h2>
              <div className="mx-auto mt-3 max-w-sm">
                <Pitch
                  compact
                  label="Team of the Season"
                  slots={r.awards.teamOfTheSeason.slots.map((s) => ({
                    key: s.slotKey,
                    type: s.slotType,
                    x: s.x,
                    y: s.y,
                    player: {
                      name: s.name,
                      overall: s.overall,
                      ringColor: (s.clubId !== null && pool.data?.clubsById.get(s.clubId)?.primaryColor) || '#94A3B8',
                      stat: s.stat.avgRating.toFixed(2),
                    },
                  }))}
                />
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <Grades results={r} teams={teams} />
      <HeadToHead results={r} teams={teams} />
      <Picks results={r} teams={teams} />
    </div>
  );
}

function FinalTable({ results, teams, code }: { results: ResultsView; teams: Map<string, LeagueTeamView>; code: string }) {
  const { data: site } = useSite();
  const band = (pos: number) => {
    const b = bandFor(site?.tableBands, pos);
    return b ? BAND_BORDER[b.color] : 'border-l-transparent';
  };
  const legend = site?.tableBands.enabled === false ? [] : (site?.tableBands.bands ?? DEFAULT_BANDS.bands);
  return (
    <section className="card overflow-x-auto p-4">
      <h2 className="display text-xl">Final table</h2>
      <table className="mt-2 w-full text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="w-8 text-left">#</th>
            <th className="text-left">Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {results.finalTable.map((row) => {
            const t = teams.get(row.teamId);
            return (
              <tr key={row.teamId} className={`border-l-4 ${band(row.position)} ${t?.kind === 'human' ? 'bg-pitch-500/10 font-semibold' : ''}`}>
                <td className="py-1 pl-1 tabular-nums">{row.position}</td>
                <td className="max-w-0">
                  <span className="flex min-w-0 items-center gap-1">
                    <Link to={`/team/${code}/${row.teamId}?season=${results.season}`} className="truncate hover:underline">
                      {row.position === 1 ? '🏆 ' : ''}
                      {t?.name}
                    </Link>
                    {t?.kind === 'human' ? <span className="shrink-0 rounded bg-pitch-500 px-1 text-[10px] font-bold text-night-950" title="Drafted team">HUMAN</span> : null}
                  </span>
                </td>
                <td className="text-center tabular-nums">{row.played}</td>
                <td className="text-center tabular-nums">{row.won}</td>
                <td className="text-center tabular-nums">{row.drawn}</td>
                <td className="text-center tabular-nums">{row.lost}</td>
                <td className="text-center tabular-nums">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                <td className="text-center font-bold tabular-nums">{row.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {legend.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500">
          {legend.map((b) => (
            <li key={b.label} className={`border-l-4 pl-1 ${BAND_BORDER[b.color]}`}>
              {b.label} ({b.from === b.to ? b.from : `${b.from} to ${b.to}`})
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function AwardCard({ title, icon, player, line }: { title: string; icon: string; player: AwardPlayerView | null; line: (p: AwardPlayerView) => string }) {
  return (
    <div className="rounded-xl bg-slate-100 p-3 dark:bg-night-900">
      <p className="text-xs font-bold uppercase text-slate-500">
        <span aria-hidden>{icon}</span> {title}
      </p>
      {player ? (
        <>
          <p className="mt-1 truncate font-semibold">{player.name}</p>
          <p className="truncate text-xs text-slate-500">
            {player.teamName} · {line(player)}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-500">Not awarded</p>
      )}
    </div>
  );
}

function Awards({ results }: { results: ResultsView }) {
  const a = results.awards;
  if (!a) return null;
  return (
    <section className="card p-4">
      <h2 className="display text-xl">Awards</h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <AwardCard title="Golden Boot" icon="⚽" player={a.goldenBoot} line={(p) => `${p.goals} goals`} />
        <AwardCard title="Playmaker" icon="🎯" player={a.playmaker} line={(p) => `${p.assists} assists`} />
        <AwardCard title="Golden Glove" icon="🧤" player={a.goldenGlove} line={(p) => `${p.cleanSheets} clean sheets`} />
        <AwardCard title="Player of the Season" icon="⭐" player={a.playerOfTheSeason} line={(p) => `${p.avgRating.toFixed(2)} average rating`} />
        <AwardCard title="Best Draft Steal" icon="💎" player={a.bestDraftSteal} line={(p) => `pick ${a.bestDraftSteal?.pickNumber}, played like no. ${a.bestDraftSteal?.performanceRank} (${p.avgRating.toFixed(2)})`} />
        <AwardCard title="Biggest Flop" icon="📉" player={a.biggestFlop} line={(p) => `pick ${a.biggestFlop?.pickNumber}, played like no. ${a.biggestFlop?.performanceRank} (${p.avgRating.toFixed(2)})`} />
      </div>
    </section>
  );
}

function Grades({ results, teams }: { results: ResultsView; teams: Map<string, LeagueTeamView> }) {
  if (results.grades.length === 0) return null;
  return (
    <section className="card p-4">
      <h2 className="display text-xl">Draft grades</h2>
      <p className="text-sm text-slate-500">From pre-season strength rank and final position, out of 20.</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {results.grades.map((g) => {
          const t = teams.get(g.teamId);
          return (
            <li key={g.teamId} className="flex items-center gap-3 rounded-xl bg-slate-100 p-3 dark:bg-night-900">
              {t ? <TeamMark team={t} /> : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{g.teamName}</span>
                <span className="block text-xs text-slate-500">
                  Strength rank {g.preseasonRank} · finished {g.finish}
                </span>
              </span>
              <span className={`display text-4xl ${gradeColor(g.grade)}`} aria-label={`Grade ${g.grade}`}>
                {g.grade}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HeadToHead({ results, teams }: { results: ResultsView; teams: Map<string, LeagueTeamView> }) {
  if (results.headToHead.length === 0) return null;
  const name = (id: string) => teams.get(id)?.name ?? 'Team';
  return (
    <section className="card p-4">
      <h2 className="display text-xl">Head to head</h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        {results.headToHead.map((h) => (
          <li key={`${h.teamAId}-${h.teamBId}`} className="rounded-xl bg-slate-100 p-3 dark:bg-night-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="min-w-0 flex-1 truncate">{name(h.teamAId)}</span>
              <span className="display text-xl tabular-nums">
                {h.aWins}-{h.draws}-{h.bWins}
              </span>
              <span className="min-w-0 flex-1 truncate text-right">{name(h.teamBId)}</span>
            </div>
            <p className="text-center text-xs text-slate-500">
              Wins, draws, wins · goals {h.aGoals}-{h.bGoals}
            </p>
            <ul className="mt-1 text-center text-xs">
              {h.fixtures.map((f) => (
                <li key={f.fixtureId}>
                  MD {f.matchday}: {name(f.homeTeamId)} {f.homeGoals}-{f.awayGoals} {name(f.homeTeamId === h.teamAId ? h.teamBId : h.teamAId)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Picks({ results, teams }: { results: ResultsView; teams: Map<string, LeagueTeamView> }) {
  const [open, setOpen] = useState(false);
  if (results.picks.length === 0) return null;
  const shown = open ? results.picks : results.picks.slice(0, 12);
  return (
    <section className="card overflow-x-auto p-4">
      <h2 className="display text-xl">Every pick</h2>
      <p className="text-sm text-slate-500">Steal: taken well after his rank in the pool. Reach: taken well before it.</p>
      <table className="mt-2 w-full text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="text-left">Pick</th>
            <th className="text-left">Player</th>
            <th className="text-left">Team</th>
            <th>OVR</th>
            <th>Pool rank</th>
            <th>Tag</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.pickNumber} className="border-t border-slate-200 dark:border-white/5">
              <td className="py-1 tabular-nums">{p.pickNumber}</td>
              <td className="max-w-0 truncate">
                {p.playerName} <span className="text-xs text-slate-500">{p.slotKey}</span>
                {p.autoPicked ? <span className="ml-1 text-xs text-slate-500">(auto)</span> : null}
              </td>
              <td className="max-w-0 truncate">{p.teamId ? teams.get(p.teamId)?.name : ''}</td>
              <td className="text-center tabular-nums">{p.overall}</td>
              <td className="text-center tabular-nums">{p.poolRank}</td>
              <td className="text-center">
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${TAG_STYLE[p.tag]}`}>{p.tag}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.picks.length > 12 ? (
        <button type="button" className="btn-ghost mt-2" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show fewer' : `Show all ${results.picks.length} picks`}
        </button>
      ) : null}
    </section>
  );
}

function Share({ results, teams, isHost, code }: { results: ResultsView; teams: Map<string, LeagueTeamView>; isHost: boolean; code: string }) {
  const push = useToasts((s) => s.push);
  const rematchCode = useRematch((s) => s[code]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(results.summary);
      push('Summary copied');
    } catch {
      push('Copy failed: your browser blocked the clipboard');
    }
  };
  return (
    <section className="card flex flex-wrap items-center gap-2 p-4">
      <button type="button" className="btn-secondary" onClick={() => void copy()}>
        Copy summary
      </button>
      <button type="button" className="btn-secondary" onClick={() => downloadSeasonCard(results, teams)}>
        Download image
      </button>
      {isHost ? (
        <>
          <a className="btn-ghost" href={`/api/games/${code}/export?format=json`} download>
            Export JSON
          </a>
          <a className="btn-ghost" href={`/api/games/${code}/export?format=csv`} download>
            Export CSV
          </a>
        </>
      ) : null}
      <Link to={`/season/${code}`} className="btn-ghost">
        Back to the season
      </Link>
      {rematchCode ? (
        <Link to={`/lobby/${rematchCode}`} className="btn-primary ml-auto">
          Join the next round
        </Link>
      ) : null}
    </section>
  );
}

/** Draws a 1080 by 1350 season card on a canvas and downloads it as PNG. */
function downloadSeasonCard(r: ResultsView, teams: Map<string, LeagueTeamView>): void {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, 1080, 1350);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? '#0f1a2e' : '#0d1628';
    ctx.fillRect(0, i * 112, 1080, 112);
  }
  ctx.fillStyle = '#22c55e';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText(`${r.gameName.toUpperCase()} · SEASON ${r.season}`, 60, 100);
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 80px system-ui, sans-serif';
  ctx.fillText(`🏆 ${r.awards?.championName ?? ''}`.slice(0, 26), 60, 200);
  ctx.font = '30px system-ui, sans-serif';
  let y = 290;
  for (const row of r.finalTable.slice(0, 10)) {
    const t = teams.get(row.teamId);
    ctx.fillStyle = t?.kind === 'human' ? '#4ade80' : '#e2e8f0';
    ctx.fillText(`${String(row.position).padStart(2, ' ')}  ${(t?.name ?? '').slice(0, 30)}`, 60, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${row.points} pts`, 1020, y);
    ctx.textAlign = 'left';
    y += 48;
  }
  y += 30;
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText('DRAFT GRADES', 60, y);
  ctx.font = '30px system-ui, sans-serif';
  y += 50;
  for (const g of r.grades.slice(0, 5)) {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`${g.grade.padEnd(3, ' ')} ${g.teamName.slice(0, 30)} (finished ${g.finish})`, 60, y);
    y += 46;
  }
  const a = r.awards;
  if (a?.goldenBoot) {
    y += 20;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Golden Boot: ${a.goldenBoot.name}, ${a.goldenBoot.goals} goals`, 60, y);
  }
  if (a?.playerOfTheSeason) {
    y += 46;
    ctx.fillText(`Player of the Season: ${a.playerOfTheSeason.name}`, 60, y);
  }
  ctx.fillStyle = '#64748b';
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillText(DISCLAIMER, 60, 1300);
  const link = document.createElement('a');
  link.download = `draft-xi-${r.gameCode.toLowerCase()}-season-${r.season}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
