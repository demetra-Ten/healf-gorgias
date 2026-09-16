import zipfile, xml.etree.ElementTree as ET
NS = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def load(path):
    z = ET.ElementTree  # placeholder
    zf = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in zf.namelist():
        ss = ET.fromstring(zf.read('xl/sharedStrings.xml'))
        for si in ss:
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(zf.read('xl/workbook.xml'))
    rels = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
    relmap = {r.get('Id'): r.get('Target') for r in rels}
    out = {}
    for sh in wb.find('m:sheets', NS):
        name = sh.get('name')
        tgt = relmap[sh.get('{%s}id' % NS['r'])].lstrip('/')
        if not tgt.startswith('xl/'): tgt = 'xl/' + tgt
        ws = ET.fromstring(zf.read(tgt))
        rows = []
        for row in ws.iter('{%s}row' % NS['m']):
            cells = {}
            for c in row:
                ref = c.get('r') or ''
                col = ''.join(ch for ch in ref if ch.isalpha())
                t = c.get('t')
                v = c.find('m:v', NS)
                if t == 's' and v is not None:
                    val = shared[int(v.text)]
                elif t == 'inlineStr':
                    isel = c.find('m:is', NS)
                    val = ''.join(x.text or '' for x in isel.iter('{%s}t' % NS['m'])) if isel is not None else ''
                else:
                    val = v.text if v is not None else ''
                cells[col] = val or ''
            if cells: rows.append(cells)
        out[name] = rows
    return out

def as_table(rows):
    if not rows: return []
    cols = sorted({c for r in rows for c in r}, key=lambda s: (len(s), s))
    return [[r.get(c,'') for c in cols] for r in rows]
