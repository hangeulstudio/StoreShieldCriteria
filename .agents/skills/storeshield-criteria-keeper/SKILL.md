---
name: storeshield-criteria-keeper
description: Use when changing StoreShieldCriteria public criteria packs, Criteria Keeper automation, manifests, checksums, signatures, or release workflows.
---

# StoreShield Criteria Keeper

Repo is public by design. Commit criteria, schemas, public keys, docs, workflows. Never commit private keys, Anthropic keys, GitHub tokens, signing secrets, or generated `node_modules`.

## Source policy

- Tier 1 Apple sources can change criteria.
- Community/SDK signals are watch signals only unless backed by Apple docs.
- Do not invent ITMS codes or Apple enforcement dates.

## Supply chain

`manifest.json` v2 must contain:

- `manifest_version`
- `version`
- release `url`
- per-file `checksums`
- Ed25519 `signature` over exact deterministic `criteria.zip`

`CRITERIA_SIGNING_KEY` lives only as GitHub Secret. Public key may be in repo/workflow/app.

## Validation

Preferred CI path:

```bash
bun install
bun run validate
git diff --check
```

Release must build zip with:

```bash
zip -X -j dist/criteria.zip sensitive_apis.yaml risky_frameworks.yaml risk_scoring.yaml
```

Then verify checksums and manifest signature before publishing release asset.
