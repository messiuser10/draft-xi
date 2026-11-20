import { Link } from 'react-router';

const STEPS = [
  ['Create or join', 'Start a game and share the 6-letter code, link or QR code. Friends can join as guests with just a name.'],
  ['Set up your team', 'Pick a team name, colour, monogram and formation. Ready up when you are happy.'],
  ['The league', 'There are always 20 teams. With N players, the 20 minus N strongest real clubs join as AI teams.'],
  ['Draft', 'Take turns picking players into open slots of your formation. A player must fit the slot, and each player can only be drafted once.'],
  ['The season', 'Everyone plays everyone twice: 38 matchdays. Watch the table move, then see the champion, awards and draft grades.'],
];

export function HowToPlayPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <h1 className="display text-4xl">How to play</h1>
      <ol className="grid gap-3">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="card flex gap-4 p-5">
            <span className="display grid size-10 shrink-0 place-items-center rounded-full bg-pitch-500 text-xl text-night-950">{i + 1}</span>
            <div>
              <h2 className="font-semibold">{title}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link to="/create" className="btn-primary">
        Create a game
      </Link>
    </div>
  );
}
