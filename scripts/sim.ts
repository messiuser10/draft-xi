/**
 * npm run sim -- --humans 3 --seed 42
 *
 * Builds a league from the data files: the (20 - N) strongest clubs as AI teams plus N human
 * teams from a random snake draft, simulates a season and prints the table. Used to tune realism.
 *
 * Options:
 *   --humans N           human teams, 1 to 20 (default 3)
 *   --seed S             seed for the draft and the season (default 42)
 *   --monte-carlo RUNS   also run a Monte Carlo of RUNS seasons (e.g. 1000)
 *   --seasons K          also run K seasons (2 to 10) and print the titles table
 *   --keep-drafted       leave drafted players in their AI club's squad
 *   --injuries           turn injuries on
 *   --no-chemistry       turn the chemistry bonus off
 *   --base-goals X --home-advantage X --sensitivity X --chaos X   override parameters
 */
import { parseArgs } from 'node:util';
import {

  buildLeagueTeams,
  computeAwards,
  computeClubStrengths,
  createRng,
  draftGrade,
  FORMATION_IDS,
  hashSeed,
  monteCarlo,
  poolRanks,
  resolveParams,
  type SeasonResult,
  selectAiClubIds,
  simulateMultiSeason,
  simulateRandomDraft,
  simulateSeason,
  type SimParams,
  tagPick,
} from '@draft-xi/engine';
import { datasetToEngine, loadDataset } from '@draft-xi/server';

const { values } = parseArgs({
  options: {
    humans: { type: 'string', default: '3' },
    seed: { type: 'string', default: '42' },
    'monte-carlo': { type: 'string' },
    seasons: { type: 'string' },
    'keep-drafted': { type: 'boolean', default: false },
    injuries: { type: 'boolean', default: false },
    'no-chemistry': { type: 'boolean', default: false },
    'base-goals': { type: 'string' },
    'home-advantage': { type: 'string' },
    sensitivity: { type: 'string' },
    chaos: { type: 'string' },
  },
  strict: true,
});

function intArg(name: string, raw: string | undefined, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`--${name} must be a whole number from ${min} to ${max} (got ${raw})`);
  }
  return n;
}

function numArg(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number (got ${raw})`);
  return n;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pad = (s: string | number, n: number) => String(s).padStart(n);

async function main(): Promise<void> {
  const humans = intArg('humans', values.humans, 1, 20);
  const seed = intArg('seed', values.seed, 0, 2 ** 32 - 1);
  const overrides: Partial<SimParams> = { injuries: values.injuries, chemistry: !values['no-chemistry'] };
  for (const [flag, key] of [
    ['base-goals', 'baseGoals'],
    ['home-advantage', 'homeAdvantage'],
    ['sensitivity', 'sensitivity'],
    ['chaos', 'chaos'],
  ] as const) {
    const v = numArg(flag, values[flag]);
    if (v !== undefined) overrides[key] = v;
  }
  const params = resolveParams(overrides);

  const { clubs, players } = datasetToEngine(await loadDataset());
  const clubName = new Map(clubs.map((c) => [c.id, c.name]));

  // Pre-draft snapshot decides the AI clubs.
  const strengths = computeClubStrengths(clubs, players);
  const aiClubIds = selectAiClubIds(strengths, humans);
  const aiSet = new Set(aiClubIds);

  // Random snake draft.
  const rng = createRng(hashSeed(seed, 'sim-draft'));
  const drafters = Array.from({ length: humans }, () => ({ formation: rng.pick(FORMATION_IDS) }));
  const picks = simulateRandomDraft(players, drafters, rng);
  const humanTeams = drafters.map((d, i) => ({
    id: `h:${i + 1}`,
    name: `Human ${i + 1}`,
    formation: d.formation,
    picks: picks.filter((p) => p.participantIndex === i).map((p) => ({ slotKey: p.slotKey, playerId: p.player.id })),
  }));
  const teams = buildLeagueTeams({
    clubs,
    players,
    humans: humanTeams,
    aiClubIds,
    removeDraftedFromAi: !values['keep-drafted'],
  });

  console.log(`Draft XI League sim: ${humans} human team(s), seed ${seed}`);
  console.log(
    `Params: base ${params.baseGoals}, home x${params.homeAdvantage}, sensitivity ${params.sensitivity}, ` +
      `chaos ${params.chaos}, chemistry ${params.chemistry ? 'on' : 'off'}, injuries ${params.injuries ? 'on' : 'off'}\n`,
  );
  console.log(`AI clubs (${aiClubIds.length}): ${aiClubIds.map((id) => clubName.get(id)).join(', ')}`);
  const missing = strengths.filter((s) => !aiSet.has(s.clubId)).map((s) => s.clubName);
  console.log(`Not in the league (players still draftable): ${missing.join(', ') || 'none'}\n`);

  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const season = simulateSeason(teams, { seed, params });
  const preRank = new Map(
    [...season.teams].sort((a, b) => b.rating.strength - a.rating.strength).map((t, i) => [t.id, i + 1]),
  );

  const ranks = poolRanks(players);
  for (const h of humanTeams) {
    const team = season.teams.find((t) => t.id === h.id)!;
    const finish = season.table.find((r) => r.teamId === h.id)!.position;
    const grade = draftGrade(preRank.get(h.id)!, finish);
    console.log(
      `${h.name} (${h.formation}): attack ${team.rating.attack}, defense ${team.rating.defense}, ` +
        `chemistry +${team.rating.chemistry}, strength rank ${preRank.get(h.id)}, finished ${finish}, grade ${grade.grade}`,
    );
    for (const p of picks.filter((x) => x.participantIndex === humanTeams.indexOf(h))) {
      const tag = tagPick(p.pickNumber, ranks.get(p.player.id)!);
      console.log(
        `   #${pad(p.pickNumber, 3)} ${p.slotKey.padEnd(5)} ${p.player.name.padEnd(26)} ${p.player.overall} ` +
          `${clubName.get(p.player.clubId)?.padEnd(24)} ${tag}`,
      );
    }
  }

  printTable(season, nameOf);
  printSeasonStats(season, nameOf, picks.map((p) => ({ playerId: p.player.id, teamId: `h:${p.participantIndex + 1}`, pickNumber: p.pickNumber })));

  if (values.seasons !== undefined) {
    const k = intArg('seasons', values.seasons, 2, 10);
    const multi = simulateMultiSeason(teams, { seed, seasons: k, params });
    console.log(`\nTitles over ${k} seasons:`);
    for (const r of multi.titles.slice(0, 10)) {
      console.log(`  ${(nameOf.get(r.teamId) ?? r.teamId).padEnd(26)} titles ${r.titles}  avg pos ${r.avgPosition}  best ${r.bestPosition}`);
    }
  }

  if (values['monte-carlo'] !== undefined) {
    const runs = intArg('monte-carlo', values['monte-carlo'], 1, 100_000);
    const t0 = performance.now();
    const mc = monteCarlo(teams, { seed, runs, params });
    const ms = performance.now() - t0;
    console.log(`\nMonte Carlo: ${runs} seasons in ${(ms / 1000).toFixed(1)}s (Expected Strength)`);
    console.log(`  ${'Team'.padEnd(26)} ${pad('AvgPts', 7)} ${pad('AvgPos', 7)} ${pad('Title', 7)} ${pad('Top4', 7)} ${pad('Bot3', 7)}  Range`);
    for (const r of mc.rows) {
      console.log(
        `  ${(nameOf.get(r.teamId) ?? r.teamId).padEnd(26)} ${pad(r.avgPoints.toFixed(1), 7)} ${pad(r.avgPosition.toFixed(1), 7)} ` +
          `${pad(pct(r.titleChance), 7)} ${pad(pct(r.top4Chance), 7)} ${pad(pct(r.bottom3Chance), 7)}  ${r.minPoints}-${r.maxPoints}`,
      );
    }
    console.log(
      `  Goals/match ${mc.goalsPerMatch}, home ${pct(mc.homeWinRate)}, draw ${pct(mc.drawRate)}, away ${pct(mc.awayWinRate)}`,
    );
    console.log(
      `  Avg champion ${mc.pointsByPosition[0]} pts, 4th ${mc.pointsByPosition[3]}, 17th ${mc.pointsByPosition[16]}, ` +
        `bottom ${mc.pointsByPosition[mc.pointsByPosition.length - 1]}`,
    );
  }
}

function printTable(season: SeasonResult, nameOf: Map<string, string>): void {
  console.log(`\n${'Pos'.padEnd(4)}${'Team'.padEnd(28)}${pad('P', 3)}${pad('W', 4)}${pad('D', 4)}${pad('L', 4)}${pad('GF', 5)}${pad('GA', 5)}${pad('GD', 5)}${pad('Pts', 5)}  Form`);
  for (const r of season.table) {
    const human = r.teamId.startsWith('h:');
    const name = `${nameOf.get(r.teamId) ?? r.teamId}${human ? ' [H]' : ''}`;
    const gd = r.goalDifference > 0 ? `+${r.goalDifference}` : String(r.goalDifference);
    console.log(
      `${String(r.position).padEnd(4)}${name.padEnd(28)}${pad(r.played, 3)}${pad(r.won, 4)}${pad(r.drawn, 4)}${pad(r.lost, 4)}` +
        `${pad(r.goalsFor, 5)}${pad(r.goalsAgainst, 5)}${pad(gd, 5)}${pad(r.points, 5)}  ${r.form}`,
    );
  }
}

function printSeasonStats(
  season: SeasonResult,
  nameOf: Map<string, string>,
  picks: { playerId: number; teamId: string; pickNumber: number }[],
): void {
  const s = season.summary;
  console.log(
    `\nGoals/match ${(s.goals / s.matches).toFixed(2)}, home wins ${pct(s.homeWins / s.matches)}, ` +
      `draws ${pct(s.draws / s.matches)}, away wins ${pct(s.awayWins / s.matches)}`,
  );
  const awards = computeAwards(season, { picks });
  const who = (st: { playerName: string; teamId: string } | null | undefined) =>
    st ? `${st.playerName} (${nameOf.get(st.teamId)})` : 'none';
  console.log(`Champion: ${nameOf.get(awards.championTeamId)}`);
  console.log(`Golden Boot: ${who(awards.goldenBoot)}, ${awards.goldenBoot?.goals ?? 0} goals`);
  console.log(`Playmaker: ${who(awards.playmaker)}, ${awards.playmaker?.assists ?? 0} assists`);
  console.log(`Golden Glove: ${who(awards.goldenGlove)}, ${awards.goldenGlove?.cleanSheets ?? 0} clean sheets`);
  console.log(`Player of the Season: ${who(awards.playerOfTheSeason)}, avg ${awards.playerOfTheSeason?.avgRating ?? '-'}`);
  if (awards.bestDraftSteal) {
    console.log(`Best Draft Steal: ${who(awards.bestDraftSteal.stat)}, pick ${awards.bestDraftSteal.pickNumber}`);
  }
  if (awards.biggestFlop) {
    console.log(`Biggest Flop: ${who(awards.biggestFlop.stat)}, pick ${awards.biggestFlop.pickNumber}`);
  }
  if (awards.teamOfTheSeason) {
    console.log(
      `Team of the Season (${awards.teamOfTheSeason.formation}): ` +
        awards.teamOfTheSeason.slots.map((x) => `${x.slot.key} ${x.stat.playerName}`).join(', '),
    );
  }
  const scorers = [...season.playerStats].sort((a, b) => b.goals - a.goals).slice(0, 5);
  console.log(`Top scorers: ${scorers.map((x) => `${x.playerName} ${x.goals}`).join(', ')}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
