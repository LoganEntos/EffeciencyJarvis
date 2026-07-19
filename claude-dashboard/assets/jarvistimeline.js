/* Jarvis tab — thread-timeline dots. One dot per turn in the LIVE #jconv
   chat: assets/jarvischat.js tags each user bubble with data-turn="N" and
   calls jarvisTimeline.render(turnCount) right after appending it (and on
   newChat(), with 0, to clear the strip). Click a dot → scrollIntoView the
   turn + a brief highlight flash; the → end-cap jumps to the latest message.
   Shows at most the 8 most recent turns. Split out of jarvistab.js to keep
   it under the repo's 500-line cap. Zero deps. */
'use strict';
(function () {
  function jumpTo(turnNo) {
    const feed = $('#jconv'); if (!feed) return;
    const el = turnNo != null ? feed.querySelector(`[data-turn="${turnNo}"]`) : null;
    if (!el) { feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' }); return; } // stale ref (tab re-render) — bottom is the safe fallback
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('jtl-hit');
    setTimeout(() => el.classList.remove('jtl-hit'), 900);
  }
  function render(turnCount) {
    const track = $('#jtlTrack'); if (!track) return;
    const total = Math.max(0, turnCount || 0);
    if (!total) { track.innerHTML = '<div class="jtl-line"></div>'; return; }
    const count = Math.min(8, total), start = total - count + 1;
    let dots = '<div class="jtl-line"></div>';
    for (let i = 0; i < count; i++) {
      const turnNo = start + i, pct = count === 1 ? 0 : (i / (count - 1)) * 92;
      dots += `<button class="jtl-dot${turnNo === total ? ' active' : ''}" style="left:${pct}%" data-turn="${turnNo}" title="jump to turn ${turnNo}"></button>`;
    }
    dots += '<button class="jtl-end" title="jump to the latest message">→</button>';
    track.innerHTML = dots;
    track.querySelectorAll('.jtl-dot').forEach(b => b.onclick = () => jumpTo(parseInt(b.dataset.turn, 10)));
    const end = track.querySelector('.jtl-end'); if (end) end.onclick = () => jumpTo(null);
  }
  window.jarvisTimeline = { render, jumpTo };
})();
