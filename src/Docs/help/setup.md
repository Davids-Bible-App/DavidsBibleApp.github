## Setting Up the Application

### 1 — Download

Head to the [Releases page](https://github.com/Davids-Bible-App/releases) and
grab the installer for your platform:

| Platform | File                      |
| -------- | ------------------------- |
| Windows  | `DBA_x.x.x_x64-setup.exe` |
| Android  | `DBA_x.x.x.apk`           |

### 2 — Install on Windows

1. Run the `.exe` installer.
2. Accept the prompt — the app is not yet code-signed, so Windows may warn you.
3. Launch **David's Bible App** from the Start menu.

### 3 — Install on Android

As I don't have 12 android testers for two weeks of testing, before uploading to the Play Store, we need to sideload the app.

1. Enable **Install from unknown sources** in _Settings → Security_.
2. Open the downloaded `.apk` and tap **Install**.
3. Launch the app from your home screen.

### 4 — Add Another Translation

1. Download a compatible `.sqlite` translation file (links on the GitHub wiki).
2. Open DBA → **Translations → Add Database**.

   ![setup 1](/images/setup_2026-05-21-23-43-16.webp)

3. Select the "Add Database" and navigate to where you downloaded the translations, select one or as many as needed.

### 5 — Add Audio

1. Download an audio package (`.zip`) from the wiki.
2. Go to **Settings → Audio Bibles → Import package**.
3. The audio player will activate automatically when audio is available for the
   current chapter.
