# Releasing to Google Play

A production release is the one build that is not made on this Mac (AGENTS §11;
owner, 2026-10-28: "Full EAS cloud", "only for prod release"). A `v<version>`
tag on main runs `.github/workflows/release.yml`. The workflow checks the tag,
runs the same checks as a pull request, and starts an EAS build with
`eas.json`'s `production` profile: an Android app bundle for seazn.club, signed
with the upload key EAS holds. EAS submits it to Play's **internal testing**
track when it is built. Promoting it further is done by hand in Play Console.

Development and test builds stay local: Gradle and `adb`, as AGENTS §11 says.

## Once

Steps marked _owner_ need the owner's accounts.

1. **Expo token** (_owner_). expo.dev → Account settings → Access tokens →
   create one. Add it to GitHub as the repository secret `EXPO_TOKEN`
   (Settings → Secrets and variables → Actions).
2. **Upload key** (_owner_). `pnpm exec eas credentials -p android`, choose
   the `production` profile, and let EAS generate the keystore. EAS keeps it;
   download a backup from the same menu and store it outside the repo. Google
   holds the app signing key (Play App Signing), so a lost upload key can be
   reset through Play support.
3. **Play Console** (_owner_). A developer account; an organisation account if
   Seazn can have one, since a personal account opened after November 2023
   must run a closed test with 12 testers for 14 days before it can publish to
   production. Create the app as `com.seazn.capture`.
4. **Store listing and policy forms** (_owner_):
   - app icon 512 × 512 (from `assets/icon.png`), a feature graphic
     1024 × 500, and 2–8 phone screenshots of the app only;
   - a privacy policy URL;
   - Data safety: camera and microphone, which stream to the organiser's
     broadcast, and the session record, sent to Seazn only on the operator's
     tap; no accounts;
   - the foreground service declaration for the `camera` and `microphone`
     types, with a short video of a broadcast running with the phone locked;
   - the content rating questionnaire, the target audience, and no ads.
5. **Play service account** (_owner_). Create a Google Cloud service account
   with a JSON key and invite it in Play Console (Users and permissions) with
   release rights for this app (<https://expo.fyi/creating-google-service-account>).
   Upload the key with `pnpm exec eas credentials -p android` → Google Service
   Account. EAS Submit then uses it; the key never enters the repo.

## Each release

1. **Version.** In a pull request, raise `version` in `app.json` (it is
   `1.0.0` until the first release). Each tag can be pushed once, so each
   release has its own version. The build number is the commit count, so it
   always goes up.
2. **Tag main** once the pull request has merged:

   ```sh
   git checkout main && git pull --ff-only
   git tag v1.0.0
   git push origin v1.0.0
   ```

   The workflow refuses a tag that does not match `app.json`'s version or is
   not on main.

3. **Watch it.** The GitHub Action ends once EAS has the build (`--no-wait`).
   The build and the submission run on expo.dev (project `capture`, under
   Builds and Submissions). The log line "Build number" names the count.
4. **Test from Play.** Install it on a phone through the internal testing link.
   It talks to seazn.club, so pair it with a production stream code, go live
   once, and check the footer's `1.0.0-<count>`.
5. **Promote** in Play Console: to closed testing, or to production with a
   staged rollout. Shipping to production is a product decision: today the
   app is Live Stream only (AGENTS §1).

## Why the build number is pinned

EAS uploads a shallow clone of the repo (depth 1), so `git rev-list --count`
on its worker is 1. The workflow counts on its full checkout and writes the
count to `build-number.txt`, untracked, which EAS uploads with the project.
`app.config.ts` reads that file before git, and refuses an EAS build without
it (`test/appConfig.test.ts`). Never commit the file and never add it to
`.gitignore`: EAS leaves a gitignored file out of its upload.
