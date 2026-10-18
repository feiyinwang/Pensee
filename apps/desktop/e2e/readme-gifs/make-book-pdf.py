# Writes a small book-sized PDF of rules 13 and 14 from Strunk's The Elements
# of Style (1918, public domain) for the demo vault's book.
import sys, textwrap
W, H, M = 396, 612, 54
blocks = [
 ("F2", 13, "III. ELEMENTARY PRINCIPLES OF COMPOSITION", 0),
 ("F1", 11, "", 0),
 ("F2", 12, "13. Omit needless words.", 0),
 ("F1", 12, "Vigorous writing is concise. A sentence should contain no unnecessary words, a paragraph no unnecessary sentences, for the same reason that a drawing should have no unnecessary lines and a machine no unnecessary parts. This requires not that the writer make all his sentences short, or that he avoid all detail and treat his subjects only in outline, but that every word tell.", 1),
 ("F1", 12, "Many expressions in common use violate this principle:", 1),
 ("F3", 12, "the question as to whether  /  whether", 0),
 ("F3", 12, "there is no doubt but that  /  no doubt", 0),
 ("F3", 12, "used for fuel purposes  /  used for fuel", 0),
 ("F3", 12, "he is a man who  /  he", 0),
 ("F3", 12, "in a hasty manner  /  hastily", 0),
 ("F3", 12, "this is a subject which  /  this subject", 0),
 ("F3", 12, "His story is a strange one.  /  His story is strange.", 0),
 ("F1", 12, "", 0),
 ("F1", 12, "In especial the expression the fact that should be revised out of every sentence in which it occurs.", 1),
 ("F2", 12, "14. Avoid a succession of loose sentences.", 0),
 ("F1", 12, "This rule refers especially to loose sentences of a particular type, those consisting of two co-ordinate clauses, the second introduced by a conjunction or relative.", 1),
]
lines = []
for f, size, text, gap in blocks:
    for l in (textwrap.wrap(text, 52) or [""]): lines.append((f, size, l))
    if gap: lines.append(("F1", size, ""))
def esc(s): return s.replace("\\","\\\\").replace("(","\\(").replace(")","\\)")
pages, cur, y = [], [], H - M
for f, size, text in lines:
    step = size * 1.55
    if y - step < M: pages.append(cur); cur, y = [], H - M
    y -= step; cur.append((f, size, y, text))
pages.append(cur)
objs = ["<< /Type /Catalog /Pages 2 0 R /Info 0 >>", None]
kids = []
for i, pg in enumerate(pages):
    pg = pg + [("F1", 10, M - 24, str(24 + i))]
    stream = "".join(f"BT /{f} {s} Tf {M if t[:1] != '2' else W/2 - 6} {y:.1f} Td ({esc(t)}) Tj ET\n" for f, s, y, t in pg)
    objs.append(f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}endstream")
    content = len(objs)
    objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Contents {content} 0 R /Resources << /Font << /F1 FONT1 0 R /F2 FONT2 0 R /F3 FONT3 0 R >> >> >>")
    kids.append(len(objs))
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>"); f1 = len(objs)
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>"); f2 = len(objs)
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>"); f3 = len(objs)
objs.append("<< /Title (The Elements of Style) /Author (William Strunk Jr.) >>"); info = len(objs)
objs = [o.replace("FONT1", str(f1)).replace("FONT2", str(f2)).replace("FONT3", str(f3)) if o else o for o in objs]
objs[0] = "<< /Type /Catalog /Pages 2 0 R >>"
objs[1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>"
out = b"%PDF-1.4\n"; offs = []
for i, o in enumerate(objs):
    offs.append(len(out)); out += f"{i+1} 0 obj\n{o}\nendobj\n".encode("latin-1")
x = len(out)
out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode() + "".join(f"{o:010d} 00000 n \n" for o in offs).encode()
out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R /Info {info} 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
open(sys.argv[1], "wb").write(out); print(len(pages), "pages")
