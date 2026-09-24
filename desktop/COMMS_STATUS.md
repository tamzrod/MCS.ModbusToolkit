# Replicator communication LEDs

The Electron Replicator tab consumes per-layer observations from the Go runtime status response.
Rebuild and restart the Replicator backend as well as Electron when upgrading from a runtime without this telemetry.
The isolated UI review mode disables backend connections, so it cannot display live communication health.

- Network: a successful source TCP connection proves reachability. This is not an ICMP ping test. A failed connection alone leaves network reachability unknown.
- TCP: the actual source connection/write result; activity follows a newly transmitted Modbus request.
- Modbus: a validated response is green, a Modbus exception is amber, and a failed or malformed response is red.
- MMA2: green only after Raw Ingest acknowledges the destination write; failed writes are red. Skipped writes are unknown, not successful.

Block observations include address ranges, endpoints, errors and timestamps. Device LEDs aggregate all blocks, with errors taking precedence, then warnings, then unknown states.
Tooltips show the evidence. Disabled, stopped, unavailable, or stale runtime responses never imply healthy communication.
Older backends without the status schema show an explicit update/restart message rather than fabricated green LEDs.
