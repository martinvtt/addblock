# Changelog

## 0.5.1 — 2026-10-29

- Add conservative Outlook Web advertising-row hiding using separate Pub/Ad badges.
- Preserve pause/restoration and support dynamic and recycled list rows.
- Add synthetic browser coverage; live Outlook layout validation remains pending.

## 0.5.0 — 2026-10-28

- Repair the popup's missing sources/privacy page; include uninstall and recovery help.
- Add an English privacy policy and MIT license for original project code.
- Produce repeatable, allowlisted runtime/source ZIPs with SHA-256 checksums.
- Remove debug-feedback permission from the runtime distribution. Keep detailed
  network logs in the source/development build only; native badge and cosmetic
  counts remain available in the distribution build.
- Explain diagnostic restrictions without reporting a misleading filtering failure.
- Add packaging checks and browser coverage for the actual distributed artifact.

This release is for manual installation in Chrome Developer mode. Chrome Web Store
submission, a public listing/privacy URL, and broad real-site compatibility
validation are not included. Controlled tests do not measure an overall ad-block rate.
