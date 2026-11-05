# Maluti ERP for Android

The Android app is a window onto **your own Maluti ERP server** – the shop PC on the Wi-Fi, or the hosted web version.
It stores only the server address on the phone. Everything else (the till, stock, invoices, tax…) runs on the server,
exactly like on the PC, and screens adapt to the phone.

## Getting the APK
GitHub builds it automatically (`.github/workflows/build-android.yml`) and attaches `MalutiERP-<version>.apk` to each release.
Install it on the phone (allow "install unknown apps" for the browser / file manager once).

Without the APK, any Android phone can also use **Chrome → open the server address → ⋮ → Install app** (it is a PWA).

## First start
Type the address shown on the shop PC under *Settings → Company → receipt QR* (for example `192.168.1.20:8069`), or the
hosted address (`https://erp.mybusiness.co.ls`). The phone must be on the shop Wi-Fi for a PC address.
To change server later, clear the app's storage or open it with `?change=1`.

## Signed release builds
Add these repository secrets and the workflow signs the APK for the Play Store / MDM:
`ANDROID_KEYSTORE_BASE64` (base64 of the .jks), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Without them a debug-signed APK is built (fine for installing directly).

## Building on a PC
Node 20, JDK 17 and the Android SDK:
```
cd mobile
npm install
npx cap add android
npx capacitor-assets generate --android
npx cap sync android
cd android && ./gradlew assembleDebug
```
