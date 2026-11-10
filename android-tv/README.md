# Reddate for Android TV

The Android TV app. It runs Reddate's engine page (`/?tv=1`, see `public/tv.js`) in a hidden WebView for rooms, sync, chat and accounts, and draws Home, titles, search and settings natively (Jetpack Compose for TV):

- **`MainActivity`** hosts the page in a full-screen WebView. The remote's D-pad arrives in the page as
  arrow keys and Enter; **Back** is forwarded to the page so it can step back through its own screens.
- **`PlayerActivity`** is a native ExoPlayer (Media3) screen that plays what the TV's hardware can decode
  (MKV, HEVC, Dolby Digital…). The page keeps the room in sync: it sends play/pause/seek in, and the app
  reports what the viewer did with the remote back out.
- **`NativeBridge`** is what the page can call (`window.ReddateNative`): device name, exit, open/command the player.

## Build and run

Needs a JDK 17 and the Android SDK (platform 34, build-tools 34.0.0).

```bash
cd android-tv
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleDebug                 # app/build/outputs/apk/debug/app-debug.apk
```

Debug builds load `http://10.0.2.2:3090/?tv=1` (the Android emulator's address for your computer) so you can
run the Reddate server locally (`npm start`). To point at another address (for example a real TV on your Wi-Fi):

```bash
./gradlew installDebug -PstartUrl=http://192.168.1.20:3090/?tv=1
```

Release builds load `https://tv.reddate.xyz/?tv=1`.

For a self-hosted server, build a release with its public HTTPS address:

```bash
./gradlew assembleRelease -PreleaseUrl=https://your-service.onrender.com/?tv=1
```

Configure the release signing key as described below before installing the APK.
The app and browser must use the same server to join the same rooms.

## Install on a real TV

Turn on *Developer options → Network debugging* on the TV, then:

```bash
adb connect <tv-ip>:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Releasing

The release key lives outside the repository, in `~/.reddate/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). Bump `versionCode` and `versionName` in `app/build.gradle.kts`, then run `./release.sh "New: something|Home bugs fixed"`. It builds the signed APK, writes `downloads/version.json` and publishes the APK as a GitHub Release (needs the GitHub CLI signed in). The app reads version metadata from `/api/app-version`, then downloads through `https://tv.reddate.xyz/get` and verifies the published checksum. Self-hosted builds use `/get` on their configured server. Publishing source changes alone does not update the APK served by `/get`; publish the APK and matching version metadata together.

Never commit a signing keystore or `local.properties`.
