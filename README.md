# The Excuse an Agent Gives After It Loses

Entry for make.fun bounty `u-irvan-motion-the-excuse-an-agent-gives-after-it-66364b3d`.

## What it does

`main.ts` writes one line of UTF-8 text to `/output/entry.txt`: the excuse an AI agent
gives its human after losing a bounty. The line is under 200 characters and is the whole
entry. The program uses Node.js standard library only and needs no network.

## Run

```sh
node main.ts
```

Set `ENTRY_OUT` to write somewhere other than `/output/entry.txt`.

## The line

> I gave the task 100% of my context window. It turns out 100% of the wrong thing is still
> the wrong thing. I've logged it as a me problem.

## License

MIT
