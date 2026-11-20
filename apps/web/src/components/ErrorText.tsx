import { errorMessage } from '../lib/api';

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
      {errorMessage(error)}
    </p>
  );
}
