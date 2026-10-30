# Personal Hermes release review

`hermes-release-review.py` is the source of automation `auto_agxzfrsg_do` in
project `proj_iiqw2rww35`. Its existing schedule checks every day at 19:27
Europe/Moscow; the script starts a review every four calendar days from
2026-10-30 and records the date only after the thread has been created.

The script selects the injected `BB_CLI` path but removes that variable from
the CLI child's environment. It starts a separate process group and kills
the whole group after 90 seconds. The prompt, model, environment and schedule
are unchanged from the original automation.

Run its checks without starting an agent:

```sh
python3 -m unittest discover -s scripts/automations -p 'test_*.py' -v
```

BB runs a stored copy. Refresh it after changing the source:

```sh
bb automation update auto_agxzfrsg_do --project proj_iiqw2rww35 \
  --script-file /home/hermes/bb/source/scripts/automations/hermes-release-review.py \
  --host host_sxc76xxkvv --interpreter python3 --timeout 120s \
  --working-directory automation-storage
```

After verifying the copied script, resume the paused schedule:

```sh
bb automation resume auto_agxzfrsg_do --project proj_iiqw2rww35
```

## 2026-10-30 incident

Commit `31f46ab7e2c2384f1fbcace46b9f94be956db5b7` added the launcher hand-off
marker on 2026-10-29. The installed 0.48.0 launchers on the server still lacked
that code on 2026-10-30. Committing a source fix does not update the running
installation. The new review script also lacked the local protections already
present in the Cursor/Codex updater.

The launcher now consumes `BB_CLI` as well as marking the hand-off. Regression
tests cover an installed wrapper, its symlink, the JavaScript entrypoint,
custom overrides, and a legacy launcher that ignores the marker. Verify the
installed entrypoint too when deploying: source tests alone cannot establish
that an existing installation contains the fix. A temporary installed-file
patch can be overwritten by a BB update; the source fix must be included in
the deployed build.
