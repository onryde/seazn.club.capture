# Releasing to Google Play

A production release is the one build that is not made on this Mac (AGENTS §11;
owner, 2026-10-28: "Full EAS cloud", "only for prod release", "like we can tag then
trigger eas?"). A `v<version>` tag on main runs `.github/workflows/release.yml`.
The workflow checks the tag, runs the same checks as a pull request, and starts
an EAS build with `eas.json`'s `production` profile: an Android app bundle for
seazn.club, signed with the upload key EAS holds. EAS submits it to Play's
**internal testing** track when it is built, released to its testers
(`releaseStatus: completed`, which is also eas-cli's default). The track and
the status are the controller's choices, not the owner's: nothing reaches the
public until a person promotes it in Play Console.

Development and test builds stay local: Gradle and `adb`, as AGENTS §11 says.

## Once

Steps marked _owner_ need the owner's accounts.

1. **Expo token** (_owner_). The EAS project is `@onryde/capture`, in the
   `onryde` organisation (owner, 2026-10-28: "we want to use onryde"; moved
   from `@ashokhein/capture`, same project ID). expo.dev → `onryde` →
   Organization settings → Access tokens: make a robot user with the
   Developer role and a token for it. Add the token to GitHub as the
   repository secret `EXPO_TOKEN` (`gh secret set EXPO_TOKEN --repo
onryde/seazn.club.capture`).
2. **Upload key** (_owner_). Done: the upload key is EAS's default Android
   build credentials, `ycrj1dLXkY` (owner, 2026-10-28: "first one"), made by
   the September development builds. Exactly one keystore stays on EAS; a
   second one, made the same day, is to be deleted. Its fingerprint, which
   Play Console shows under App integrity after the first upload:

   ```
   SHA-256  B1:1E:80:4C:33:57:5D:5C:29:9A:30:99:A2:8B:06:E3:91:90:EF:AC:22:87:52:AA:E3:42:96:28:D1:EA:3B:39
   SHA-1    1A:03:29:A8:B6:08:D1:00:17:4E:FD:F5:7A:91:A6:B7:9D:8F:16:01
   ```

   `pnpm exec eas credentials -p android` (in a terminal of its own: it asks
   questions) → `production` → Download existing keystore keeps a backup,
   outside the repo with its passwords. Google holds the app signing key (Play
   App Signing), so a lost upload key can be reset through Play support.

3. **Play Console** (_owner_). A developer account; an organisation account if
   Seazn can have one, since a personal account opened after November 2023
   must run a closed test with 12 testers for 14 days before it can publish to
   production. Create the app as `com.seazn.capture`; Play fixes the package
   name at the first upload, and it can never change.
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
6. **Release environment** (_owner_, optional). The workflow's job runs in the
   GitHub environment `release`, which GitHub makes on its first run. Moving
   `EXPO_TOKEN` into that environment, with a rule that only `v*` tags may
   deploy, keeps the token from any other workflow.
7. **First release.** EAS's documentation says its first submission to an app
   that exists in Play Console makes the first internal release. If Play
   refuses it while the app is still a draft ("Only releases with status draft
   may be created on draft app"), download the app bundle from the build's
   page on expo.dev and upload it once by hand in Play Console → Testing →
   Internal testing. Later tags submit by themselves.

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
   The Action's log line "Build number" names the count. The build and the
   submission run on expo.dev (`@onryde/capture`, under Builds and
   Submissions).
4. **Test from Play.** Install it on a phone through the internal testing link.
   It talks to seazn.club, so pair it with a production stream code, go live
   once, and tap Send record to Seazn once, which has only been run against
   staging. Check the build number where the installed package reports it:
   the version code in Play Console's App bundle explorer, or the record's
   `appVersion`, which reads `1.0.0-<count>`. Home's footer reads the app's
   embedded config, so it would show the count even if the package did not.
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
