// Store setup guide – every step to get a shop, restaurant, bar or butchery ready, in order.
import { GET, PUT, esc, $, $$, toast, err, page, can } from './core.js';
import { lang } from './i18n.js';

export async function guidePage(view) {
  if (!can('settings')) { view.innerHTML = page('Setup guide', '', '<div class="empty">Only an administrator can run the setup guide.</div>'); return; }
  const g = await GET('/setup-guide');
  draw(view, g);
}

function draw(view, g) {
  // Sesotho (or both languages) for the step texts
  const l = lang();
  if (l !== 'en') g = { ...g, steps: g.steps.map(x => x.st ? (l === 'st' ? { ...x, group: x.st.group, title: x.st.title, why: x.st.why, how: x.st.how } : { ...x, why_alt: x.st.why, how_alt: x.st.how, title_alt: x.st.title }) : x) };
  const pct = g.total ? Math.round(g.done / g.total * 100) : 0;
  const next = g.steps.find(x => !x.done && !x.optional) || g.steps.find(x => !x.done);
  const groups = [...new Set(g.steps.map(s => s.group))];
  let n = 0;
  view.innerHTML = page('Setup guide', '', `
    <div class="card guide-head">
      <div class="row wrap" style="gap:18px;align-items:center">
        <div style="flex:1;min-width:260px"><h3 style="margin:0 0 4px">${g.complete ? '🎉 Your business is ready to trade' : `Step by step: ${g.done} of ${g.total} done`}</h3>
          <div class="muted" style="font-size:13px">Work from top to bottom. Each step says <b>why</b> it matters and <b>what to enter</b>; “Open” takes you to the right screen. Steps tick themselves when the system sees the data.</div>
          <div class="gb-bar big" style="margin-top:10px"><span style="width:${pct}%"></span></div></div>
        <div><div class="muted" style="font-size:12px;margin-bottom:6px">This business is a… (tick all that apply)</div>
          <div class="row wrap" style="gap:6px">${g.all_types.map(t => `<label class="chip ${g.types.includes(t.key) ? 'on' : ''}" style="--c:#0d9488;cursor:pointer"><input type="checkbox" data-type="${t.key}" ${g.types.includes(t.key) ? 'checked' : ''} hidden> ${t.icon} ${esc(t.name)}</label>`).join('')}</div></div>
      </div>
      ${g.complete ? `<div class="row" style="margin-top:12px"><span class="muted">All required steps are done. Optional steps are still listed below.</span><span class="spacer"></span><button class="btn" id="gHide">${g.dismissed ? 'Show reminder on home screen' : 'Hide reminder from home screen'}</button></div>` : ''}
    </div>
    ${groups.map(gr => `<h3 class="guide-group">${esc(gr)}</h3>${g.steps.filter(s => s.group === gr).map(s => { n++; const isNext = next && s.key === next.key;
      return `<div class="guide-step ${s.done ? 'done' : ''} ${isNext ? 'next' : ''}" id="step-${s.key}">
        <div class="gs-num">${s.done ? '✓' : n}</div>
        <div class="gs-body"><div class="row wrap" style="gap:8px;align-items:baseline"><b class="gs-title">${esc(s.title)}</b>${s.title_alt && s.title_alt !== s.title ? ` <i class="muted">${esc(s.title_alt)}</i>` : ''}${s.optional ? '<span class="badge">optional</span>' : ''}${isNext ? '<span class="badge badge-posted">next step</span>' : ''}${s.manual ? '<span class="badge">tick when done</span>' : ''}</div>
          <div class="gs-why">${esc(s.why)}${s.why_alt ? `<br><i class="muted">${esc(s.why_alt)}</i>` : ''}</div>
          <small class="help-note">${esc(s.how)}${s.how_alt ? `<span class="help-alt">${esc(s.how_alt)}</span>` : ''}</small>
          ${s.note && !s.done ? `<div class="gs-warn">⚠ ${esc(s.note)}</div>` : ''}</div>
        <div class="gs-act"><a class="btn ${isNext ? 'btn-primary' : ''} btn-sm" href="${s.link}" data-open="${esc(s.title)}">Open →</a>
          ${s.done ? (s.manual ? `<button class="btn btn-sm" data-unmark="${s.key}">Undo</button>` : '') : `<button class="btn btn-sm" data-mark="${s.key}">${s.manual ? 'Mark done' : 'Already done'}</button>`}</div>
      </div>`; }).join('')}`).join('')}`);
  const save = async body => { try { draw(view, await PUT('/setup-guide', body)); } catch (e) { err(e); } };
  $$('[data-type]', view).forEach(i => i.onchange = () => {
    const types = $$('[data-type]', view).filter(x => x.checked).map(x => x.dataset.type);
    if (!types.length) { i.checked = true; return toast('Choose at least one type of business', 'err'); }
    save({ types });
  });
  $$('[data-open]', view).forEach(a => a.onclick = () => { try { sessionStorage.setItem('guideStep', a.dataset.open); } catch (_) {} });
  $$('[data-mark]', view).forEach(b => b.onclick = () => save({ mark: b.dataset.mark }));
  $$('[data-unmark]', view).forEach(b => b.onclick = () => save({ unmark: b.dataset.unmark }));
  const h = $('#gHide'); if (h) h.onclick = () => save({ dismissed: !g.dismissed });
  if (next) { const el = $('#step-' + next.key); if (el && el.getBoundingClientRect().top > window.innerHeight) el.scrollIntoView({ block: 'center' }); }
}

/** small "back to the guide" pill on the screen a guide step opened */
export function guideReturnPill() {
  let step = null; try { step = sessionStorage.getItem('guideStep'); } catch (_) {}
  let el = document.getElementById('guidePill');
  if (!step || location.hash.startsWith('#/guide')) { if (el) el.remove(); if (location.hash.startsWith('#/guide')) try { sessionStorage.removeItem('guideStep'); } catch (_) {} return; }
  if (!el) { el = document.createElement('a'); el.id = 'guidePill'; el.className = 'guide-pill'; document.body.appendChild(el); }
  el.href = '#/guide';
  el.innerHTML = `🧭 <span>Setup guide: <b>${esc(step)}</b></span> <span class="gp-back">← back to the guide</span>`;
}
