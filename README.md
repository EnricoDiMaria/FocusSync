# FocusSync

**Lightweight daily time limits for Instagram and YouTube, synchronized across your devices.**

FocusSync is a pair of browser userscripts. They track eligible time on Instagram and YouTube and store daily totals in your own [Upstash Redis](https://upstash.com/) database. Install the scripts in a userscript manager on each device and configure them with the same database credentials to share usage counters.

- No account or backend server operated by this project.
- No analytics or advertising.
- Separate daily counters for Instagram and YouTube.
- Configurable daily limits, sync intervals, and reset hours.
- Optional YouTube keyword exclusions.

> **Important:** FocusSync is a personal productivity aid, not tamper-proof parental-control or security software. Anyone who can edit or disable the userscript can bypass it. Because devices upload time in batches, small delays and limit overshoots are possible.

## Repository contents

```text
focussync/
├── scripts/
│   ├── focussync-instagram.user.js
│   └── focussync-youtube.user.js
├── LICENSE
└── README.md
```

## How it works

1. The userscript checks whether the relevant site is being used.
2. Eligible seconds are accumulated in a small local buffer.
3. The buffer is periodically uploaded to your Upstash Redis database using an atomic `INCRBY` operation.
4. Every configured device reads and increments the same daily key, sharing the counter.
5. When the configured limit is reached, the script displays a blocking screen or overlay.
6. Daily keys are assigned a 48-hour expiry to clean up old counters.

**Instagram:** counts while its tab is visible.  
**YouTube:** counts while a video on a watch or Shorts page is actively playing. Paused videos and hidden tabs are not counted. Videos matching an excluded keyword are not counted.

The daily key uses each device's local timezone and configured reset hour. Use consistent timezone settings and reset-hour values across devices.

## Requirements

- A browser that supports a userscript manager.
- A userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
- Your own Upstash Redis database with its REST URL and token.
- The same Upstash credentials and configuration on every device you want to synchronize.

**Mobile support:** Firefox for Android with Tampermonkey is recommended, based on personal testing and experience. Support on other mobile browsers may vary depending on their userscript extension capabilities.

## Setup

### 1. Create an Upstash Redis database

1. Create an account at [Upstash](https://upstash.com/).
2. Create a Redis database.
3. Open the database details.
4. Find the **REST API** section.
5. Copy the REST URL and REST token. Keep the token private.

Create your own database. Do not use credentials copied from another person's script or repository.

### 2. Configure the Instagram script

Open `scripts/focussync-instagram.user.js` in a text editor and replace:

```js
const REST_URL = 'https://YOUR-DATABASE.upstash.io';
const REST_TOKEN = 'YOUR_UPSTASH_REST_TOKEN';
```

with your own Upstash REST URL and token.

You can customize these settings:

```js
const DAILY_LIMIT_SECONDS = 15 * 60;
const SYNC_INTERVAL_SECONDS = 15;
const RESET_HOUR_LOCAL = 0;
```

- `DAILY_LIMIT_SECONDS`: daily allowance in seconds.
- `SYNC_INTERVAL_SECONDS`: how often accumulated seconds are uploaded.
- `RESET_HOUR_LOCAL`: local hour at which a new daily counter starts. `0` means midnight.

### 3. Configure the YouTube script

Replace the URL and token in `scripts/focussync-youtube.user.js` with the **same** Upstash credentials.

Example settings:

```js
const DAILY_LIMIT_SECONDS = 60 * 60;
const SYNC_INTERVAL_SECONDS = 10;
const RESET_HOUR_LOCAL = 1;

const EXCLUDED_KEYWORDS = [
    'tutorial',
    'programming',
    'guitar'
];
```

The keywords are examples only. Replace them with your own terms, or leave the array empty (`[]`) to count all videos.

A video is excluded when a keyword appears in its title, channel name, or page title. Matching is case-insensitive and uses simple substring matching.

### 4. Install the userscripts

1. Install Tampermonkey or Violentmonkey in your browser.
2. Open the userscript manager's dashboard.
3. Choose **Create a new script**.
4. Replace the editor contents with the full contents of the relevant `.user.js` file.
5. Save the script.
6. Repeat for the other script.

Install the scripts on every device you want to track. Use the same Upstash credentials and settings on all of them.

### 5. Verify synchronization

1. Open Instagram or play a YouTube video.
2. Use the site briefly.
3. In the Upstash database data browser or console, look for keys beginning with:
   - `focussync:instagram:`
   - `focussync:youtube:`
4. Open the same site on another configured device. Its counter should reflect usage already uploaded by the first device.

Synchronization happens in batches, so another device may take a few seconds to show the latest usage.

## Configuration reference

| Setting | Instagram default | YouTube default | Description |
|---|---:|---:|---|
| `DAILY_LIMIT_SECONDS` | `900` | `3600` | Daily time allowance |
| `SYNC_INTERVAL_SECONDS` | `15` | `10` | Upload interval in seconds |
| `RESET_HOUR_LOCAL` | `0` | `1` | Local reset hour |
| `EXCLUDED_KEYWORDS` | — | `[]` | YouTube title/channel terms excluded from tracking |

Keep settings consistent across devices. Different reset hours or timezones can cause devices to use different daily keys.

## Privacy and security

- Usage counters are stored in your own Upstash database.
- The scripts do not send browsing history, video titles, channel names, or Instagram content to Upstash. YouTube text is inspected locally only to evaluate keyword exclusions.
- Your Upstash token is stored in your local userscript. Never commit it to GitHub, include it in screenshots, or share it publicly.
- A userscript needs to send its token from the browser to access Upstash. Someone with access to your local script or browser environment may be able to retrieve it. Consider using a dedicated database for FocusSync and rotate the token if it is exposed.
- Each user should create and configure their own database. Never publish a shared personal token.

## Limitations

- **Best-effort timing:** time is uploaded in batches. A browser crash, device shutdown, network outage, or forced close can lose the most recent unsynced seconds.
- **Possible overshoot:** multiple devices can be active at once and each may have time buffered before the cloud counter updates.
- **Network required:** if Upstash cannot be reached, the scripts log an error and continue in fail-open mode. Enforcement is not guaranteed while offline.
- **Browser scope:** only matching pages where the userscript is running are monitored. Other apps, browsers, profiles, or devices without the scripts are not included.
- **YouTube exclusions are approximate:** they depend on text available in YouTube's page markup. Site changes may affect detection.
- **Not tamper-proof:** users can disable or edit the scripts, clear browser data, or use another browser.
- **Timezone consistency:** daily counters are based on each device's local clock and timezone.

## Troubleshooting

**The counter does not sync**
- Check that the REST URL and token are correct in both scripts.
- Confirm that the userscript manager is enabled for the site.
- Check the browser console for messages beginning with `[FocusSync]`.
- Make sure the network allows requests to your Upstash database.

**The limit differs between devices**
- Check that all devices use the same database, daily limit, reset hour, and timezone.
- Remember that each device may have a small amount of locally buffered time.

**YouTube exclusions do not work**
- Check the keyword spelling.
- Remember that matching checks the video title, channel name, and page title.
- YouTube can change its page structure, which may affect text detection.

## Contributing

Bug reports, suggestions, and pull requests are welcome. Do not include personal credentials, database URLs paired with tokens, or private usage data in issues.

When proposing changes, test both a fresh page load and in-page navigation where relevant.

## Credits and development note

Built for personal workflow optimization. The system design—including the usage-tracking logic, Redis synchronization approach, and YouTube filtering rules—was designed by the project author. The JavaScript implementation was developed with AI assistance.

## License

This project is released under the MIT License. See [LICENSE](LICENSE).
