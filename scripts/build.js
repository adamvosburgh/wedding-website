// Builds the site into dist/: renders content/schedule.md into the page
// template, wires the direction videos into a player, and copies the assets.
//
// The rain-day and alternate-site videos are left out unless asked for:
//   ALT_VIDEOS=rainday,altsite npm run build   (or ALT_VIDEOS=all)
// On GitHub this comes from the ALT_VIDEOS repository variable, see README.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const dist = join(root, 'dist');
const DOMAIN = 'ishiguro-vosburgh.net';

// Order is button order. `alt` videos are only built when ALT_VIDEOS names them.
const VIDEOS = [
  { id: 'subway', file: '1-subway-entrance', label: 'Subway to park entrance' },
  { id: 'pinelawn', file: '3-entrance-pinelawn', label: 'Park entrance to ceremony location' },
  { id: 'rainday', file: '4-rainday', label: 'Rain-day location', alt: true },
  { id: 'altsite', file: '5-alt-site', label: 'Alternate site', alt: true }
];

const altWanted = (process.env.ALT_VIDEOS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const videos = VIDEOS.filter(
  (v) => !v.alt || altWanted.includes('all') || altWanted.includes(v.id)
);

// A build that asks for a video the checkout does not have stops here rather
// than shipping a button that plays nothing.
for (const v of videos) {
  for (const ext of ['mp4', 'jpg']) {
    const file = join(site, `media/videos/${v.file}.${ext}`);
    if (!existsSync(file)) {
      throw new Error(`${v.id}: missing site/media/videos/${v.file}.${ext} (run npm run media, and commit it)`);
    }
  }
}

// ------------------------------------------------------------- content --
let md = readFileSync(join(root, 'content/schedule.md'), 'utf8');

// Everything above the first day heading is the email draft.
md = md.slice(md.search(/^# /m));

// The copy was written for the email; on the site nothing is attached.
// The sentence turns up as its own italic span, at the start of one, and at
// the end of one.
md = md
  .replace(/ \*It is also attached to this email\.\*/g, '')
  .replace(/ \*It is also attached to this email\. /g, ' *')
  .replace(/ It is also attached to this email\./g, '')
  // ...and the videos are right there on the page, just below.
  .replace(/Here is a video showing how/g, 'The video below shows how')
  .replace(/here is a video showing how/g, 'the video below shows how');

let html = marked.parse(md);

// Links to a Dropbox copy of a video play it in the player instead.
for (const v of VIDEOS) {
  const re = new RegExp(`<a href="[^"]*${v.file}\\.mp4[^"]*">`, 'g');
  html = html.replace(re, `<a href="#videos" data-video="${v.id}">`);
}

// Every other link opens in a new tab, so the schedule stays put.
html = html.replace(/<a href="http/g, '<a target="_blank" rel="noopener" href="http');

// The player goes right after the paragraph that mentions the videos.
const buttons = videos
  .map(
    (v, i) =>
      `<button type="button" data-video="${v.id}" aria-pressed="${i === 0}">${v.label}</button>`
  )
  .join('\n      ');
const sources = Object.fromEntries(
  videos.map((v) => [v.id, { src: `media/videos/${v.file}.mp4`, poster: `media/videos/${v.file}.jpg` }])
);
const player = `
<figure class="player" id="videos">
  <div class="player-buttons" role="group" aria-label="Choose a video">
      ${buttons}
  </div>
  <div class="player-frame">
    <video controls playsinline preload="metadata"
      src="${sources[videos[0].id].src}" poster="${sources[videos[0].id].poster}"></video>
  </div>
  <script type="application/json" id="video-sources">${JSON.stringify(sources)}</script>
</figure>`;
const anchor = html.indexOf('data-video="pinelawn"');
if (anchor === -1) throw new Error('Could not find where the videos are mentioned in schedule.md');
const at = html.indexOf('</p>', anchor) + '</p>'.length;
html = html.slice(0, at) + player + html.slice(at);

// ---------------------------------------------------------------- write --
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'media/videos'), { recursive: true });

const page = readFileSync(join(site, 'index.html'), 'utf8').replace('<!-- schedule -->', html);
writeFileSync(join(dist, 'index.html'), page);
writeFileSync(join(dist, 'CNAME'), DOMAIN + '\n');

for (const f of ['style.css', 'app.js', 'flowers.js']) cpSync(join(site, f), join(dist, f));
for (const v of videos) {
  for (const ext of ['mp4', 'jpg']) {
    cpSync(join(site, `media/videos/${v.file}.${ext}`), join(dist, `media/videos/${v.file}.${ext}`));
  }
}

console.log(`Built dist/ with videos: ${videos.map((v) => v.id).join(', ')}`);
