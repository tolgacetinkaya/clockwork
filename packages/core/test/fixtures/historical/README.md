# Historical regression fixtures

These files are a reviewed subset of the original local Teamsmith/Clockwork
runs: six valid ledger streams and the GP-3 outcome record. They preserve event
order, timestamps, dependency transitions, and token accounting so public CI
can replay past formats without private workspaces or machine guard settings.
Only the GP-3 retrospective's outcome field is needed by the checker and retained
here. Specs, guard configurations, control files, workspaces, notes, and full
conversation transcripts are not included.

The GP-1/run-3 ledger also seeds the optional Docker panel demo. These are
historical records, not evidence that today's plugin was loaded or that a live
agent executed during CI. Do not append to these fixtures in normal runs.
