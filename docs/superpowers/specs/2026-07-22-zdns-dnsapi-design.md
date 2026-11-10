# ZDNS DNS API Provider Design

## Goal

Add an acme.sh DNS provider for ZDNS DDI 3.15.2.6 that creates and removes DNS-01 TXT records through the documented authoritative zone and record APIs.

## Configuration

- `ZDNS_API_URL`: required base URL, including scheme and optional port.
- `ZDNS_USERNAME`: required HTTP Basic authentication username.
- `ZDNS_PASSWORD`: required HTTP Basic authentication password.
- `ZDNS_VIEW`: optional view name, default `default`.
- `ZDNS_TTL`: optional TXT TTL, default `60`.

Configuration is loaded from environment variables first and mutable account configuration second. Successful setup stores the effective values for renewal.

## API Flow

For zone discovery, probe suffixes of the challenge FQDN from most specific to least specific. Each probe sends a JSON-body GET request to `/views/{view}/zones` with `search_attrs.name`; a candidate is accepted only when `resources.name` exactly matches it.

To add a challenge, POST `/views/{view}/zones/{zone}/rrs` with the relative record name, type `TXT`, configured TTL, challenge value in `rdata`, `is_enable=yes`, `expire_is_enable=no`, and `current_user`.

To remove a challenge, DELETE the same record endpoint with `extend_ids` containing `fqdn.$TXT$value`. This identifies the exact TXT value and preserves other concurrent ACME challenge records with the same owner name.

All requests use HTTP Basic authentication and JSON. Transport failures and JSON responses containing `error` fail the operation. A delete is successful only when the normalized response contains `"result":"succeed"`.

## Testing

A shell test harness stubs acme.sh runtime helpers and HTTP calls. It verifies defaults, most-specific zone discovery, Basic authentication, add payloads, exact-value delete payloads, and API error propagation. Static verification uses `shellcheck` and `shfmt` when installed.
