// Entry point: the grader runs `node main.ts`.
// The bot itself lives in strategy.ts; the SDK shim in vendor/ is the kit's, vendored byte for
// byte as the rules allow.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
