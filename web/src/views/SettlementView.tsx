import { Button, Card, EmptyState, MoneyText, Screen } from '../components/ui';
import { balanceOf, formatMoney, transferID } from '../scoring';
import type { RoundSession } from '../state/useRoundSession';

/**
 * End-of-round settle-up, ported from `SettlementView.swift`.
 *
 * Pays **settled** money only — never projected. The greedy consolidation in
 * the scoring layer keeps this to at most (players − 1) payments, so a foursome
 * settles in three taps instead of six side conversations.
 *
 * No money moves through the app; these are instructions for humans, and the
 * paid/unpaid marks are just a checklist.
 */
export function SettlementView({
  session,
  onBack,
  onExit,
  onFinish,
}: {
  session: RoundSession;
  onBack: () => void;
  onExit: () => void;
  onFinish: () => void;
}) {
  const { transfers, settledBalances, projectedBalances, snapshot, isComplete } = session;

  const openMoney = snapshot.players.some(
    (p) => balanceOf(settledBalances, p.id) !== balanceOf(projectedBalances, p.id),
  );

  const name = (id: string): string =>
    session.playerNamed(id)?.name.split(' ')[0] ?? '?';

  return (
    <Screen
      title="Settle up"
      subtitle={isComplete ? 'Round complete' : 'Round still in progress'}
      onBack={onBack}
      footer={
        session.round.status !== 'finished' ? (
          <Button size="lg" onClick={onFinish} disabled={!isComplete}>
            {isComplete ? 'Finish round' : 'Finish (scores still open)'}
          </Button>
        ) : (
          // A finished round has no Finish button, so it needs its own way out.
          <Button size="lg" variant="secondary" onClick={onExit}>
            Back to rounds
          </Button>
        )
      }
    >
      <div className="p-4 space-y-6">
        {openMoney && (
          <Card className="px-4 py-3 border-gold/40">
            <div className="text-body text-gold">Some bets are still open</div>
            <div className="text-caption text-text-secondary mt-1">
              These payments cover money that can no longer change. Anything still
              riding is on the standings screen and settles when it's decided.
            </div>
          </Card>
        )}

        {transfers.length === 0 ? (
          <EmptyState
            emoji="🤝"
            title="Nobody owes anybody"
            message="Either it's all square, or no bets have settled yet."
          />
        ) : (
          <div>
            <div className="text-caption uppercase tracking-wider text-text-secondary mb-2 px-1">
              {transfers.length} payment{transfers.length === 1 ? '' : 's'}
            </div>
            <Card className="divide-y divide-stroke">
              {transfers.map((transfer) => {
                const paid = session.isSettled(transfer);
                return (
                  <button
                    key={transferID(transfer)}
                    type="button"
                    onClick={() => session.markSettled(transfer, !paid)}
                    className="tap w-full flex items-center gap-3 px-4 py-4 text-left active:bg-raised transition-colors"
                  >
                    <span
                      className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-caption ${
                        paid
                          ? 'bg-primary border-primary text-text-onAccent'
                          : 'border-stroke text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className={`block text-body truncate ${paid ? 'line-through text-text-secondary' : ''}`}
                      >
                        {name(transfer.from)} pays {name(transfer.to)}
                      </span>
                      <span className="block text-caption text-text-secondary">
                        {paid ? 'Paid' : 'Tap when settled'}
                      </span>
                    </span>
                    <span className={`tnum text-money-lg ${paid ? 'text-text-secondary' : 'text-money'}`}>
                      {formatMoney(transfer.amount)}
                    </span>
                  </button>
                );
              })}
            </Card>
          </div>
        )}

        <div>
          <div className="text-caption uppercase tracking-wider text-text-secondary mb-2 px-1">
            Final positions
          </div>
          <Card className="divide-y divide-stroke">
            {[...snapshot.players]
              .sort((a, b) => balanceOf(settledBalances, b.id) - balanceOf(settledBalances, a.id))
              .map((player) => (
                <div key={player.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-title">{session.emojiFor(player.id)}</span>
                  <span className="flex-1 min-w-0 truncate text-body">{player.name}</span>
                  <MoneyText cents={balanceOf(settledBalances, player.id)} signed />
                </div>
              ))}
          </Card>
          <p className="text-caption text-text-secondary mt-3 px-1">
            No money moves through this app. These are just instructions — settle
            however your group normally does.
          </p>
        </div>
      </div>
    </Screen>
  );
}
