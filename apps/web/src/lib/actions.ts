import { useState } from 'react';
import { api, errorMessage } from './api';
import { useToasts } from './socket';

/** Runs an API call for a button, showing failures as a toast. The socket delivers the new state. */
export function useAction() {
  const push = useToasts((s) => s.push);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(path: string, method = 'POST', body: unknown = {}): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await api<T>(path, { method, body });
    } catch (err) {
      push(errorMessage(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}
