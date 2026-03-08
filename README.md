# StoreShieldCriteria

**iOS App Store compliance criteria pack.** YAML configuration for risk scoring, risky/tracking SDK list, and sensitive API definitions. A manifest file points to a ZIP of the three YAMLs; tools that support this format can fetch the manifest, compare versions, and download the pack to update rules without an app update.

By **[Hangeul Studio](https://github.com/hangeulstudio)**.

---

## Contents

| File | Purpose |
|------|---------|
| **manifest.json** | Version, URL of the criteria ZIP, changelog. Read by clients to check for updates. |
| **risk_scoring.yaml** | Weights per issue type and risk thresholds (low/medium/high). |
| **risky_frameworks.yaml** | Framework names considered “risky” (tracking/analytics SDKs requiring Privacy Manifest per Apple). |
| **sensitive_apis.yaml** | Required-reason API types: symbols, `NSPrivacyAccessedAPIType`, reason codes. For detecting undeclared API usage in binaries. |

All lists and weights follow [Apple’s documentation](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files) (Privacy Manifests, Third-Party SDK requirements, Required Reason API). Headers in the YAML files cite sources and methodology.

---

## Manifest format

`manifest.json` should contain at least:

- `version` — Semantic version string (e.g. `2026.2.0`).
- `url` — Full URL to the criteria ZIP (e.g. a GitHub Release asset).
- `changelog` — Short description.

Clients use this to decide whether to download the ZIP and replace local criteria.

---

## ZIP layout

The criteria ZIP must contain these three files at the **root**:

- `risk_scoring.yaml`
- `risky_frameworks.yaml`
- `sensitive_apis.yaml`

Same layout as in this repo.

---

## Default manifest URL

The canonical manifest URL for this pack is:

```
https://raw.githubusercontent.com/hangeulstudio/StoreShieldCriteria/main/manifest.json
```

Updates to `manifest.json` on `main` (and a matching GitHub Release with `criteria.zip`) are used by clients that poll this URL.

---

## References

Apple sources referenced in the YAML headers:

- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Third-Party SDK Requirements](https://developer.apple.com/support/third-party-SDK-requirements/)
- [Privacy Manifest Files](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files)
- [Describing Use of Required Reason API](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api)

---

## License

See [LICENSE](LICENSE).
