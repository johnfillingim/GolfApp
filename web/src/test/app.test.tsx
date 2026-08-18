/**
 * @vitest-environment jsdom
 *
 * End-to-end smoke test through the real components: set up a round, enter
 * scores, and check that the money lands where the scoring layer says it should.
 *
 * The engines have their own worked-example coverage; what this catches is the
 * wiring — a bet built with the wrong player IDs, a snapshot assembled from the
 * wrong field, standings reading settled instead of projected. That class of bug
 * passes every unit test and is obvious the moment a real round runs.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { allProfiles, allRounds, deleteProfile, deleteRound } from '../data/db';

/**
 * The db module keeps one open connection for the process, so dropping the
 * whole database mid-run would deadlock on `onblocked`. Emptying the stores
 * through the app's own API gets a clean slate without fighting that.
 */
async function clearDatabase(): Promise<void> {
  for (const round of await allRounds()) await deleteRound(round.id);
  for (const profile of await allProfiles()) await deleteProfile(profile.id);
}

describe('Birdie app', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('runs a round from setup through settle-up', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Home → new round
    await screen.findByText('No rounds yet');
    await user.click(screen.getByRole('button', { name: 'New round' }));

    // Step 1: course
    await screen.findByText('Step 1 of 3 · Course');
    await user.click(screen.getByRole('button', { name: /Next — players/ }));

    // Step 2: add two players
    await screen.findByText('Step 2 of 3 · Tap in tee order');
    const nameField = screen.getByPlaceholderText('Name');
    const indexField = screen.getByPlaceholderText('Idx');

    await user.type(nameField, 'Jack');
    await user.type(indexField, '0');
    await user.click(screen.getByRole('button', { name: 'Add player' }));

    await user.type(nameField, 'Jill');
    await user.type(indexField, '0');
    await user.click(screen.getByRole('button', { name: 'Add player' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Next — bets/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: /Next — bets/ }));

    // Step 3: a $5 gross skins bet, so one hole settles immediately and the
    // expected money is trivially hand-checkable.
    await screen.findByText('Step 3 of 3 · Agree before you tee off');
    await user.click(screen.getByRole('button', { name: /Skins/ }));
    await user.click(screen.getByRole('button', { name: '$5' }));
    await user.click(screen.getByRole('button', { name: 'Gross' }));
    await user.click(screen.getByRole('button', { name: 'Add bet' }));

    // The plain-English summary is the whole point of this step.
    expect(await screen.findByText(/\$5\.00 skins per hole/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Start round/ }));

    // Live round: hole 1, par 4 on the fixture course.
    await screen.findByText('Hole');
    expect(screen.getByText('Par 4 · 385 yds · SI 5')).toBeInTheDocument();

    // Jack makes 3, Jill makes 5 → Jack wins the skin, $5 from Jill.
    await user.click(screen.getByRole('button', { name: "Increase Jack's score" })); // par 4
    await user.click(screen.getByRole('button', { name: "Decrease Jack's score" })); // 3
    await user.click(screen.getByRole('button', { name: "Increase Jill's score" })); // par 4
    await user.click(screen.getByRole('button', { name: "Increase Jill's score" })); // 5

    // A birdie fires a celebration; dismiss it so it can't swallow later taps.
    const dismiss = screen.queryByRole('button', { name: 'Dismiss celebration' });
    if (dismiss) await user.click(dismiss);

    // Standings must show Jack +$5 / Jill −$5.
    await user.click(screen.getByRole('button', { name: 'Standings' }));
    const standings = await screen.findByRole('main');
    expect(within(standings).getByText('+$5')).toBeInTheDocument();
    expect(within(standings).getByText('-$5')).toBeInTheDocument();

    // Settle-up must reduce that to a single payment.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Hole');
    await user.click(screen.getByRole('button', { name: 'Settle' }));

    await screen.findByText('1 payment');
    expect(screen.getByText('Jill pays Jack')).toBeInTheDocument();
  });

  it('persists a round across a reload', async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await screen.findByText('No rounds yet');
    await user.click(screen.getByRole('button', { name: 'New round' }));
    await screen.findByText('Step 1 of 3 · Course');
    await user.click(screen.getByRole('button', { name: /Next — players/ }));

    await screen.findByText('Step 2 of 3 · Tap in tee order');
    await user.type(screen.getByPlaceholderText('Name'), 'Solo');
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    await user.type(screen.getByPlaceholderText('Name'), 'Buddy');
    await user.click(screen.getByRole('button', { name: 'Add player' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Next — bets/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: /Next — bets/ }));
    await user.click(await screen.findByRole('button', { name: /Start round/ }));

    await screen.findByText('Hole');
    await user.click(screen.getByRole('button', { name: "Increase Solo's score" }));
    await waitFor(() => expect(screen.getByText('Par')).toBeInTheDocument());

    first.unmount();

    // Remount: the round should come back off IndexedDB, mid-round.
    render(<App />);
    expect(await screen.findByText('In progress')).toBeInTheDocument();
    expect(screen.getByText(/thru 1 of 18/)).toBeInTheDocument();
  });
});
