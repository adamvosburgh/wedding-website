// The schedule's navigation aids, added over the rendered markdown so the
// content file stays a plain schedule:
//
//   1. each day heading toggles its day; every day starts open, and a day
//      closes at midnight after it ends (New York time),
//   2. an arrow in the left margin at the current day, and at the event that
//      is happening now or is next,
//   3. the direction videos, one player with a button per video.
//
// For testing, ?now=2026-10-02T15:00 pretends it is that New York time.
(function () {
  const YEAR = 2026;
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];
  const schedule = document.querySelector('.schedule');

  const pad = (n) => String(n).padStart(2, '0');

  // "Thursday, October 1st" -> "2026-10-01".
  function dayIso(text) {
    const m = /([a-z]+)\s+(\d{1,2})/i.exec(text.split(',')[1] || '');
    const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
    return month === -1 ? null : `${YEAR}-${pad(month + 1)}-${pad(Number(m[2]))}`;
  }

  // "6:30pm: Dinner" and "5:30–8:30pm: Dinner" -> "18:30" and "17:30".
  function startTime(text) {
    const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?(?:\s*[–-]\s*\d{1,2}:\d{2}\s*(am|pm))?/i.exec(text.trim());
    if (!m) return null;
    let h = Number(m[1]) % 12;
    if ((m[3] || m[4] || '').toLowerCase() === 'pm') h += 12;
    return `${pad(h)}:${m[2]}`;
  }

  // Now in New York as "YYYY-MM-DDTHH:MM", so everything is string comparison.
  function nowNY() {
    const forced = new URLSearchParams(location.search).get('now');
    if (forced && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(forced)) return forced.slice(0, 16);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date()).map((p) => [p.type, p.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  // ---------------------------------------------------------------- days --
  function wrapDays() {
    const days = [];
    for (const h of [...schedule.querySelectorAll(':scope > h1')]) {
      // Collect first, wrap after: moving nodes while walking siblings loses
      // the rest of the day.
      const body = [];
      for (let n = h.nextElementSibling; n && n.tagName !== 'H1'; n = n.nextElementSibling) body.push(n);
      const section = document.createElement('section');
      section.className = 'day';
      h.replaceWith(section);
      section.append(h, ...body);

      h.classList.add('day-toggle');
      h.setAttribute('role', 'button');
      h.setAttribute('tabindex', '0');
      const toggle = () => setOpen(section, !section.classList.contains('open'));
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggle();
      });

      const iso = dayIso(h.textContent);
      const events = [...section.querySelectorAll(':scope > h2')]
        .map((el) => ({ el, time: startTime(el.textContent) }))
        .filter((e) => e.time)
        .map((e) => ({ el: e.el, at: `${iso}T${e.time}` }));
      days.push({ section, heading: h, iso, events });
    }
    return days;
  }

  function setOpen(section, open) {
    section.classList.toggle('open', open);
    section.querySelector('.day-toggle')?.setAttribute('aria-expanded', String(open));
  }

  const days = wrapDays();
  const events = days.flatMap((d) => d.events);
  let lastToday = null;

  function placeArrow(el) {
    const arrow = document.createElement('span');
    arrow.className = 'now-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '▶';
    el.prepend(arrow);
  }

  function update() {
    const now = nowNY();
    const today = now.slice(0, 10);

    // Open and closed are only ever set when the date changes, so a day a
    // guest opened or closed by hand stays that way until midnight.
    if (today !== lastToday) {
      for (const d of days) {
        const past = d.iso !== null && d.iso < today;
        d.section.classList.toggle('past', past);
        setOpen(d.section, !past);
      }
      lastToday = today;
    }

    // The day arrow: today, or the next day; after the last day, the last.
    const day = days.find((d) => d.iso >= today) || days[days.length - 1];
    // The event arrow: the latest one that has started today, else the next
    // one to start, else the last.
    const startedToday = events.filter((e) => e.at.slice(0, 10) === today && e.at <= now);
    const event =
      startedToday[startedToday.length - 1] || events.find((e) => e.at > now) || events[events.length - 1];

    for (const a of schedule.querySelectorAll('.now-arrow')) a.remove();
    if (day) placeArrow(day.heading);
    if (event) placeArrow(event.el);
  }

  update();
  setInterval(update, 30_000);

  // --------------------------------------------------------------- videos --
  const player = document.getElementById('videos');
  if (player) {
    const video = player.querySelector('video');
    const sources = JSON.parse(document.getElementById('video-sources').textContent);
    const buttons = [...player.querySelectorAll('button[data-video]')];

    const show = (id) => {
      const s = sources[id];
      if (!s) return;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.video === id));
      if (video.getAttribute('src') === s.src) return;
      video.pause();
      video.poster = s.poster;
      video.src = s.src;
      video.load();
    };

    for (const b of buttons) b.addEventListener('click', () => show(b.dataset.video));

    // "Here is a video..." links in the text pick that video and scroll to it.
    for (const a of schedule.querySelectorAll('a[data-video]')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        show(a.dataset.video);
        const day = player.closest('.day');
        if (day) setOpen(day, true);
        player.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }
})();
