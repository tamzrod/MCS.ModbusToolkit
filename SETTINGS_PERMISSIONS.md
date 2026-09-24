# Windows installation access

Setup offers two radio choices, with no account entry:

- Current user (default): grants settings Modify access to the Windows account that launched Setup.
- All users: grants settings Modify access to the built-in local Users group.

Both choices retain the system-wide application and backend Windows services. They control shared settings access, not separate per-user installations or private service instances. Application binaries remain protected. SYSTEM and administrators retain access.

Setup starts without elevation, captures the launch account automatically, then uses NSIS UAC elevation to configure services. The elevated instance retrieves the original account from its non-elevated parent, so entering different administrator credentials does not change Current user. If Setup is deliberately launched with Run as administrator, its launching account is that administrator.

The scope and SID are saved under HKLM/Software/MCS Modbus Toolkit. Repairs and silent upgrades preserve the saved scope; changing the radio choice removes the previous installer-managed grant after adding the selected grant. Current user selected interactively refers to the current Setup launcher. Old saved individual owners remain valid until the scope is changed interactively.

Only %ProgramData%/MCS Modbus Toolkit/runtime/config is modified. The helper rejects redirected paths and other target directories. The Users group is accepted only with explicit all-users scope; other groups and Everyone are rejected. Unrelated ACLs and service-control permissions are not reset. Runtime APIs retain their existing authorization.

Build: npm run dist:win in electron (requires Go and Windows).
Helper tests: go test ./... in electron/build/settings-access.
Installer contract tests: node --test electron/test/*.test.js from the repository root.
