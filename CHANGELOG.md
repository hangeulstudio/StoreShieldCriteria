# StoreShield Criteria Changelog

Human-readable changes for the public criteria pack. This file is safe to publish: it documents rule updates, Apple references, and release intent. It must not contain secrets, customer data, private app binaries, or internal tokens.

## 2026.6.1

Released: 2026-06-14

Summary:

- Removed the invalid `NSPrivacyAccessedAPICategoryLocation` Required Reason output path.
- Replaced `LocationUsage` with `LocationVisitTracking` as a `PrivacyPermission` heuristic for `CLGeocoder`, `CLVisit`, and visit monitoring symbols.
- Kept Required Reason API output limited to Apple's five official categories: File Timestamp, System Boot Time, Disk Space, Active Keyboards, and User Defaults.
- Marked symbol-based System Boot Time, Active Keyboards, and User Defaults detections as heuristics where compiler and SDK output can vary.
- Revalidated Apple's third-party SDK manifest list with no missing local entries; only the sync comment/checksum changed in `risky_frameworks.yaml`.
- Kept risky SDK detections and risk scoring rules unchanged.

Why it matters:

- Apple does not define a Location Required Reason API category, so generated privacy manifests must never contain `NSPrivacyAccessedAPICategoryLocation`.
- Location APIs remain privacy-sensitive, but StoreShield should route them to Info.plist/app privacy review guidance instead of PrivacyInfo.xcprivacy Required Reason declarations.
- This keeps the criteria pack aligned with the iOS 27 beta and Xcode 27 beta documentation refresh checked on June 14, 2026.

Apple references:

- Privacy Manifest Files: https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
- Describing Use of Required Reason API: https://developer.apple.com/documentation/bundleresources/describing_use_of_required_reason_api
- Third-Party SDK Requirements: https://developer.apple.com/support/third-party-SDK-requirements/

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
