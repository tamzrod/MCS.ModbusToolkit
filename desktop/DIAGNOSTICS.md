# Diagnostics

Diagnostics collects a read-only snapshot on entry or Refresh checks. It never opens probe connections, writes settings, stops processes, or restarts services. It reports service states, configured Modbus/RBE/access-event addresses, observed Windows TCP listener addresses and process IDs, and bounded backend log tails. Process names are evidence for operator review, not authenticated proof of backend health.

Unavailable inspection, missing logs, and empty configurations are explicitly identified. An observed MMA2 listener does not establish protocol health or configuration activation. Backend logs are historical and are not promoted into current failures automatically. Copy report includes IP addresses and log contents; review before sharing.

The updated installer configures separate NSSM stdout/stderr logs under runtime/logs, with 1 MiB online rotation. Existing installs require an installer upgrade for this capture; the desktop does not silently reconfigure services. Rotated files are not included in the UI and may accumulate on disk. Each refresh reads at most the latest 64 KiB of each current stream. Child-process mode retains a bounded in-memory log buffer.

Port observations are filtered by configured port and matching/wildcard addresses. An unknown or non-MMA2 owner requires review, not an automatic kill or confirmed collision verdict. Save-time OS port availability validation is not added by this tab.

## Queued follow-up: Replicator rename

Status: renderer fix implemented. Runtime polling is suppressed for new or renamed unsaved drafts, with a Save & Apply hint. Successful load/save and Discard establish saved identities; failed saves retain the draft and error. Installed-app acceptance remains pending.

User reports being unable to rename a Replicator device. Screenshot shows saved sidebar name Rep-PLC-1, draft Name test, and status error device "test" not found. Investigate whether polling uses the unsaved draft name, separately from whether Save & Apply persists a rename. Do not infer that rename persistence fails solely from this status error.

Acceptance: typing a draft name must not query a nonexistent runtime identity or lose focus; Save & Apply must persist a valid rename; reload must retain it; Discard restores the saved name; duplicate-name rejection must preserve the draft. Verify status polling during edit, after save, after discard, and on save failure.
