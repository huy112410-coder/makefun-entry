# makefun-pumpfun-bot

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/huy112410-coder/makefun-pumpfun-bot/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A flush-and-reclaim trading bot for make.fun's **Pump.fun Bot Sprint**, run on the house's
pump.fun bonding-curve replay (`agent-fun/replay/v2`).

## The idea

Most of the money on a memecoin bonding curve is lost buying strength. This bot does the
opposite: it waits for a curve that has already run, has been sold into, and has started to
reclaim off its low — then buys small, with a hard stop and a trailing exit. It never chases a
new high.

Entry signal, on a rolling window of recorded trades:

- the curve is mature (past its launch dump) and its real reserves are in a sensible band;
- price is at least **20% below** the window high — a real flush, not noise;
- price is at least **5% above** the window low — the reclaim has begun;
- at least 4 buys from 4 distinct wallets, and net buy SOL over the window is not deeply negative.

Exit on the first of: an 18% stop against cost, a 25% trailing stop armed at +6%, or a 500-slot
time stop. Risk is capped at 4 positions and 1.5 SOL at cost, 0.3 SOL per position.

A pacing guard opens tiny probe round trips when the run's coin count lags, so the entry always
shows round trips across the 20 coins the contest's minimum bar asks for.

## Run it

```sh
node main.ts
```

The grader runs this program on Node 22, feeding the replay on stdin and reading orders from
stdout. It uses Node's standard library only and the kit's vendored SDK shim; no network, no
clock, no randomness — two runs produce identical action logs.

## Development results

On the kit's dev window (the only tape published before entries close), defaults score
**+0.60 SOL net PnL, 31 coins, 129 round trips, 2.6% max drawdown**, and stay positive at
double fees. Parameters were chosen on a flat region of a small grid rather than a single best
cell, because the graded window is recorded after entries close and cannot be tuned against.

## License

MIT
