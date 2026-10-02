// Helpers that reproduce the look of the department report template (Times New Roman 12 pt, justified, centred cover pages).
const fs = require('fs');
const path = require('path');
const D = require('docx');
const { Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, ShadingType, ImageRun, PageBreak, HeadingLevel } = D;

const FONT = 'Times New Roman';
const IMG = path.join(__dirname, 'report_img');
const DIMS = JSON.parse(fs.readFileSync(path.join(IMG, 'dims.json'), 'utf8'));
const W = 9026; // A4 (11906) minus 1.0" side margins (1440 each)

const t = (text, o = {}) => new TextRun({ text, font: FONT, size: 24, ...o });
const bold = (text, o = {}) => t(text, { bold: true, ...o });
const ital = (text, o = {}) => t(text, { italics: true, ...o });

// rich text: **bold** and *italic* inline markers
function rich(s, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  s.split(re).forEach(p => {
    if (!p) return;
    if (p.startsWith('**')) out.push(t(p.slice(2, -2), { bold: true, ...base }));
    else if (p.startsWith('*')) out.push(t(p.slice(1, -1), { italics: true, ...base }));
    else out.push(t(p, base));
  });
  return out;
}

const para = (s, o = {}) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 340 }, ...o, children: rich(s, o.run || {}) });
const center = (s, o = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: o.after ?? 120, before: o.before ?? 0, line: 300 }, children: [t(s, o.run || {})] });
const chapter = (n, title) => [
  new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 200, after: 280 }, children: [bold(`CHAPTER ${n}`, { size: 28 }), new TextRun({ text: '', break: 1 }), bold(title, { size: 32 })] })
];
const unnumbered = title => [
  new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 200, after: 280 }, children: [bold(title, { size: 32 })] })
];
const sec = s => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 280, after: 140 }, children: [bold(s, { size: 28 })] });
const sub = s => new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, spacing: { before: 200, after: 100 }, children: [bold(s, { size: 24 })] });
const bullets = items => items.map(s => new Paragraph({ numbering: { reference: 'bul', level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 80, line: 320 }, children: rich(s) }));
const numbered = (items, ref = 'num') => items.map(s => new Paragraph({ numbering: { reference: ref, level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 80, line: 320 }, children: rich(s) }));
const eq = s => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 160 }, children: [t(s, { italics: true })] });
const blank = () => new Paragraph({ spacing: { after: 120 }, children: [] });

let figN = 0, tabN = 0;
const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: border, bottom: border, left: border, right: border };
function figure(file, caption, widthPx = 560) {
  figN++;
  const [w, h] = DIMS[file];
  const height = Math.round(widthPx * h / w);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 80 }, children: [new ImageRun({ type: 'jpg', data: fs.readFileSync(path.join(IMG, file)), transformation: { width: widthPx, height }, altText: { title: caption, description: caption, name: file } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [bold(`Figure ${figN}: `, { size: 22 }), t(caption, { size: 22 })] })
  ];
}
function table(widths, header, rows, caption, opt = {}) {
  const sum = widths.reduce((a, b) => a + b, 0);
  const sz = opt.size || 21;
  const mk = (txt, i, head) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders, margins: { top: 70, bottom: 70, left: 100, right: 100 },
    shading: head ? { fill: 'D9D9D9', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    children: String(txt).split('\n').map(line => new Paragraph({ alignment: opt.center && i > 0 ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 20, line: 260 }, children: rich(line, { size: sz, bold: head ? true : undefined }) }))
  });
  const out = [];
  if (caption) { tabN++; out.push(new Paragraph({ keepNext: true, alignment: AlignmentType.CENTER, spacing: { before: 160, after: 100 }, children: [bold(`Table ${tabN}: `, { size: 22 }), t(caption, { size: 22 })] })); }
  out.push(new Table({ width: { size: sum, type: WidthType.DXA }, columnWidths: widths, rows: [new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => mk(h, i, true)) }), ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => mk(c, i, false)) }))] }));
  out.push(blank());
  return out;
}
const logo = (wpx = 300) => { const [w, h] = DIMS['sies_logo.png']; return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(path.join(IMG, 'sies_logo.png')), transformation: { width: wpx, height: Math.round(wpx * h / w) }, altText: { title: 'SIES logo', description: 'SIES Graduate School of Technology logo', name: 'logo' } })] }); };

module.exports = { D, t, bold, ital, rich, para, center, chapter, unnumbered, sec, sub, bullets, numbered, eq, blank, figure, table, logo, W, FONT };
