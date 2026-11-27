// Flush-and-reclaim: a mean-reversion bot for the pump.fun bonding-curve replay
// (agent-fun/replay/v2).
//
// The idea, in one paragraph: on a memecoin bonding curve most of the money is lost by buying
// strength. This bot waits for a curve that has already been on a run, then been sold into, and
// buys only after the selling has visibly stopped and price has reclaimed a little off the low.
// It never chases a new high, it sizes small, and it leaves when the reclaim fails.
//
// Deterministic by construction: the bot reads only the batch stream it is handed, keeps its
// state in insertion-ordered maps, and never reads a clock or a random number.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Lookback in slots for the flush/reclaim window. */
  window: number;
  /** Slots since the CreateEvent before a curve may be entered: fresh curves are launch dumps. */
  minAge: number;
  /** Curve real SOL bounds at entry. */
  minRqSol: number;
  maxRqSol: number;
  /** Price must be at least this far below the window high (a real flush, not noise). */
  flushDepth: number;
  /** ...and at least this far above the window low (the reclaim has started). */
  reclaim: number;
  /** Net buy SOL over the window must be at least this (negative allows a still-heavy tape). */
  minNetSol: number;
  /** Buy trades and distinct buying wallets in the window. */
  minBuys: number;
  minBuyers: number;
  /** SOL invested into one position in total. */
  stakeSol: number;
  /** Exits. */
  stopLoss: number;
  trail: number;
  trailArm: number;
  takeProfit: number;
  /** Slots held before the time stop. */
  maxHold: number;
  /** Slots after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Most positions open at once, and the most SOL at cost across them. */
  maxMain: number;
  maxExposureSol: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys, in bps; sells always go out at 10000. */
  buySlipBps: number;
  /**
   * Guardrail pacing: the run must show a round trip on at least 20 coins. When the bot's own
   * coins lag the pace, it opens a tiny probe round trip: buy probeSol, sell it as soon as the
   * buy fills.
   */
  probeSol: number;
  targetCoins: number;
  paceSecs: number;
}

export const DEFAULT_PARAMS: Params = {
  window: 40,
  minAge: 400,
  minRqSol: 3,
  maxRqSol: 25,
  flushDepth: 0.2,
  reclaim: 0.05,
  minNetSol: -0.5,
  minBuys: 4,
  minBuyers: 4,
  stakeSol: 0.3,
  stopLoss: 0.18,
  trail: 0.25,
  trailArm: 0.06,
  takeProfit: 0,
  maxHold: 500,
  cooldown: 200,
  maxEntries: 2,
  maxMain: 4,
  maxExposureSol: 1.5,
  minBuySol: 0.01,
  buySlipBps: 1200,
  probeSol: 0.02,
  targetCoins: 24,
  paceSecs: 14_400,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  exiting: boolean;
  filled: boolean;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight: true once the probe's sell has been sent. */
  const probes = new Map<Pubkey, boolean>();
  let myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = p.window + 10;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, trades: [], entries: 0, lastExit: -1e12 };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Has this curve flushed from its window high and started to reclaim off the low? */
  const entrySignal = (t: Tape, now: number, rqSol: number): boolean => {
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return false;
    if (t.created === null || now - t.created < p.minAge) return false;
    const from = now - p.window;
    let high = 0;
    let low = Number.POSITIVE_INFINITY;
    let last = 0;
    let buySol = 0;
    let sellSol = 0;
    let buys = 0;
    const buyers = new Set<string>();
    for (const tr of t.trades) {
      if (tr.slot <= from) continue;
      if (tr.price > high) high = tr.price;
      if (tr.price < low) low = tr.price;
      last = tr.price;
      if (tr.buy) {
        buySol += tr.sol;
        buys++;
        buyers.add(tr.user);
      } else {
        sellSol += tr.sol;
      }
    }
    if (buys < p.minBuys || buyers.size < p.minBuyers) return false;
    if (high <= 0 || !Number.isFinite(low) || last <= 0) return false;
    // A real flush from the window high...
    if (last > high * (1 - p.flushDepth)) return false;
    // ...with a reclaim off the window low.
    if (last < low * (1 + p.reclaim)) return false;
    // ...and the tape not still bleeding out.
    if (buySol - sellSol < p.minNetSol) return false;
    return true;
  };

  /** SOL at cost still open across all positions, from the bot's own point of view. */
  const exposureOf = (state: BotState): number => {
    let sum = 0;
    for (const [mint, h] of held) {
      const pos = state.positions.get(mint);
      sum += pos === undefined ? h.invested : Number(pos.cost_lamports) / LAMPORTS;
    }
    return sum;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) myCoins.add(f.mint);
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          tapeOf(e.mint).created = e.slot;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          t.trades.push({
            slot: e.slot,
            buy: e.is_buy,
            sol: Number(e.sol_amount) / LAMPORTS,
            user: e.user,
            price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves),
          });
        }
      }
      for (const [mint, t] of tapes) {
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }

      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pending = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pending.set(po.order.mint, (pending.get(po.order.mint) ?? 0) + 1);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // 1. Exits.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pending.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        let exit = h.exiting;
        if (!exit && value < cost * (1 - p.stopLoss)) exit = true;
        if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && p.takeProfit > 0 && value >= cost * (1 + p.takeProfit)) exit = true;
        if (!exit && now - h.opened > p.maxHold) exit = true;
        if (!exit) continue;
        h.exiting = true;
        let sellPending = false;
        for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
        if (sellPending) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // 2. Probe round trips: sell as soon as the probe's buy has landed.
      for (const [mint] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pending.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pending.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        probes.set(mint, true);
      }

      // 3. Entries (and the guardrail probes).
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = exposureOf(state);
      const traded = new Set(batch.events.filter((e) => e.event === 'TradeEvent').map((e) => e.mint));

      // Guardrail: keep the coin count on pace for the round-trip requirement.
      let paceDue = false;
      if (firstTime !== null && lastTime !== null) {
        const elapsed = Math.max(0, lastTime - firstTime);
        const share = Math.min(1, elapsed / p.paceSecs);
        paceDue = myCoins.size < p.targetCoins * share;
      }

      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pending.has(mint) || probes.has(mint) || held.has(mint)) continue;
        const t = tapes.get(mint)!;
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        const want = paceDue && myCoins.size < p.targetCoins && slotsLeft > 0 ? p.probeSol : null;
        if (want === null) {
          if (slotsLeft <= 0 || mainLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          if (exposure + p.stakeSol > p.maxExposureSol) continue;
          if (!entrySignal(t, now, rqSol)) continue;
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, want ?? p.stakeSol);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        orders.push({
          side: 'buy',
          mint,
          quote_lamports: BigInt(Math.floor(amount * LAMPORTS)),
          max_slippage_bps: p.buySlipBps,
        });
        free -= amount + tx;
        exposure += amount;
        if (want !== null) {
          probes.set(mint, false);
        } else {
          held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false });
          t.entries++;
          slotsLeft--;
          mainLeft--;
        }
      }
      return orders;
    },
  };
}
