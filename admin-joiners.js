// ── NEW JOINERS (admin) ─────────────────────────────────────────────────────
// New joiner training tracking: replaces the Onboarding Master file tabs (KPI Timeline,
// Onboarding Report, Buddy Report, Week 5-10). Tables + views: new-joiner-tracking.sql.
// Everything here is admin-only in the database (RLS checks the admin account), and
// quality %, average score, QA % and RAG come from the views — they are never stored.
// Weeks are working weeks, Mon–Fri: week 1 is the week the joiner starts in.

// The "Draft summary" button posts that week's ticket feedback here (n8n → Claude) and gets
// back {strengths, areas_to_improve, next_steps}. Separate from the simulator scorer.
const NJ_DRAFT_WEBHOOK = 'https://aiwellbeing.app.n8n.cloud/webhook/nj-draft-summary';

const NJ_PHASES = [
  { label: 'Onboarding', from: 1, to: 2 },
  { label: 'Buddying', from: 3, to: 4 },
  { label: 'Probation', from: 5, to: 10 },
];
const NJ_STATUSES = ['onboarding', 'buddying', 'probation', 'passed', 'left'];
const NJ_METRIC_FIELDS = [
  ['tickets_logged', 'Tickets logged'], ['tickets_scored', 'Tickets scored'],
  ['score_3s', 'Score 3s'], ['score_2s', 'Score 2s'], ['score_1s', 'Score 1s'],
  ['messages_sent', 'Messages sent'], ['qa_mentions', 'QA mentions'], ['calls_done', 'Calls done'],
];
const NJ_REVIEW_FIELDS = [
  ['strengths', 'Strengths'], ['areas_to_improve', 'Areas to improve'],
  ['progress_summary', 'Progress summary'], ['next_steps', 'Next steps'],
];

const nj = { overview: [], targets: [], stats: [], reviews: [], scores: {}, view: 'list', agentId: null, filter: 'active', loaded: false };

const njEsc = v => escHtml(v == null ? '' : String(v));
const njDate = s => { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const njIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const njMonday = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };
const njWeekStart = (start, week) => { const m = njMonday(njDate(start)); m.setDate(m.getDate() + (week - 1) * 7); return m; };
const njFmt = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const njWeekRange = (start, week) => { const a = njWeekStart(start, week); const b = new Date(a); b.setDate(b.getDate() + 4); return `${njFmt(a)} – ${njFmt(b)}`; };
const njTarget = w => nj.targets.find(t => t.week === Math.min(Math.max(w, 1), 11)) || {};
const njStat = (agentId, w) => nj.stats.find(s => s.agent_id === agentId && s.week === w);
const njReview = (agentId, w) => nj.reviews.find(r => r.agent_id === agentId && r.week === w);
const njAgent = id => nj.overview.find(a => a.id === id);
const njPhaseLabel = w => w < 1 ? 'Not started' : w <= 2 ? 'Onboarding' : w <= 4 ? 'Buddying' : w === 5 ? 'TL handover · Probation' : w <= 10 ? 'Probation' : 'Probation ended';

function njRagDot(rag, title) {
  const c = { green: '#00a862', amber: '#e0a100', red: '#e9004a' }[rag] || '#d4d1cd';
  return `<span class="nj-dot" style="background:${c}" title="${njEsc(title || rag || 'No data')}"></span>`;
}
function njRagChip(rag, text) {
  return `<span class="nj-rag nj-rag-${rag || 'none'}">${njRagDot(rag)}${njEsc(text || (rag ? rag[0].toUpperCase() + rag.slice(1) : 'No data'))}</span>`;
}
function njStatSummary(s) {
  if (!s) return 'No data yet';
  const bits = [];
  if (s.messages_sent != null) bits.push(`${s.messages_sent} msgs`);
  if (s.quality_pct != null) bits.push(`${s.quality_pct}% 3s`);
  if (s.qa_pct != null && s.week >= 5) bits.push(`QA ${s.qa_pct}%`);
  return bits.join(' · ') || 'Review only';
}

async function loadJoiners() {
  const [ov, tg, st, rv] = await Promise.all([
    db.from('nj_agent_overview').select('*').order('start_date', { ascending: false }),
    db.from('kpi_targets').select('*').order('week'),
    db.from('nj_week_stats').select('*'),
    db.from('weekly_reviews').select('*'),
  ]);
  const err = ov.error || tg.error || st.error || rv.error;
  if (err) {
    document.getElementById('nj-root').innerHTML = `<div class="card"><div style="padding:18px;color:#706f6e">New joiner tracking isn't set up yet. Run <b>new-joiner-tracking.sql</b> in the Supabase SQL editor, then reload. <span style="color:#a3a19e">(${njEsc(err.message)})</span></div></div>`;
    return;
  }
  nj.overview = ov.data || []; nj.targets = tg.data || []; nj.stats = st.data || []; nj.reviews = rv.data || [];
  nj.loaded = true;
  renderJoiners();
}

function renderJoiners() {
  if (!nj.loaded) return;
  if (nj.view === 'agent' && njAgent(nj.agentId)) renderJoinerAgent();
  else { nj.view = 'list'; renderJoinerList(); }
}

// ── Cohort view ─────────────────────────────────────────────────────────────
const NJ_DONE = a => ['passed', 'left'].includes(a.status);
const NJ_AVATAR = ['#efe9fb', '#e6f4ec', '#fdf1e1', '#e8f0fb', '#fbe9ee', '#eef0f2'];
function njAvatar(a, size) {
  const ini = a.name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
  const bg = NJ_AVATAR[a.id % NJ_AVATAR.length];
  return `<span class="nj-ava" style="background:${bg};width:${size || 34}px;height:${size || 34}px;font-size:${(size || 34) * 0.38}px">${njEsc(ini)}</span>`;
}
function njStrip(a) {
  let h = '';
  for (let w = 1; w <= 10; w++) {
    const s = njStat(a.id, w), r = njReview(a.id, w), future = w > a.current_week;
    const cls = s && s.rag ? s.rag : (s || r) ? 'done' : future ? 'future' : 'empty';
    h += `<span class="nj-pill nj-pill-${cls} ${w === a.current_week ? 'cur' : ''}" title="Week ${w}: ${njEsc(s ? njStatSummary(s) : r ? 'Review only' : future ? 'Not reached yet' : 'Nothing entered')}"></span>`;
  }
  return `<span class="nj-strip">${h}</span>`;
}
function njLatestLine(a) {
  const s = a.latest_week ? njStat(a.id, a.latest_week) : null;
  if (!s) return '<span class="nj-muted">No numbers yet</span>';
  const t = njTarget(s.week), bits = [];
  if (s.messages_sent != null) bits.push(`<b>${s.messages_sent}</b>${t.goal_messages ? `<span class="nj-muted"> / ${t.goal_messages}</span>` : ''} msgs`);
  if (s.quality_pct != null) bits.push(`<b>${s.quality_pct}%</b>${t.quality_target_pct ? `<span class="nj-muted"> / ${t.quality_target_pct}%</span>` : ''} 3s`);
  if (s.qa_pct != null && s.week >= 5) bits.push(`QA <b>${s.qa_pct}%</b>`);
  return `${njRagDot(s.rag)}<span>Wk ${s.week} · ${bits.join(' · ') || 'review only'}</span>`;
}
function njPersonRow(a) {
  const flag = a.probation_flag && !NJ_DONE(a);
  return `<div class="nj-person ${NJ_DONE(a) ? 'done' : ''}" onclick="njOpenAgent(${a.id})">
    ${njAvatar(a)}
    <div class="nj-p-name"><div class="nj-p-n">${njEsc(a.name)}</div>
      <div class="nj-muted">Started ${njFmt(njDate(a.start_date))}${a.cohort ? ' · ' + njEsc(a.cohort) : ''}</div></div>
    <div class="nj-p-strip">${njStrip(a)}<div class="nj-muted" style="margin-top:5px">${NJ_DONE(a) ? (a.status === 'left' ? 'Left' : 'Passed probation') : a.current_week > 0 ? `Week ${a.current_week} · ${njEsc(njPhaseLabel(a.current_week))}` : 'Starts soon'}</div></div>
    <div class="nj-p-latest">${njLatestLine(a)}</div>
    <div class="nj-p-flag">${flag ? '<span class="nj-flag">⚑ Below minimum</span>' : ''}<span class="nj-chev">›</span></div>
  </div>`;
}
function njSetPage(p) { nj.page = p; renderJoinerList(); }
function renderJoinerList() {
  const page = nj.page || 'people';
  const active = nj.overview.filter(a => !NJ_DONE(a)).sort((x, y) => (y.start_date > x.start_date ? 1 : -1));
  const done = nj.overview.filter(NJ_DONE).sort((x, y) => (y.start_date > x.start_date ? 1 : -1));
  const flagged = active.filter(a => a.probation_flag).length;
  const onTrack = active.filter(a => a.latest_rag === 'green').length;
  const people = `
    <div class="stat-tiles">
      <div class="stat-tile"><div class="v">${active.length}</div><div class="l">In training</div></div>
      <div class="stat-tile"><div class="v" style="color:#00834f">${onTrack}</div><div class="l">On track this week</div></div>
      <div class="stat-tile"><div class="v" style="color:${flagged ? '#d9003e' : '#1b1c1d'}">${flagged}</div><div class="l">Below probation minimum</div></div>
      <div class="stat-tile"><div class="v">${done.length}</div><div class="l">Completed</div></div>
    </div>
    <div class="nj-legend-row"><span>Weeks 1–10:</span>
      <span><span class="nj-pill nj-pill-green"></span>On target</span><span><span class="nj-pill nj-pill-amber"></span>Close</span>
      <span><span class="nj-pill nj-pill-red"></span>Below</span><span><span class="nj-pill nj-pill-done"></span>Review only</span>
      <span><span class="nj-pill nj-pill-empty"></span>Nothing entered</span><span><span class="nj-pill nj-pill-future"></span>Not reached</span></div>
    <div class="nj-group-h">In training <span class="nj-muted">${active.length}</span></div>
    <div class="card nj-list">${active.map(njPersonRow).join('') || '<div class="nj-empty">Nobody in training right now.</div>'}</div>
    <div class="nj-group-h">Completed <span class="nj-muted">${done.length}</span></div>
    <div class="card nj-list">${done.map(njPersonRow).join('') || '<div class="nj-empty">Nobody has completed yet.</div>'}</div>`;
  document.getElementById('nj-root').innerHTML = `
    <div class="section-header">
      <div><div class="section-title">New Joiners</div>
        <div class="section-sub">Each new joiner's 10-week journey against the KPI expectations. Admin login only.</div></div>
      <div style="display:flex;gap:10px;align-items:center">
        <div class="nj-seg"><button class="${page === 'people' ? 'on' : ''}" onclick="njSetPage('people')">People</button><button class="${page === 'kpi' ? 'on' : ''}" onclick="njSetPage('kpi')">KPI expectations</button></div>
        <button class="btn btn-primary" onclick="njShowAdd()">+ Add new joiner</button></div>
    </div>
    <div class="card" id="nj-add" style="display:none;margin-bottom:20px"></div>
    ${page === 'kpi' ? njKpiHtml() : people}`;
}

// ── KPI expectations (kpi_targets) ──────────────────────────────────────────
function njKpiHtml() {
  const phaseName = { onboarding: 'Onboarding', buddying: 'Buddying', probation: 'Probation', passed: 'Probation ended' };
  const rows = nj.targets.map(t => `<tr>
      <td><b>Week ${t.week}</b></td>
      <td><span class="nj-phase nj-phase-${t.phase}">${phaseName[t.phase] || njEsc(t.phase)}</span>${t.week === 5 ? ' <span class="nj-tl-tag">TL handover</span>' : ''}</td>
      <td>${t.goal_messages ? `<b>${t.goal_messages}${t.week === 11 ? '+' : ''}</b>${t.min_messages && t.min_messages !== t.goal_messages ? `<span class="nj-muted"> · min ${t.min_messages}</span>` : t.min_messages ? '<span class="nj-muted"> · minimum to pass</span>' : ''}` : '<span class="nj-muted">—</span>'}</td>
      <td>${t.quality_target_pct ? `<b>${t.quality_target_pct}%</b> <span class="nj-muted">of scored tickets are 3s</span>` : '<span class="nj-muted">—</span>'}</td>
      <td>${t.qa_mentions_max_pct ? `under <b>${t.qa_mentions_max_pct}%</b>` : '<span class="nj-muted">—</span>'}</td>
      <td>${t.calls_target ? `<b>${t.calls_target}</b>${t.week === 10 ? '<span class="nj-muted"> in total</span>' : ''}` : '<span class="nj-muted">—</span>'}</td>
      <td class="nj-muted" style="white-space:normal">${njEsc(t.notes || '')}</td></tr>`).join('');
  return `<div class="card"><table class="nj-kpi">
      <thead><tr><th>Week</th><th>Phase</th><th>Messages a week</th><th>Quality</th><th>QA mentions</th><th>Calls</th><th>What happens</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="card" style="padding:16px 18px"><div class="card-title" style="margin-bottom:8px">How the colours are worked out</div>
      <div class="nj-rules">
        <div>${njRagDot('green')}<b>On target</b> · messages at or above the goal, quality at or above 90%, QA mentions under 5%</div>
        <div>${njRagDot('amber')}<b>Close</b> · messages between the minimum and the goal, or quality 80–89%</div>
        <div>${njRagDot('red')}<b>Below</b> · messages under the minimum, quality under 80%, or QA mentions 5% or more</div>
        <div style="margin-top:6px" class="nj-muted">Weeks 1–2 have no KPI. Weeks run Monday to Friday; week 1 is the week someone starts. The probation flag shows when the latest week from week 5 on is below that week's minimum or QA is 5%+. Quality % = score 3s ÷ tickets scored.</div>
      </div></div>`;
}

function njAgentFormHtml(a, mode) {
  a = a || {};
  return `<div class="card-header"><span class="card-title">${mode === 'edit' ? 'Edit details' : 'New joiner'}</span>
      <button class="btn btn-outline btn-sm" onclick="${mode === 'edit' ? 'renderJoinerAgent()' : "document.getElementById('nj-add').style.display='none'"}">Cancel</button></div>
    <div style="padding:18px"><div class="form-grid">
      <div><label>Name</label><input type="text" id="nja-name" value="${njEsc(a.name)}" placeholder="Ceyda" /></div>
      <div><label>Start date</label><input type="date" id="nja-start" value="${njEsc(a.start_date)}" style="width:100%;padding:8px 11px;border:1px solid #e8e5e2;border-radius:7px;margin-bottom:12px;font-family:inherit" /></div>
      <div><label>Cohort</label><input type="text" id="nja-cohort" value="${njEsc(a.cohort)}" placeholder="Group 8 / 13th Oct" /></div>
      <div><label>Buddy</label><input type="text" id="nja-buddy" value="${njEsc(a.buddy)}" placeholder="Denise" /></div>
      <div><label>Team lead</label><input type="text" id="nja-tl" value="${njEsc(a.team_lead)}" /></div>
      <div><label>Learning style</label><input type="text" id="nja-ls" value="${njEsc(a.learning_style)}" /></div>
      <div><label>Gorgias user ID <span style="font-weight:400;color:#a3a19e">(for the weekly auto-fill)</span></label><input type="text" id="nja-gid" value="${njEsc(a.gorgias_user_id)}" placeholder="e.g. 753709540 (the number in their Gorgias profile link)" /></div>
      <div><label>Status</label><select id="nja-status">${NJ_STATUSES.map(s => `<option ${s === (a.status || 'onboarding') ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    </div><button class="btn btn-primary" onclick="njSaveAgent(${mode === 'edit' ? a.id : 'null'})">${mode === 'edit' ? 'Save details' : 'Add new joiner'}</button></div>`;
}
function njShowAdd() { const el = document.getElementById('nj-add'); el.innerHTML = njAgentFormHtml(null, 'add'); el.style.display = 'block'; }
async function njSaveAgent(id) {
  const v = f => document.getElementById(f).value.trim() || null;
  const row = { name: v('nja-name'), start_date: v('nja-start'), cohort: v('nja-cohort'), buddy: v('nja-buddy'),
                team_lead: v('nja-tl'), learning_style: v('nja-ls'), status: v('nja-status') };
  const gid = v('nja-gid');
  if (gid && !/^\d+$/.test(gid)) { toast('Gorgias user ID should be a number'); return; }
  row.gorgias_user_id = gid ? Number(gid) : null;
  if (!row.name || !row.start_date) { toast('Name and start date are needed'); return; }
  const res = id ? await db.from('agents').update(row).eq('id', id).select('id') : await db.from('agents').insert(row).select('id');
  if (res.error || !(res.data || []).length) { toast('Could not save: ' + ((res.error && res.error.message) || 'no permission')); return; }
  toast(id ? 'Saved ✓' : 'New joiner added ✓');
  if (!id) { nj.view = 'agent'; nj.agentId = res.data[0].id; }
  await loadJoiners();
}

// ── Agent page ──────────────────────────────────────────────────────────────
async function njOpenAgent(id) {
  nj.view = 'agent'; nj.agentId = id;
  renderJoinerAgent();
  await njLoadScores(id);
  renderJoinerAgent();
}
function njBack() { nj.view = 'list'; nj.agentId = null; renderJoinerList(); }
async function njLoadScores(id) {
  const { data } = await db.from('ticket_scores').select('*').eq('agent_id', id).order('date', { ascending: false });
  nj.scores[id] = data || [];
}
function njScoresInWeek(a, w) {
  const from = njWeekStart(a.start_date, w), to = new Date(from); to.setDate(to.getDate() + 7);
  return (nj.scores[a.id] || []).filter(s => { const d = njDate(s.date); return d >= from && d < to; });
}

function njTimelineHtml(a) {
  const cells = [];
  for (let w = 1; w <= 10; w++) {
    const s = njStat(a.id, w), r = njReview(a.id, w), t = njTarget(w);
    const cur = w === a.current_week, future = w > a.current_week;
    let main = '<span class="nj-muted">—</span>', sub = '';
    if (s && s.messages_sent != null) { main = `<b>${s.messages_sent}</b>${t.goal_messages ? `<span class="nj-muted"> / ${t.goal_messages}</span>` : ''}`; sub = 'messages'; }
    else if (s && s.quality_pct != null) { main = `<b>${s.quality_pct}%</b>${t.quality_target_pct ? `<span class="nj-muted"> / ${t.quality_target_pct}%</span>` : ''}`; sub = 'scored 3'; }
    else if (r) { main = '<span class="nj-muted">Review only</span>'; }
    cells.push(`<div class="nj-wk ${cur ? 'cur' : ''} ${future ? 'future' : ''} nj-wk-${(s && s.rag) || 'none'}" onclick="njOpenEntry(${w})" title="Enter or edit week ${w}">
      <div class="nj-wk-n">Week ${w}${cur ? '<span class="nj-now">now</span>' : ''}</div>
      <div class="nj-wk-d">${njWeekRange(a.start_date, w)}</div>
      <div class="nj-wk-v">${main}</div><div class="nj-wk-s">${sub}${w === 5 ? (sub ? ' · ' : '') + 'TL handover' : ''}</div>
    </div>`);
  }
  const bands = NJ_PHASES.map(p => `<div class="nj-band nj-band-${p.label.toLowerCase()}" style="grid-column:${p.from} / ${p.to + 1}">${p.label}</div>`).join('');
  return `<div class="nj-tl"><div class="nj-bands">${bands}</div><div class="nj-weeks">${cells.join('')}</div></div>`;
}

function njTargetText(t) {
  return [t.goal_messages ? `${t.goal_messages}${t.min_messages && t.min_messages !== t.goal_messages ? ` (min ${t.min_messages})` : ''} msgs` : '',
          t.quality_target_pct ? `${t.quality_target_pct}% 3s` : '', t.qa_mentions_max_pct ? `QA < ${t.qa_mentions_max_pct}%` : '',
          t.calls_target ? `${t.calls_target} call${t.calls_target > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || 'No KPI';
}
function njActualText(s) {
  if (!s) return '<span class="nj-muted">—</span>';
  return [s.messages_sent != null ? `<b>${s.messages_sent}</b> msgs` : '',
          s.tickets_scored != null ? `<b>${s.quality_pct ?? '–'}%</b> 3s <span class="nj-muted">(${s.score_3s ?? '–'}/${s.score_2s ?? '–'}/${s.score_1s ?? '–'} of ${s.tickets_scored})</span>` : '',
          s.qa_pct != null && s.qa_mentions != null ? `QA <b>${s.qa_pct}%</b> <span class="nj-muted">(${s.qa_mentions})</span>` : '',
          s.calls_done != null ? `<b>${s.calls_done}</b> calls` : ''].filter(Boolean).join(' · ') || '<span class="nj-muted">—</span>';
}
// Written reviews (strengths, areas to improve…) are only kept for onboarding and buddying, weeks 1–4.
// Probation weeks (5–10) are numbers only.
const NJ_HAS_REVIEW = w => w <= 4;
function njToggleWeek(w) { if (!NJ_HAS_REVIEW(w)) return;
  const el = document.getElementById('nj-wr-' + w); if (el) el.classList.toggle('open'); }
function njWeekRowHtml(a, w) {
  const r = njReview(a.id, w), s = njStat(a.id, w), t = njTarget(w);
  const filled = r && NJ_HAS_REVIEW(w) ? NJ_REVIEW_FIELDS.filter(([k]) => r[k]) : [];
  return `<div class="nj-wr ${NJ_HAS_REVIEW(w) ? '' : 'nj-wr-flat'}" id="nj-wr-${w}">
    <div class="nj-wr-bar" onclick="${NJ_HAS_REVIEW(w) ? `njToggleWeek(${w})` : `njOpenEntry(${w})`}">
      <div class="nj-wr-wk"><b>Week ${w}</b><div class="nj-muted">${njWeekRange(a.start_date, w)}</div></div>
      <div class="nj-wr-ph"><span class="nj-phase nj-phase-${t.phase}">${njEsc(njPhaseLabel(w).replace(' · Probation', ''))}</span></div>
      <div class="nj-wr-t"><div class="nj-lbl">Target</div>${njEsc(njTargetText(t))}</div>
      <div class="nj-wr-a"><div class="nj-lbl">Actual</div>${njActualText(s)}</div>
      <div class="nj-wr-r">${s && s.rag ? njRagChip(s.rag, { green: 'On target', amber: 'Close', red: 'Below' }[s.rag]) : `<span class="nj-muted">${njTargetText(t) === 'No KPI' ? 'No KPI' : s ? 'No KPI data' : 'Not entered'}</span>`}</div>
      <div class="nj-wr-x">${NJ_HAS_REVIEW(w) ? `${filled.length ? '<span class="nj-muted">Review</span>' : ''}<span class="nj-caret">▾</span>` : '<span class="nj-muted">Edit</span>'}</div>
    </div>
    ${NJ_HAS_REVIEW(w) ? `<div class="nj-wr-body">
      ${filled.length ? `<div class="nj-rv-grid">${NJ_REVIEW_FIELDS.map(([k, l]) => `<div class="nj-rv-box nj-rv-${k}"><div class="nj-lbl">${l}</div><div class="nj-rv-text">${r[k] ? njEsc(r[k]) : '<span class="nj-muted">—</span>'}</div></div>`).join('')}</div>` : '<div class="nj-muted" style="padding:4px 0 8px">No review written for this week.</div>'}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span class="nj-muted">${r && r.reviewer ? 'Reviewed by ' + njEsc(r.reviewer) : ''}</span>
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();njOpenEntry(${w})">Edit week ${w}</button></div>
    </div>` : ''}</div>`;
}

function njScoresHtml(a) {
  const list = nj.scores[a.id];
  if (!list) return '<div class="loading">Loading ticket scores…</div>';
  const rows = list.slice(0, 60).map(s => `<tr><td>${njFmt(njDate(s.date))}</td><td>${njEsc(s.contact_reason)}</td>
      <td><span class="badge badge-${s.score}">${s.score}</span></td><td style="white-space:pre-wrap">${njEsc(s.feedback)}</td><td>${njEsc(s.reviewer)}</td>
      <td><button class="btn btn-outline btn-sm" onclick="njDeleteScore(${s.id})">✕</button></td></tr>`).join('');
  return `<div class="card"><div class="card-header"><span class="card-title">Ticket scores (weeks 1–4)</span><span class="marking-meta">${list.length} logged</span></div>
    <div style="padding:14px 18px 4px"><div style="display:grid;grid-template-columns:130px 1fr 90px 2fr 120px auto;gap:8px;align-items:start">
      <input type="date" id="njs-date" value="${njIso(new Date())}" style="padding:8px;border:1px solid #e8e5e2;border-radius:7px;font-family:inherit" />
      <input type="text" id="njs-cr" placeholder="Contact reason" />
      <select id="njs-score"><option value="3">3</option><option value="2">2</option><option value="1">1</option></select>
      <input type="text" id="njs-fb" placeholder="Feedback" />
      <input type="text" id="njs-rev" placeholder="Reviewer" />
      <button class="btn btn-primary" onclick="njAddScore()">Add</button></div></div>
    <table><thead><tr><th>Date</th><th>Contact reason</th><th>Score</th><th>Feedback</th><th>Reviewer</th><th></th></tr></thead>
    <tbody>${rows || '<tr class="empty-row"><td colspan="6">No ticket scores yet.</td></tr>'}</tbody></table></div>`;
}
async function njAddScore() {
  const a = njAgent(nj.agentId); const v = id => document.getElementById(id).value.trim();
  const row = { agent_id: a.id, date: v('njs-date'), contact_reason: v('njs-cr') || null, score: Number(v('njs-score')), feedback: v('njs-fb') || null, reviewer: v('njs-rev') || null };
  if (!row.date) { toast('Pick a date'); return; }
  const { error } = await db.from('ticket_scores').insert(row);
  if (error) { toast('Could not save: ' + error.message); return; }
  await njLoadScores(a.id); renderJoinerAgent(); toast('Ticket score added ✓');
}
async function njDeleteScore(id) {
  if (!confirm('Delete this ticket score?')) return;
  const { error } = await db.from('ticket_scores').delete().eq('id', id);
  if (error) { toast('Could not delete: ' + error.message); return; }
  await njLoadScores(nj.agentId); renderJoinerAgent();
}

function renderJoinerAgent() {
  const a = njAgent(nj.agentId); if (!a) { njBack(); return; }
  const lastWeek = NJ_DONE(a) ? 10 : Math.min(Math.max(a.current_week, 1), 10);
  const weeks = []; for (let w = lastWeek; w >= 1; w--) weeks.push(w);
  const facts = [['Started', njFmt(njDate(a.start_date))], ['Now', NJ_DONE(a) ? (a.status === 'left' ? 'Left' : 'Passed probation') : a.current_week > 0 ? `Week ${a.current_week} · ${njPhaseLabel(a.current_week)}` : 'Starts soon'],
    ['Cohort', a.cohort], ['Buddy', a.buddy], ['Team lead', a.team_lead], ['Learns best', a.learning_style]].filter(([, v]) => v);
  document.getElementById('nj-root').innerHTML = `
    <div style="margin-bottom:14px"><button class="btn btn-outline btn-sm" onclick="njBack()">← All new joiners</button></div>
    <div class="nj-head">
      <div style="display:flex;gap:14px;align-items:center">${njAvatar(a, 48)}<div>
        <div class="section-title">${njEsc(a.name)} <span class="nj-status nj-status-${a.status}" style="vertical-align:3px">${njEsc(a.status)}</span></div>
        <div class="nj-facts">${facts.map(([k, v]) => `<span><span class="nj-muted">${k}</span> ${njEsc(v)}</span>`).join('')}</div></div></div>
      <div style="display:flex;gap:8px"><button class="btn btn-outline" onclick="njEditAgent()">Edit details</button>
        <button class="btn btn-outline" onclick="njExport()">Export report</button>
        <button class="btn btn-primary" onclick="njOpenEntry(${lastWeek})">+ Weekly entry</button></div>
    </div>
    <div id="nj-edit"></div>
    ${a.probation_flag && !NJ_DONE(a) ? `<div class="nj-flag-banner">⚑ <b>Below the probation minimum.</b> Week ${a.latest_week}: ${a.latest_messages ?? '–'} messages against a minimum of ${a.latest_min ?? '–'}${a.latest_qa_pct != null ? `, QA ${a.latest_qa_pct}%` : ''}. To pass at week 10: ${njTarget(10).min_messages} messages with QA under ${njTarget(10).qa_mentions_max_pct}%.</div>` : ''}
    <div class="card" style="padding:16px 18px">${njTimelineHtml(a)}</div>
    <div id="nj-entry"></div>
    <div class="nj-group-h">Week by week <span class="nj-muted">newest first · weeks 1–4 have a written review, click to read it</span></div>
    <div class="card nj-weekrows">${weeks.map(w => njWeekRowHtml(a, w)).join('')}</div>
    <div class="nj-group-h">Ticket scores</div>
    ${njScoresHtml(a)}`;
  const latestRev = weeks.find(w => njReview(a.id, w));
  if (latestRev) njToggleWeek(latestRev);
}
async function njEditAgent() {
  // gorgias_user_id lives on agents (not in the overview view), so read it fresh.
  const { data } = await db.from('agents').select('gorgias_user_id').eq('id', nj.agentId).single();
  const a = Object.assign({}, njAgent(nj.agentId), { gorgias_user_id: data && data.gorgias_user_id });
  document.getElementById('nj-edit').innerHTML = `<div class="card" style="margin-bottom:16px">${njAgentFormHtml(a, 'edit')}</div>`;
}

// ── Weekly entry form ───────────────────────────────────────────────────────
function njOpenEntry(w) {
  const a = njAgent(nj.agentId), s = njStat(a.id, w), r = njReview(a.id, w) || {};
  // Weeks 1–4: if nothing is saved yet, pre-fill the counts from that week's ticket scores.
  const pre = (!s && w <= 4) ? njCountsFromScores(a, w) : null;
  const val = k => s && s[k] != null ? s[k] : (pre && pre[k] != null ? pre[k] : '');
  const t = njTarget(w);
  document.getElementById('nj-entry').innerHTML = `<div class="card" id="nj-entry-card" style="margin-top:4px">
    <div class="card-header"><span class="card-title">Week ${w} · ${njWeekRange(a.start_date, w)} · ${njEsc(njPhaseLabel(w))}</span>
      <div style="display:flex;gap:6px;align-items:center"><select onchange="njOpenEntry(Number(this.value))" style="margin:0;width:auto;padding:4px 8px">${Array.from({ length: 11 }, (_, i) => `<option value="${i + 1}" ${i + 1 === w ? 'selected' : ''}>Week ${i + 1}</option>`).join('')}</select>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('nj-entry').innerHTML=''">Close</button></div></div>
    <div style="padding:18px">
      <div class="marking-meta" style="margin:-4px 0 12px">Target: ${njEsc([t.goal_messages ? `${t.goal_messages} messages${t.min_messages ? ` (min ${t.min_messages})` : ''}` : 'no volume KPI', t.quality_target_pct ? `${t.quality_target_pct}% of scored tickets are 3s` : '', t.qa_mentions_max_pct ? `QA mentions under ${t.qa_mentions_max_pct}%` : '', t.calls_target ? `${t.calls_target} call${t.calls_target > 1 ? 's' : ''}${w === 10 ? ' in total' : ''}` : '', t.notes || ''].filter(Boolean).join(' · '))}</div>
      ${w <= 4 ? `<div class="sub-note" style="margin-bottom:12px">${pre ? `Counts pre-filled from ${pre.n} ticket score${pre.n === 1 ? '' : 's'} logged this week. ` : ''}<a href="#" onclick="njRefill(${w});return false">Fill counts from ticket scores</a></div>` : ''}
      <div class="nj-metric-grid">${NJ_METRIC_FIELDS.map(([k, l]) => `<div><label>${l}</label><input type="number" min="0" id="njm-${k}" value="${val(k)}" oninput="njLiveCalc()" /></div>`).join('')}</div>
      <div id="nj-live" class="marking-meta" style="margin:-2px 0 14px"></div>
      ${NJ_HAS_REVIEW(w) ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="card-title">Review</div>
        <button class="btn btn-outline btn-sm" id="nj-draft-btn" onclick="njDraftSummary(${w})">✨ Draft summary from ticket feedback</button></div>
      ${NJ_REVIEW_FIELDS.map(([k, l]) => `<label>${l}</label><textarea id="njr-${k}" rows="3">${njEsc(r[k]).replace(/<br>/g, '\n')}</textarea>`).join('')}` : ''}
      <div style="display:flex;gap:10px;align-items:end">${NJ_HAS_REVIEW(w) ? `<div style="flex:0 0 240px"><label>Reviewer</label><input type="text" id="njr-reviewer" value="${njEsc(r.reviewer)}" placeholder="Demetra" /></div>` : ''}
        <button class="btn btn-primary" style="margin-bottom:12px" onclick="njSaveEntry(${w})">Save week ${w}</button></div>
    </div></div>`;
  njLiveCalc();
  document.getElementById('nj-entry-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function njCountsFromScores(a, w) {
  const list = njScoresInWeek(a, w); if (!list.length) return null;
  const c = n => list.filter(s => s.score === n).length;
  return { n: list.length, tickets_logged: list.length, tickets_scored: list.length, score_3s: c(3), score_2s: c(2), score_1s: c(1) };
}
function njRefill(w) {
  const c = njCountsFromScores(njAgent(nj.agentId), w);
  if (!c) { toast('No ticket scores logged for this week'); return; }
  ['tickets_logged', 'tickets_scored', 'score_3s', 'score_2s', 'score_1s'].forEach(k => { document.getElementById('njm-' + k).value = c[k]; });
  njLiveCalc(); toast(`Filled from ${c.n} ticket scores`);
}
function njLiveCalc() {
  const g = k => { const v = document.getElementById('njm-' + k).value; return v === '' ? null : Number(v); };
  const s3 = g('score_3s'), s2 = g('score_2s'), s1 = g('score_1s'), sc = g('tickets_scored'), ms = g('messages_sent'), qa = g('qa_mentions');
  const bits = [];
  if (sc) bits.push(`Quality ${(100 * (s3 || 0) / sc).toFixed(1)}% scored 3`);
  const n = (s3 || 0) + (s2 || 0) + (s1 || 0);
  if (n) bits.push(`average ${((3 * (s3 || 0) + 2 * (s2 || 0) + (s1 || 0)) / n).toFixed(2)}`);
  if (sc != null && n && n !== sc) bits.push(`⚠ 3s + 2s + 1s = ${n}, not ${sc} scored`);
  if (ms) bits.push(`QA ${(100 * (qa || 0) / ms).toFixed(1)}% of messages`);
  document.getElementById('nj-live').textContent = bits.length ? 'Calculated: ' + bits.join(' · ') : '';
}
async function njSaveEntry(w) {
  const a = njAgent(nj.agentId);
  const m = { agent_id: a.id, week: w, week_start_date: njIso(njWeekStart(a.start_date, w)), updated_at: new Date().toISOString() };
  NJ_METRIC_FIELDS.forEach(([k]) => { const v = document.getElementById('njm-' + k).value; m[k] = v === '' ? null : Math.max(0, Math.round(Number(v))); });
  const r = { agent_id: a.id, week: w, updated_at: new Date().toISOString() };
  if (NJ_HAS_REVIEW(w)) {
    r.reviewer = document.getElementById('njr-reviewer').value.trim() || null;
    NJ_REVIEW_FIELDS.forEach(([k]) => { r[k] = document.getElementById('njr-' + k).value.trim() || null; });
  }
  const hasM = NJ_METRIC_FIELDS.some(([k]) => m[k] != null), hasR = NJ_HAS_REVIEW(w) && NJ_REVIEW_FIELDS.some(([k]) => r[k]);
  const ops = [];
  if (hasM) ops.push(db.from('weekly_metrics').upsert(m, { onConflict: 'agent_id,week' }).select('id'));
  if (hasR) ops.push(db.from('weekly_reviews').upsert(r, { onConflict: 'agent_id,week' }).select('id'));
  if (!ops.length) { toast('Nothing to save yet'); return; }
  const res = await Promise.all(ops);
  const bad = res.find(x => x.error || !(x.data || []).length);
  if (bad) { toast('Could not save: ' + ((bad.error && bad.error.message) || 'no permission')); return; }
  toast(`Week ${w} saved ✓`);
  await loadJoiners();
}

// ── Draft summary (AI) ──────────────────────────────────────────────────────
async function njDraftSummary(w) {
  const a = njAgent(nj.agentId), list = njScoresInWeek(a, w).filter(s => s.feedback);
  if (!list.length) { toast('No ticket feedback logged for this week to draft from'); return; }
  const btn = document.getElementById('nj-draft-btn'); btn.disabled = true; btn.textContent = 'Drafting…';
  try {
    const res = await fetch(NJ_DRAFT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: a.name.split(' ')[0], week: w, phase: njPhaseLabel(w),
        scores: list.map(s => ({ date: s.date, contact_reason: s.contact_reason, score: s.score, feedback: s.feedback })) }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    let filled = 0;
    ['strengths', 'areas_to_improve', 'next_steps'].forEach(k => {
      const el = document.getElementById('njr-' + k);
      if (d[k]) { el.value = el.value.trim() ? el.value.trim() + '\n\n' + d[k] : d[k]; filled++; }
    });
    toast(filled ? 'Draft added. Edit it before saving.' : 'The draft came back empty');
  } catch (e) {
    toast('Drafting is not available right now (' + e.message + ')');
  } finally { btn.disabled = false; btn.textContent = '✨ Draft summary from ticket feedback'; }
}

// ── Export (printable report) ───────────────────────────────────────────────
function njExport() {
  const a = njAgent(nj.agentId); const e = v => njEsc(v);
  const rows = Array.from({ length: 11 }, (_, i) => i + 1).map(w => {
    const s = njStat(a.id, w), t = njTarget(w); if (!s && !njReview(a.id, w)) return '';
    return `<tr><td>${w}</td><td>${njWeekRange(a.start_date, w)}</td><td>${e(njPhaseLabel(w))}</td>
      <td>${s && s.tickets_scored != null ? `${s.tickets_scored} (${s.score_3s ?? '–'}/${s.score_2s ?? '–'}/${s.score_1s ?? '–'})` : ''}</td>
      <td>${s && s.quality_pct != null ? s.quality_pct + '%' : ''}${t.quality_target_pct ? ` <small>/ ${t.quality_target_pct}%</small>` : ''}</td>
      <td>${s && s.messages_sent != null ? s.messages_sent : ''}${t.goal_messages ? ` <small>/ ${t.goal_messages}${t.min_messages ? ' (min ' + t.min_messages + ')' : ''}</small>` : ''}</td>
      <td>${s && s.qa_pct != null ? `${s.qa_mentions} (${s.qa_pct}%)` : ''}</td><td>${s && s.calls_done != null ? s.calls_done : ''}</td>
      <td class="rag-${(s && s.rag) || 'none'}">${(s && s.rag) || ''}</td></tr>`;
  }).join('');
  const revs = [1, 2, 3, 4].map(w => {
    const r = njReview(a.id, w); if (!r) return '';
    return `<h3>Week ${w} · ${njWeekRange(a.start_date, w)}</h3>` + NJ_REVIEW_FIELDS.filter(([k]) => r[k]).map(([k, l]) => `<p><b>${l}</b><br>${e(r[k])}</p>`).join('') + (r.reviewer ? `<p class="by">Reviewed by ${e(r.reviewer)}</p>` : '');
  }).join('');
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to export'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(a.name)} · New joiner report</title><style>
    body{font-family:Inter,Arial,sans-serif;font-size:12px;color:#1b1c1d;margin:28px;} h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:22px 0 8px}
    h3{font-size:13px;margin:16px 0 6px;border-top:1px solid #eee;padding-top:10px} .sub{color:#706f6e;margin-bottom:6px}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #e8e5e2;padding:5px 7px;text-align:left;vertical-align:top} th{background:#fafafa;font-size:11px}
    small{color:#a3a19e} p{margin:4px 0 8px;line-height:1.5} .by{color:#a3a19e} .flag{background:#ffe9e9;color:#6c041f;padding:8px 10px;border-radius:6px;margin:10px 0}
    .rag-green{color:#00834f;font-weight:600}.rag-amber{color:#854d0e;font-weight:600}.rag-red{color:#d9003e;font-weight:600}
    @media print{body{margin:12mm}}</style></head><body>
    <h1>${e(a.name)}</h1><div class="sub">New joiner report · started ${njFmt(njDate(a.start_date))} · ${a.current_week > 0 ? 'week ' + a.current_week : 'not started'} · status ${e(a.status)}${a.cohort ? ' · ' + e(a.cohort) : ''}${a.buddy ? ' · buddy ' + e(a.buddy) : ''}${a.team_lead ? ' · TL ' + e(a.team_lead) : ''}</div>
    ${a.probation_flag ? '<div class="flag">⚑ Tracking below the probation minimum in week ' + a.latest_week + '.</div>' : ''}
    <h2>Metrics by week</h2><table><tr><th>Wk</th><th>Dates</th><th>Phase</th><th>Scored (3/2/1)</th><th>Quality / target</th><th>Messages / goal</th><th>QA</th><th>Calls</th><th>RAG</th></tr>${rows || '<tr><td colspan="9">No metrics yet</td></tr>'}</table>
    <h2>Weekly reviews</h2>${revs || '<p>No reviews yet.</p>'}
    <p class="by" style="margin-top:24px">Generated ${new Date().toLocaleDateString('en-GB')} from Healf Learning admin.</p>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
