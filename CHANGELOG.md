# StoreShield Criteria Changelog

Human-readable changes for the public criteria pack. This file is safe to publish: it documents rule updates, Apple references, and release intent. It must not contain secrets, customer data, private app binaries, or internal tokens.

## 2026.5.1

Released: 2026-05-15

Summary:

- Added ad network and attribution SDK families to `risky_frameworks.yaml`: AppLovin, InMobi, IronSource, MoPub, and OathSDK.
- Added the `LocationUsage` sensitive API group to `sensitive_apis.yaml`, covering `CLGeocoder` and `CLVisit` signals.
- Kept risk scoring thresholds unchanged.

Why it matters:

- These SDK and location signals can affect App Review, privacy manifests, tracking disclosure, and Required Reason API review.
- StoreShield should surface them as review risk unless there is direct Apple upload-blocking evidence.
- Findings that come from symbol or substring detection must remain worded as heuristics and ask the developer to verify call sites.

Apple references:

- Privacy Manifest Files: https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
- Describing Use of Required Reason API: https://developer.apple.com/documentation/bundleresources/describing_use_of_required_reason_api
- Third-Party SDK Requirements: https://developer.apple.com/support/third-party-SDK-requirements/

## 2026.3.1

Released: 2026-03-01

Summary:

- Baseline criteria pack for StoreShield 1.0.
- Includes privacy manifest checks, risky SDK matching, sensitive API groups, and risk scoring thresholds.

Apple references:

- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Privacy Manifest Files: https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
- Describing Use of Required Reason API: https://developer.apple.com/documentation/bundleresources/describing_use_of_required_reason_api
