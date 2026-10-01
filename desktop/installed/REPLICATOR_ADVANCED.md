# Replicator advanced settings

Replicator has Device Definition and Advanced Settings folder tabs. Advanced Settings reuses Memory's RBE Rules, State Sealing and Access Policy editor.

These settings apply to the Replicator's destination MMA2 memory, not to the source PLC. Destination ranges derive from the union of Pull Blocks per function code. A sealing control coil must lie in a configured destination coil range. In either editor, Advanced Settings / RBE Rules / RBE TCP Settings opens the shared MMA Settings popup. Enabling RBE TCP output prefills editable `:9001` (all local interfaces), matching MMA2's example; existing configured addresses are preserved when opening the form. Enter the desired IP:port and Save & Apply. The listener is shared while rules remain per device.

Unchecking Auto Port or Auto Unit ID immediately unlocks that destination field. Reservation conflicts are rejected during save; different Unit IDs may share one MMA2 port. Shared MMA settings save validates configuration but does not probe operating-system port availability or wait for restart success. A port held by another process may therefore cause a subsequent MMA2 bind failure rather than a save-time error.

New devices allow IPv4 and IPv6, Read/Write, and default to sealing off. Existing destination settings are inherited during runtime composition unless explicitly overridden. Changes persist as mma2_advanced in the Replicator document; legacy documents without that field retain existing destination configuration.

Both editors use an unfiltered preset dropdown beside the editable Source IP / CIDR box. It remains available after typing. Comma-separated addresses and CIDRs are trimmed and stored as separate source_ip entries; empty comma segments are ignored. Invalid addresses still fail authoritative MMA2 validation.

Rebuild/restart the Replicator backend with the UI. New advanced saves check backend capability before sending Apply, so an outdated backend cannot silently discard the new fields.
