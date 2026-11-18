"""Conservative title hints from PDF typography, independent of document topic."""
import re
from collections import Counter

EXCLUDED = re.compile(r"ISSN|CODEN|https?://|doi\s*[:：]|Journal of|删除了|设置格式|批注|相关说明|修改说明|编辑说明|修订说明|作者须知|请作者|收稿|基金项目|作者简介|copyright|reviewer|editorial|revision notes", re.I)
SECTION = re.compile(r"^(?:摘\s*要|abstract|关键词|key\s*words?|引言|introduction)\b|^摘\s*要\s*[:：]", re.I)


def title_from_lines(lines, body_size):
    candidates = []
    for line in lines:
        text = line['text'].strip()
        if SECTION.match(text):
            break
        if (line['size'] < body_size * 1.3 or len(text) < 6 or len(text) > 220
                or EXCLUDED.search(text) or re.match(r'^\d+[)）、.]', text)
                or len(re.findall(r'\d', text)) > 2):
            continue
        candidates.append(line)
    if not candidates:
        return ''
    groups = []
    for line in candidates:
        previous = groups[-1][-1] if groups else None
        size = line['size']
        aligned = previous and abs(size - previous['size']) <= size * .05 and (abs(line['x0'] - previous['x0']) < size * 2 or abs((line['x0'] + line['x1']) - (previous['x0'] + previous['x1'])) < size * 4)
        if previous and aligned and 0 < line['top'] - previous['top'] <= size * 2.3 and len(groups[-1]) < 4:
            groups[-1].append(line)
        else:
            groups.append([line])
    # Validate whole blocks: a scientific title may start with a short chemical name.
    groups = [group for group in groups
              if len(re.findall(r'[A-Za-z]+', ' '.join(line['text'] for line in group))) >= 4
              or len(re.findall(r'[\u3400-\u9fff]', ''.join(line['text'] for line in group))) >= 6]
    if not groups:
        return ''
    groups.sort(key=lambda group: (-max(line['size'] for line in group), group[0]['top']))
    title = ' '.join(line['text'] for line in groups[0])
    title = re.sub(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])', '', title)
    return title if len(title) <= 220 else ''


def extract_layout_title(pdf_bytes):
    import io
    import pdfplumber
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as document:
        for page in document.pages[:3]:
            sizes = Counter(round(char['size'], 1) for char in page.chars if char['text'].strip())
            if not sizes:
                continue
            body_size = sizes.most_common(1)[0][0]
            lines = []
            for line in page.extract_text_lines():
                chars = line['chars']
                # Small side annotations can share the title's vertical position.
                size = max(char['size'] for char in chars)
                prominent = [char for char in chars if char['size'] >= size * .95]
                text = pdfplumber.utils.extract_text(prominent, x_tolerance=2, y_tolerance=3).strip()
                lines.append(dict(text=text, size=size, top=line['top'], x0=min(c['x0'] for c in prominent), x1=max(c['x1'] for c in prominent)))
            title = title_from_lines(lines, body_size)
            if title:
                return title
            if any(SECTION.match(line['text']) for line in lines):
                break
    return ''
