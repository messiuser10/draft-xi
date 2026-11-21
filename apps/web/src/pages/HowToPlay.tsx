import { Link } from 'react-router';
import { useWalkthrough } from '../components/Walkthrough';

const STEPS = [
  ['Create or join', 'Start a game and share the 6-letter code, link or QR code. Friends can join as guests with just a name. The host can fill empty seats with bots.'],
  ['Set up your team', 'Pick a team name, colour, monogram and formation. Ready up when you are happy; the host starts the draft.'],
  ['The league', 'There are always 20 teams. With N drafters, the 20 minus N strongest real clubs join as AI teams and play their best XI.'],
  ['Draft', 'Before every pick a wheel spins and lands on a club: you must draft one of that club\'s players into an open slot of your formation. A player must fit the slot, each player can only be drafted once, and once drafted a player is locked in that position. Miss the clock and you get an auto-pick from the spun club.'],
  ['Before kickoff', 'Pick a captain (they play every match with +3) and offer one-for-one trades to other teams. Both teams must accept, and the two players swap slots, so each must fit the other\'s position. Bots answer straight away.'],
  ['A round: two seasons', 'Everyone plays everyone twice: 38 matchdays a season, two seasons a round. After matchday 19 a mini transfer window opens (1 transfer each); between the seasons the big window opens (3 transfers). Trades work in every window. When every human team says done, or the host closes the window, play goes on.'],
  ['The leaderboard', 'After both seasons the team with the most league points over the round gets 1 point on the game leaderboard. Play again starts the next round with the same teams; Restart begins a new leaderboard from round 1.'],
] as const;

const TIPS = [
  ['Slots and positions', 'Each slot accepts its own position and close neighbours. A slot filter appears when you tap an empty slot on the pitch.'],
  ['Chemistry', 'Every pair of players in your XI from the same real club or the same nation adds a small chemistry bonus to attack and defense, up to a cap.'],
  ['Attack and defense', 'Your forwards and creative midfielders drive attack; your keeper, defenders and holding midfielders drive defense. Balance matters more than one star.'],
  ['Re-spin and golden spins', 'Once per draft you may re-spin the wheel on your turn. Now and then the wheel lands on a golden star: draft from any club.'],
  ['Queue', 'Star players to queue them. If the clock runs out, auto-pick takes the first queued player that still fits.'],
  ['Simulation', 'Matches are random but weighted by team strength and home advantage, so an upset is always possible. The same seed always replays the same season.'],
] as const;

const KEYS = [
  ['↑ ↓', 'Move through the player pool'],
  ['Enter', 'Open the focused player'],
  ['Esc', 'Close a panel or dialog'],
] as const;

export function HowToPlayPage() {
  const showWalkthrough = useWalkthrough((s) => s.show);
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="display flex-1 text-4xl">How to play</h1>
        <button type="button" className="btn-ghost" onClick={showWalkthrough}>
          Replay the walkthrough
        </button>
      </div>
      <ol className="grid gap-3">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="card flex animate-reveal gap-4 p-5" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="display grid size-10 shrink-0 place-items-center rounded-full bg-pitch-500 text-xl text-night-950" aria-hidden>
              {i + 1}
            </span>
            <div>
              <h2 className="font-semibold">{title}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="card p-5">
        <h2 className="display text-2xl">Tips</h2>
        <dl className="mt-3 grid gap-3">
          {TIPS.map(([title, text]) => (
            <div key={title}>
              <dt className="font-semibold">{title}</dt>
              <dd className="text-sm text-slate-600 dark:text-slate-300">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card p-5">
        <h2 className="display text-2xl">Keyboard</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {KEYS.map(([key, text]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="rounded bg-slate-200 px-2 py-0.5 font-mono text-xs dark:bg-night-700">{key}</kbd>
              </dt>
              <dd className="text-slate-600 dark:text-slate-300">{text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500">Sound effects (whistle and pick chime) are off by default; turn them on with the speaker button in the header.</p>
      </section>

      <Link to="/create" className="btn-primary">
        Create a game
      </Link>
    </div>
  );
}
