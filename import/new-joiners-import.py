#!/usr/bin/env python3
"""One-off import of the "Onboarding Master file" tabs into the new-joiner tracking tables.

Reads CSV exports of these tabs from data/import/ (file names just need to contain the tab name):
  Onboarding Report    -> weeks 1-2 (counts parsed from the "Key metrics" text cell + review text)
  Buddy Report         -> weeks 3-4 (quality where it can be turned into counts + review text)
  Week 5-10            -> weeks 5-10 (messages sent + QA mentions)
  New Joiner KPI Timeline is NOT imported: the targets are seeded by new-joiner-tracking.sql.

It never touches the database. It writes three files to data/import/out/:
  preview.md            what would be loaded, per agent and week — read this first
  problems.log          every value it could not parse or that needs a human check (nothing is guessed)
  load-staging.sql      inserts into the STAGING schema only; paste into the Supabase SQL editor
Then check staging and run new-joiner-import-promote.sql to copy into the real tables.

Usage:  python3 import/new-joiners-import.py [path/to/data/import]
"""
import csv, datetime as dt, glob, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'data', 'import')
OUT = os.path.join(SRC, 'out')
TODAY = dt.date.today()
MONTHS = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}

problems = []          # (agent, week, field, raw value, why)
agents = {}            # key -> {name, starts: [(date, source)], learning_style}
metrics = defaultdict(dict)   # (key, week) -> {field: value}
reviews = defaultdict(dict)   # (key, week) -> {field: text}


def problem(agent, week, field, raw, why):
    problems.append((agent or '-', week if week else '-', field, (raw or '').replace('\n', ' / ')[:160], why))


def key_of(name):
    return re.sub(r'\s+', ' ', (name or '').strip()).lower()


def agent(name):
    k = key_of(name)
    if k not in agents:
        agents[k] = {'name': re.sub(r'\s+', ' ', name.strip()), 'starts': [], 'learning_style': None}
    return k


def read_tab(label):
    hits = [p for p in glob.glob(os.path.join(SRC, '*.csv')) if label.lower() in os.path.basename(p).lower()]
    if not hits:
        print(f'  (no CSV found for "{label}" — skipped)')
        return []
    with open(hits[0], newline='', encoding='utf-8-sig') as f:
        return list(csv.reader(f))


def cell(row, i):
    return row[i].strip() if i < len(row) and row[i] else ''


# ── dates ─────────────────────────────────────────────────────────────────
def parse_range_start(raw):
    """'27-26th June', '4th-8th May', '28th Sept - 2nd Oct', '1-5 June', '12-16 October' -> date of the first day.
    The sheet has no years: use the most recent year that puts the date on or before today."""
    s = raw.lower().replace('–', '-')
    m = re.match(r'\s*(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]+)?\s*-\s*(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]+)', s)
    if not m:
        return None
    day, mon1, _, mon2 = m.groups()
    mon = MONTHS.get((mon1 or mon2)[:3])
    if not mon:
        return None
    for year in (TODAY.year, TODAY.year - 1):
        try:
            d = dt.date(year, mon, int(day))
        except ValueError:
            return None
        if d <= TODAY + dt.timedelta(days=7):
            return d
    return None


def monday(d):
    return d - dt.timedelta(days=d.weekday())


# ── numbers ───────────────────────────────────────────────────────────────
def num(raw):
    try:
        return float(raw.replace(',', '').strip())
    except (ValueError, AttributeError):
        return None


def as_int(raw):
    v = num(raw)
    return int(v) if v is not None and v == int(v) else None


def parse_key_metrics(raw):
    """Onboarding Report 'Key metrics' cell -> counts, plus a consistency check of the stated %."""
    out = {}
    for label, field in [('tickets logged', 'tickets_logged'), ('tickets scored', 'tickets_scored'),
                         ('score 3s', 'score_3s'), ('score 2s', 'score_2s'), ('score 1s', 'score_1s')]:
        m = re.search(label + r'\s*:\s*([\d.]+)', raw, re.I)
        if m and as_int(m.group(1)) is not None:
            out[field] = as_int(m.group(1))
    m = re.search(r'quality score %\s*:\s*([\d.]+)\s*%?', raw, re.I)
    stated = float(m.group(1)) if m else None
    return out, stated


def breakdown(raw):
    """'3 - 73.68%\\n2 - 21.05%\\n1 - 5.26%' -> {3: 73.68, 2: 21.05, 1: 5.26}"""
    got = {int(a): float(b) for a, b in re.findall(r'\b([123])\s*-\s*([\d.]+)\s*%', raw)}
    return got if len(got) == 3 else None


def counts_from_pct(pcts, n):
    """Counts for n scored tickets that reproduce every stated % to 2dp, else None."""
    c = {k: round(v * n / 100) for k, v in pcts.items()}
    if sum(c.values()) != n:
        return None
    if all(abs(100 * c[k] / n - pcts[k]) < 0.006 for k in pcts):
        return c
    return None


def parse_buddy_quality(cells, agent_name, week):
    """Turn the buddy-report KPI cells into counts ONLY where the counts are stated or exactly implied."""
    joined = '\n'.join(c for c in cells if c)
    if not joined:
        return {}
    # "(44 of 81 tickets scored)" + a 3/2/1 breakdown in the same cell
    for c in cells:
        m = re.search(r'\((\d+)\s+of\s+(\d+)\s+tickets scored\)', c)
        pc = breakdown(c)
        if m and pc:
            n, logged = int(m.group(1)), int(m.group(2))
            cnt = counts_from_pct(pc, n)
            if cnt:
                return {'tickets_logged': logged, 'tickets_scored': n,
                        'score_3s': cnt[3], 'score_2s': cnt[2], 'score_1s': cnt[1]}
            problem(agent_name, week, 'quality', c, 'breakdown % does not match the stated number scored')
            return {}
    # "87% (14/16)" or "66.67% (24/36 scored 3)"
    for c in cells:
        m = re.search(r'\((\d+)\s*/\s*(\d+)(?:\s*scored 3)?\)', c)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if b and a <= b:
                return {'tickets_scored': b, 'score_3s': a}
    # a 3/2/1 breakdown with no count
    for c in cells:
        pc = breakdown(c)
        if pc:
            n = next((n for n in range(1, 201) if counts_from_pct(pc, n)), None)
            hint = f'smallest exact fit = {n} scored ({counts_from_pct(pc, n)})' if n else 'no whole-number fit'
            problem(agent_name, week, 'quality', c, f'breakdown % only, no ticket count — {hint}; add counts by hand')
            return {}
    problem(agent_name, week, 'quality', joined, 'percentage only, no ticket counts — quality % is calculated from counts, so nothing loaded')
    return {}


NEXT = re.compile(r'^\s*next steps?(?:\s+for\s+[a-z]+)?\s*:?\s*', re.I)


def split_summary(text):
    """Buddy 'Progress Summary' cells are often all next steps, or summary + 'Next steps:'."""
    if not text:
        return None, None
    if NEXT.match(text):
        return None, NEXT.sub('', text, count=1).strip() or None
    m = re.search(r'\n\s*next steps?\s*:?', text, re.I)
    if m:
        return text[:m.start()].strip() or None, text[m.end():].strip() or None
    return text, None


# ── tab readers ───────────────────────────────────────────────────────────
def read_onboarding():
    rows = read_tab('Onboarding Report')
    last_dates = {1: None, 2: None}
    for r in rows[3:]:
        name = cell(r, 0)
        if not name:
            continue
        k = agent(name)
        if cell(r, 1):
            agents[k]['learning_style'] = cell(r, 1)
        for week, (dcol, mcol, scol, icol, pcol) in {1: (2, 3, 4, 5, 6), 2: (7, 8, 9, 10, 11)}.items():
            if cell(r, dcol):
                last_dates[week] = cell(r, dcol)
            draw = cell(r, dcol) or last_dates[week]   # merged date cells: carry the group's date down
            has_any = any(cell(r, c) for c in (mcol, scol, icol, pcol))
            if not has_any:
                continue
            d = parse_range_start(draw) if draw else None
            if draw and not d:
                problem(name, week, 'week dates', draw, 'could not read the date range')
            if d:
                if week == 1:
                    agents[k]['starts'].append((d, f'Onboarding wk1 "{draw}"'))
                metrics[(k, week)]['week_start_date'] = monday(d)
            if cell(r, mcol):
                cnt, stated = parse_key_metrics(cell(r, mcol))
                if not cnt:
                    problem(name, week, 'key metrics', cell(r, mcol), 'no counts found')
                metrics[(k, week)].update(cnt)
                if stated is not None and cnt.get('tickets_scored'):
                    calc = 100 * cnt.get('score_3s', 0) / cnt['tickets_scored']
                    if abs(calc - stated) > 0.6:
                        problem(name, week, 'quality %', cell(r, mcol),
                                f'sheet says {stated}% but the counts give {calc:.1f}% — counts loaded, check them')
            reviews[(k, week)].update({'strengths': cell(r, scol) or None, 'areas_to_improve': cell(r, icol) or None,
                                       'progress_summary': cell(r, pcol) or None})


def read_buddy():
    rows = read_tab('Buddy Report')
    last_dates = {3: None, 4: None}
    for r in rows[3:]:
        name = cell(r, 0)
        if not name:
            continue
        k = agent(name)
        if cell(r, 1):
            agents[k]['learning_style'] = agents[k]['learning_style'] or cell(r, 1)
        spec = {3: dict(d=2, kpi=[3], s=4, i=5, p=6), 4: dict(d=7, kpi=[8, 9], s=11, i=12, p=13)}
        for week, c in spec.items():
            if cell(r, c['d']):
                last_dates[week] = cell(r, c['d'])
            draw = cell(r, c['d']) or last_dates[week]
            texts = [cell(r, c['s']), cell(r, c['i']), cell(r, c['p'])]
            kpis = [cell(r, x) for x in c['kpi']]
            if not any(texts) and not any(kpis):
                continue
            d = parse_range_start(draw) if draw else None
            if draw and not d:
                problem(name, week, 'week dates', draw, 'could not read the date range')
            if d:
                if week == 3:
                    agents[k]['starts'].append((d - dt.timedelta(days=14), f'Buddy wk1 "{draw}" minus 2 weeks'))
                metrics[(k, week)]['week_start_date'] = monday(d)
            # week 4 col 9 is the average score and col 10 "tickets sent on Friday" — both left out:
            # the average is calculated, and a Friday-only count is not a weekly messages figure.
            q = parse_buddy_quality([x for x in kpis if not re.fullmatch(r'[\d.]+', x)] or kpis[:1], name, week)
            metrics[(k, week)].update(q)
            summary, nxt = split_summary(cell(r, c['p']))
            reviews[(k, week)].update({'strengths': cell(r, c['s']) or None, 'areas_to_improve': cell(r, c['i']) or None,
                                       'progress_summary': summary, 'next_steps': nxt})


def read_week5_10():
    rows = read_tab('Week 5-10')
    last_date = None
    for r in rows[3:]:
        name = cell(r, 0)
        if not name:
            continue
        k = agent(name)
        if cell(r, 1):
            last_date = cell(r, 1)
        draw = cell(r, 1) or last_date
        d = parse_range_start(draw) if draw else None
        if draw and not d:
            problem(name, 5, 'week 5 date', draw, 'could not read the date range')
        if d:
            agents[k]['starts'].append((d - dt.timedelta(days=28), f'Week 5 "{draw}" minus 4 weeks'))
        for i, week in enumerate(range(5, 11)):
            msg, qa = cell(r, 2 + 3 * i), cell(r, 3 + 3 * i)
            if not msg and not qa:
                continue
            m = {}
            if msg:
                v = as_int(msg)
                if v is None:
                    problem(name, week, 'messages sent', msg, 'not a whole number')
                else:
                    m['messages_sent'] = v
            if qa:
                v = as_int(qa)
                if v is None:
                    problem(name, week, 'QA mentions', qa, 'not a whole number')
                else:
                    m['qa_mentions'] = v
            if d:
                m['week_start_date'] = monday(d) + dt.timedelta(days=7 * i)
            metrics[(k, week)].update(m)


# ── agents: start date + status ───────────────────────────────────────────
def week_of(start, on):
    return (monday(on) - monday(start)).days // 7 + 1


def settle_agents():
    for k, a in agents.items():
        if not a['starts']:
            problem(a['name'], None, 'start date', '', 'no date anywhere — agent NOT loaded; add start_date by hand')
            a['start_date'] = None
            continue
        weekday = [(d, src) for d, src in a['starts'] if d.weekday() < 5]
        for d, src in a['starts']:
            if d.weekday() >= 5:
                problem(a['name'], None, 'start date', f'{src} = {d:%a %d %b}', 'range starts on a weekend (typo?) — ignored; used the next source')
        if not weekday:
            problem(a['name'], None, 'start date', '', 'no weekday start date — agent NOT loaded; add start_date by hand')
            a['start_date'] = None
            continue
        a['starts'] = weekday
        first = a['starts'][0]
        a['start_date'] = first[0]
        for d, src in a['starts'][1:]:
            if abs((monday(d) - monday(first[0])).days) >= 7:
                problem(a['name'], None, 'start date', f'{first[1]} = {first[0]} vs {src} = {d}',
                        'sources disagree by a week or more — used the first; check')
        w = week_of(a['start_date'], TODAY)
        a['status'] = 'onboarding' if w <= 2 else 'buddying' if w <= 4 else 'probation' if w <= 10 else 'passed'
        if w > 10:
            problem(a['name'], None, 'status', f'week {w} today', 'past week 10 — set to "passed"; change to "left" if they left')


# ── output ────────────────────────────────────────────────────────────────
def q(v):
    if v is None:
        return 'null'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, dt.date):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


def write_out():
    os.makedirs(OUT, exist_ok=True)
    loadable = {k: a for k, a in agents.items() if a.get('start_date')}
    sql = ['-- Generated by import/new-joiners-import.py on %s. Loads the STAGING schema only.' % TODAY,
           '-- Re-running replaces what is in staging.', 'begin;',
           'truncate staging.agents, staging.weekly_metrics, staging.weekly_reviews;']
    for a in loadable.values():
        sql.append('insert into staging.agents (name, start_date, learning_style, status) values (%s, %s, %s, %s);'
                   % (q(a['name']), q(a['start_date']), q(a['learning_style']), q(a['status'])))
    mcols = ['week_start_date', 'tickets_logged', 'tickets_scored', 'score_3s', 'score_2s', 'score_1s', 'messages_sent', 'qa_mentions']
    for (k, w), m in sorted(metrics.items()):
        if k in loadable and any(m.get(c) is not None for c in mcols[1:]):
            sql.append('insert into staging.weekly_metrics (agent_name, week, %s) values (%s, %d, %s);'
                       % (', '.join(mcols), q(loadable[k]['name']), w, ', '.join(q(m.get(c)) for c in mcols)))
    rcols = ['strengths', 'areas_to_improve', 'progress_summary', 'next_steps']
    for (k, w), r in sorted(reviews.items()):
        if k in loadable and any(r.get(c) for c in rcols):
            sql.append('insert into staging.weekly_reviews (agent_name, week, %s) values (%s, %d, %s);'
                       % (', '.join(rcols), q(loadable[k]['name']), w, ', '.join(q(r.get(c)) for c in rcols)))
    sql += ['commit;', '',
            "select 'agents' t, count(*) from staging.agents union all",
            "select 'weekly_metrics', count(*) from staging.weekly_metrics union all",
            "select 'weekly_reviews', count(*) from staging.weekly_reviews;"]
    open(os.path.join(OUT, 'load-staging.sql'), 'w').write('\n'.join(sql) + '\n')

    with open(os.path.join(OUT, 'problems.log'), 'w') as f:
        f.write('agent\tweek\tfield\tvalue\twhy\n')
        for p in problems:
            f.write('\t'.join(str(x) for x in p) + '\n')

    lines = [f'# New joiner import preview ({TODAY})', '',
             f'- Agents: {len(loadable)} loadable, {len(agents) - len(loadable)} not loaded',
             f'- Weekly metric rows: {sum(1 for (k, w), m in metrics.items() if k in loadable and any(m.get(c) is not None for c in mcols[1:]))}',
             f'- Weekly review rows: {sum(1 for (k, w), r in reviews.items() if k in loadable and any(r.get(c) for c in rcols))}',
             f'- Problems to check: {len(problems)} (see problems.log)', '']
    for k, a in sorted(loadable.items(), key=lambda x: x[1]['start_date']):
        lines.append(f"## {a['name']} — start {a['start_date']} · status {a['status']}")
        lines.append('| week | logged | scored | 3s/2s/1s | quality % | messages | QA | review |')
        lines.append('|---|---|---|---|---|---|---|---|')
        for w in range(1, 12):
            m, r = metrics.get((k, w), {}), reviews.get((k, w), {})
            if not any(v is not None for c, v in m.items() if c != 'week_start_date') and not any(r.values()):
                continue
            qp = f"{100 * m['score_3s'] / m['tickets_scored']:.1f}" if m.get('tickets_scored') and m.get('score_3s') is not None else ''
            s321 = '/'.join(str(m.get(c, '')) for c in ('score_3s', 'score_2s', 'score_1s')) if m.get('score_3s') is not None else ''
            lines.append(f"| {w} | {m.get('tickets_logged', '')} | {m.get('tickets_scored', '')} | {s321} | {qp} | "
                         f"{m.get('messages_sent', '')} | {m.get('qa_mentions', '')} | {'yes' if any(r.values()) else ''} |")
        lines.append('')
    open(os.path.join(OUT, 'preview.md'), 'w').write('\n'.join(lines))
    print(f'  wrote {OUT}/preview.md, problems.log, load-staging.sql')
    print(f'  {len(loadable)} agents · {len(problems)} problems to check')


if __name__ == '__main__':
    print(f'Reading CSVs from {os.path.abspath(SRC)}')
    read_onboarding()
    read_buddy()
    read_week5_10()
    settle_agents()
    write_out()
