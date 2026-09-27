# ishiguro-vosburgh.net

The schedule for our wedding weekend, as a single static page.

```
content/schedule.md      the copy
site/                    page template, styles, scripts, and web-sized media
originals/videos/        the full-size videos (gitignored)
scripts/build.js         renders the schedule into dist/
scripts/prepare-media.sh originals/videos/ -> site/media/videos/ (needs ffmpeg; run when a video changes)
```

```sh
npm install
npm run dev       # the public build, served at http://localhost:4173
npm run dev:alt   # the same, with the backup videos
npm run build     # the public build
```

Add `?now=2026-10-02T15:00` to the URL to see the page as it will look at that New York time.

## The backup videos

The rain-day and alternate-site videos are wired into the Friday player but
left out of the public build. To publish them, set the repository variable
`ALT_VIDEOS` (Settings → Secrets and variables → Actions → Variables) to
`rainday`, `altsite`, or `rainday,altsite`, then re-run the deploy workflow
(Actions → Deploy to GitHub Pages → Run workflow). Clear the variable and re-run
to take them down.
