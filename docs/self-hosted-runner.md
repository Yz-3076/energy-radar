# Keeping the cloud-blocked chains fresh

**Status: not set up, and deliberately so.** The data from these chains was
scraped once by hand and committed. This document exists for the day that
stops being good enough.

---

## The problem

Three chains return nothing at all to GitHub's hosted runners and full data
to a home connection in Israel. Measured 2026-09-14, the same code minutes
apart:

| Chain | From GitHub Actions | From a home connection in Israel |
|---|---|---|
| Super Pharm | 0 files | 307 branches, **284 with Monster** |
| Netiv Hased | 0 files | 91 branches, **58 with Monster** |
| Victory | connect timeout, no response | 70 branches, **69 with Monster** |

Victory is the clearest signal: a connect-level timeout rather than a `403`
or an error page is what a firewall silently dropping packets looks like.
Three unrelated companies on three unrelated hosts all behaving this way
toward cloud addresses is not a coincidence, and it is not something the
code can work around — the request has to originate from an IP they answer.

Those three chains are **411 branches**, roughly 38% of the ~1,080 stores
currently in the app.

## What is already in place

Everything except the runner itself.

- **`.github/workflows/fetch-blocked-chains.yml`** — the workflow, written
  and committed, with its schedule removed. It is `workflow_dispatch` only,
  because a cron with no registered runner queues runs that can never
  start.
- **`PIPELINE_CHAINS`** — restricts a run to named chains
  (`PIPELINE_CHAINS=SUPER_PHARM,NETIV_HASED,VICTORY_NEW_SOURCE`). Every
  other chain is then "silent" for that run.
- **`carry_forward()` in `pipeline.py`** — keeps the existing stores for
  chains that fetched nothing, so the two workflows cannot delete each
  other's work. Whichever ran last, `latest.json` ends up complete.
- **`merge_data.py`** — reconciles `data/` when two runs push close
  together, per file rather than by text merge.
- **Dump cleanup** — each chain's downloaded XML is deleted as soon as it
  is parsed. Without it the working directory grew to 22.7 GB.

So enabling this is registering a runner and restoring the `schedule:`
block. No code changes.

## Enabling it

1. **Settings → Actions → Runners → New self-hosted runner**, pick Windows
   x64, and copy the token it shows.

2. Download and unpack (PowerShell):

   ```powershell
   mkdir C:\actions-runner; cd C:\actions-runner
   Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v2.328.0/actions-runner-win-x64-2.328.0.zip -OutFile runner.zip
   Expand-Archive runner.zip -DestinationPath .
   ```

3. Register it as a service, so it starts with the machine and needs no
   login:

   ```powershell
   cd C:\actions-runner
   .\config.cmd --url https://github.com/Yz-3076/energy-radar --token YOUR_TOKEN --unattended --runasservice
   ```

4. Put the schedule back in `fetch-blocked-chains.yml`:

   ```yaml
   on:
     schedule:
       - cron: "15 5,13,21 * * *"
     workflow_dispatch: {}
   ```

   `:15` is deliberate — the cloud workflow runs on the hour, and offsetting
   means the two rarely try to push at the same moment.

## What it costs

| | |
|---|---|
| Runner software | ~200 MB, once |
| Disk while scraping | ~1–2 GB, freed as it goes |
| Disk between runs | ~0 |
| Memory | ~50 MB idle, a few hundred MB running |
| Time per run | ~10–20 minutes |

## What will go wrong

Not *might* — these are the normal failure modes, and they are all mild.

- **The machine sleeps.** This is the one that actually stops it. Windows
  sleeps by default after ~30 minutes idle, and a sleeping machine runs no
  scheduled jobs. Set *Settings → System → Power → Sleep → Never* when
  plugged in. Screen off is fine; sleep is not.
- **Reboots and updates.** The service survives, but a run scheduled during
  the reboot window is missed.
- **The connection drops.** That run fails and the next one picks up.

In every case the 411 stores stay in the app with their last known prices,
and the other ~670 keep updating from the cloud regardless. The app dates
every shelf row, so stale data reads as old rather than pretending to be
current. Nothing needs repairing afterwards — the next successful run
catches up on its own.

## Doing it by hand instead

Registering nothing and running the scrape manually is a legitimate choice
while the app is small, and is what is happening today:

```bash
cd israel-poc
PIPELINE_CHAINS=SUPER_PHARM,NETIV_HASED,VICTORY_NEW_SOURCE python pipeline.py
git add data/ && git commit -m "Refresh blocked-chain data" && git push
```

That is the whole job. The runner only automates this exact command.

## When to actually turn it on

Worth doing when any of these becomes true:

- Real users are checking prices and a fortnight-old price on a third of
  the map starts being a complaint rather than a footnote.
- The manual refresh is being forgotten, which it will be.
- Those chains grow enough that their share of the map stops being
  something you would accept going stale.

Until then, once-in-a-while by hand is proportionate.
