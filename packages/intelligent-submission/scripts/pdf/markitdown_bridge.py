#!/usr/bin/env python3
"""Convert one PDF from stdin to Markdown on stdout using Microsoft MarkItDown.

MarkItDown is MIT licensed by Microsoft Corporation. The project pins version
0.1.7 and invokes only its PDF converter, avoiding path or URL handling for
untrusted uploads.
"""

from __future__ import annotations

import io
import json
import sys

from markitdown import StreamInfo
from markitdown.converters._pdf_converter import PdfConverter


def main() -> None:
    pdf_bytes = sys.stdin.buffer.read(16 * 1024 * 1024)
    if not pdf_bytes.startswith(b"%PDF-"):
        raise SystemExit("Input is not a PDF stream")
    result = PdfConverter().convert(
        io.BytesIO(pdf_bytes),
        StreamInfo(extension=".pdf", mimetype="application/pdf"),
    )
    if '--metadata' in sys.argv:
        from title_layout import extract_layout_title
        try:
            title = extract_layout_title(pdf_bytes)
        except Exception:
            # A layout hint must never prevent normal Markdown extraction.
            title = ''
        from abstract_layout import extract_layout_abstract
        try:
            abstract = extract_layout_abstract(pdf_bytes)
        except Exception:
            abstract = ''
        # Preserve complete front pages for model extraction, independent of heuristic boundaries.
        metadata_text = ''
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as document:
                metadata_text = '\n\n'.join(page.extract_text(x_tolerance=2, y_tolerance=6) or '' for page in document.pages[:4])
        except Exception:
            pass
        sys.stdout.write(json.dumps({'markdown': result.markdown, 'title': title, 'abstract': abstract, 'metadataText': metadata_text}, ensure_ascii=False))
    else:
        sys.stdout.write(result.markdown)


if __name__ == "__main__":
    main()
