# Writes a small EPUB of rules 13 and 14 from Strunk's The Elements of Style
# (1918, public domain) for the demo vault's book. An EPUB, not a PDF: the
# reader sets an EPUB's text in the editor's type on the app's own ground,
# while a PDF page is always white paper.
#
#   make-book-epub.py OUT.epub
import sys, zipfile
from html import escape

TITLE = "The Elements of Style"
AUTHOR = "William Strunk Jr."
blocks = [
    ("h1", "III. Elementary Principles of Composition"),
    ("h2", "13. Omit needless words."),
    ("p", "Vigorous writing is concise. A sentence should contain no unnecessary words, a paragraph no unnecessary sentences, for the same reason that a drawing should have no unnecessary lines and a machine no unnecessary parts. This requires not that the writer make all his sentences short, or that he avoid all detail and treat his subjects only in outline, but that every word tell."),
    ("p", "Many expressions in common use violate this principle:"),
    ("ul", [
        "the question as to whether / whether",
        "there is no doubt but that / no doubt",
        "used for fuel purposes / used for fuel",
        "he is a man who / he",
        "in a hasty manner / hastily",
        "this is a subject which / this subject",
        "His story is a strange one. / His story is strange.",
    ]),
    ("p", "In especial the expression the fact that should be revised out of every sentence in which it occurs."),
    ("h2", "14. Avoid a succession of loose sentences."),
    ("p", "This rule refers especially to loose sentences of a particular type, those consisting of two co-ordinate clauses, the second introduced by a conjunction or relative."),
]


def html(block):
    tag, body = block
    if tag == "ul":
        return "<ul>" + "".join(f"<li><em>{escape(item)}</em></li>" for item in body) + "</ul>"
    return f"<{tag}>{escape(body)}</{tag}>"


chapter = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{TITLE}</title></head>
<body>{"".join(html(b) for b in blocks)}</body></html>
"""
nav = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{TITLE}</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">{escape(blocks[0][1])}</a></li></ol></nav></body></html>
"""
opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">pensee-demo-elements-of-style</dc:identifier>
    <dc:title>{TITLE}</dc:title>
    <dc:creator>{AUTHOR}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>
"""
container = """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
"""

with zipfile.ZipFile(sys.argv[1], "w") as z:
    # The mimetype comes first and uncompressed, as the EPUB spec asks.
    z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr("OEBPS/chapter.xhtml", chapter, compress_type=zipfile.ZIP_DEFLATED)
print(sys.argv[1])
