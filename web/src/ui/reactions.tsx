import type { ReactNode } from 'react';
import type { ReactionKind } from '@shared/types.ts';

const icon = (d: ReactNode) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const REACTIONS: Record<ReactionKind, { label: string; icon: ReactNode; hint: string }> = {
  lost: {
    label: 'Lost me',
    hint: 'I stopped following',
    icon: icon(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14" />
        <circle cx="12" cy="17" r=".6" fill="currentColor" />
      </>,
    ),
  },
  fast: {
    label: 'Too fast',
    hint: 'Please slow down',
    icon: icon(
      <>
        <path d="M4 17l5-5-5-5M12 17l5-5-5-5" />
      </>,
    ),
  },
  love: {
    label: 'Love this',
    hint: 'This part is great',
    icon: icon(<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />),
  },
  question: {
    label: 'Question',
    hint: 'I have a question',
    icon: icon(
      <>
        <path d="M4 5h16v11H9l-5 4z" />
        <path d="M12 8.5v3M12 13.5v.01" />
      </>,
    ),
  },
};
