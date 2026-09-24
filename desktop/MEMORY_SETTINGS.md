# Memory advanced-settings persistence

The Memory device document keeps per-memory `policy`, `state_sealing` and `rbe`
inside `device.mma2`, beside its port, Unit ID and FC allocations. Missing advanced
fields inherit existing effective settings for that identity; explicit policy/rule
objects and sealing `enabled: false` override them. Missing fields are not reset to
new-device defaults. New-device UI defaults are implemented in the later UI task.

The Go Simulator model round-trips these fields through YAML and JSON. Effective
unknown fields are preserved when rebuilding legacy definitions. The shared composer
retains existing listener bindings, IDs and extension metadata during a producer
rebuild; foreign memories and root extension data remain intact.

Electron's simulator IPC adds `mma-load` and `mma-apply` for shared `rbe`,
`access_events` and `debug`. These settings are not stored on an individual device.
`mma-apply` accepts only those keys; null requests removal, and the complete resulting
configuration must still validate. Removing an RBE output while memory rules still
require it is rejected, not silently converted into a disabled output.

Before writing effective configuration, Electron calls its bundled MMA2 binary with
`--validate-stdin`. This mode reads at most 4 MiB, validates without starting listeners
or writing configuration, and exits nonzero for invalid input. The invocation hides
the console and has a ten-second timeout. A missing/outdated binary fails the save;
there is no bypass to weaker JavaScript-only validation. Packaging must include a
matching rebuilt MMA2 binary before this Electron source is used.

The complete candidate checks include source IP/CIDR, sealing address allocation,
RBE range/ID validity, cross-memory duplicate IDs and listener-port collisions.
Existing restart-request behavior follows successful validation. This task does not
replace the existing multi-file persistence design with a new transaction system.

Coverage: Electron mocked composition validates before any write; Go fixture tests
cover YAML/JSON round trips, explicit settings, legacy composition, foreign memories,
listener preservation and rejected candidates. Actual validation CLI checks accepted
empty/valid-RBE input and rejected removed Influx configuration. Installed-service and
human UI acceptance are separate gates; no installed data was used by these tests.

## Isolated UI review

Set MCS_REVIEW_DATA_ROOT to a private absolute directory before launching the built
application to review without installed-service connections. This mode uses a private
Chromium profile, disables backend startup and Simulator generation, blocks Replicator
pipe operations, and reports review-only status. Save & Apply still validates with the
bundled MMA2 executable and writes only the review configuration. Its confirmation says
the backend was not started. Remove the variable for normal installed-service behavior.
