# ZDNS DNS API Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested acme.sh provider that manages DNS-01 TXT records through ZDNS DDI authoritative DNS APIs.

**Architecture:** A single POSIX shell provider loads credentials, discovers the longest matching authoritative zone through filtered zone queries, and uses ZDNS record POST/DELETE endpoints. HTTP and JSON handling follow existing `dnsapi` helper conventions.

**Tech Stack:** POSIX shell, acme.sh DNS provider helpers, ZDNS DDI REST API.

---

### Task 1: Define Provider Behavior with a Shell Harness

**Files:**
- Create temporarily: `tmp/zdns_dnsapi_test.sh`
- Test: `dnsapi/dns_zdns.sh`

- [ ] **Step 1: Write the failing test**

Create a POSIX shell harness that exits with `provider missing` when `dnsapi/dns_zdns.sh` does not exist. Stub `_post`, `_base64`, account configuration, logging, JSON normalization, URL encoding, and string helpers. Assert that add and remove calls use the expected methods, URLs, Basic header, and JSON bodies.

- [ ] **Step 2: Run test to verify it fails**

Run: `sh tmp/zdns_dnsapi_test.sh`

Expected: non-zero exit with `provider missing`.

### Task 2: Implement the ZDNS Provider

**Files:**
- Create: `dnsapi/dns_zdns.sh`
- Test: `tmp/zdns_dnsapi_test.sh`

- [ ] **Step 1: Implement configuration loading**

Load `ZDNS_API_URL`, `ZDNS_USERNAME`, `ZDNS_PASSWORD`, `ZDNS_VIEW`, and `ZDNS_TTL`; apply `default` and `60`; reject missing credentials and non-numeric TTL; strip the API URL trailing slash; save effective mutable configuration.

- [ ] **Step 2: Implement zone discovery**

Probe each FQDN suffix with GET `/views/{view}/zones` and a JSON search body. Normalize the response and require an exact `resources.name` match before calculating the relative record owner.

- [ ] **Step 3: Implement add and remove operations**

POST the documented TXT record body for add. DELETE with `extend_ids:["fqdn.$TXT$value"]` for remove. JSON-escape interpolated strings and reject transport or API errors.

- [ ] **Step 4: Run test to verify it passes**

Run: `sh tmp/zdns_dnsapi_test.sh`

Expected: `PASS: dns_zdns provider contract` and exit code 0.

### Task 3: Verify Repository Quality

**Files:**
- Verify: `dnsapi/dns_zdns.sh`

- [ ] **Step 1: Check POSIX shell syntax**

Run: `sh -n dnsapi/dns_zdns.sh`

Expected: exit code 0 with no output.

- [ ] **Step 2: Run ShellCheck**

Run: `shellcheck -e SC2034 -e SC2154 dnsapi/dns_zdns.sh`

Expected: exit code 0 with no findings.

- [ ] **Step 3: Check formatting**

Run: `shfmt -d -i 2 dnsapi/dns_zdns.sh`

Expected: exit code 0 with no diff.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check && git diff -- dnsapi/dns_zdns.sh docs/superpowers`

Expected: no whitespace errors; diff contains only the provider and its design/plan documentation.
