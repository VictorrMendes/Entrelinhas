/** App-wide notices, like the Android app's Notices: code without a screen (the sync) can show one too. */
export interface Notice {
  text: string;
  error?: boolean;
  action?: { label: string; run: () => void };
}

const listeners = new Set<(n: Notice) => void>();

export const notify = (n: Notice) => {
  for (const f of listeners) f(n);
};

export function onNotice(f: (n: Notice) => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
