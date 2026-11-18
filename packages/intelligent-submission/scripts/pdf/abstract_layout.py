"""Extract explicitly labelled PDF abstracts before figures using text geometry."""
import io
import re
from statistics import median

HEADING = re.compile(r'^(?:abstract|摘\s*要)\s*[:：]?$', re.I)
END = re.compile(r'^(?:(?:(?:\d+|[IVXLCDM]+)[.、]?\s*)?(?:introduction\b|background\b(?![ \t]*[:：])|引言|绪论)|index\s+terms\b|key\s*words?\b|关\s*键\s*[词字]|contents\b|references\b|(?:figure|table)\s*\d|[图表]\s*\d)', re.I)


def abstract_from_lines(lines):
    lines = sorted(lines, key=lambda line: (line['top'], line['x0']))
    start = next((i for i, line in enumerate(lines) if HEADING.fullmatch(line['text'].strip())), None)
    if start is None:
        return ''
    body = []
    size = None
    ended = False
    for line in lines[start + 1:]:
        text = line['text'].strip()
        if not text:
            continue
        if END.match(text):
            ended = True
            break
        if size is None:
            size = line['size']
        if body and (line['size'] < size * .8 or line['size'] > size * 1.3
                     or line['top'] - body[-1]['bottom'] > size * 2
                     or re.fullmatch(r'\d+(?:\.\d+)?', text)):
            ended = True
            break
        body.append(line)
    # An unclosed first-page block may continue on another page; use text parsing then.
    if not ended:
        return ''
    text = '\n'.join(line['text'].strip() for line in body)
    # Keep common compound prefixes while repairing typographic word breaks.
    compound = {'resource', 'content', 'state', 'long', 'short', 'high', 'low', 'real',
                'single', 'multi', 'cross', 'data', 'domain', 'model', 'task', 'self',
                'non', 'semi', 'pre', 'post', 'end', 'all', 'well',
                'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'}
    text = re.sub(r'([A-Za-z]+)-\n(?=[a-z])',
                  lambda match: match[1] + ('-' if match[1].lower() in compound else ''), text)
    text = re.sub(r'-\n(?=[A-Z])', '-', text)
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])', '', text)
    return text if 40 <= len(text) <= 16000 else ''


def lines_from_words(words):
    """Separate columns before building lines; remove only repeated number gutters."""
    gutters = {}
    for word in words:
        if re.fullmatch(r'\d{1,4}', word['text']):
            gutters.setdefault(round(word['x0'] / 5), []).append(word)
    ignored = set()
    for group in gutters.values():
        group = sorted(group, key=lambda word: word['top'])
        consecutive = sum(int(b['text']) == int(a['text']) + 1 for a, b in zip(group, group[1:]))
        if len(group) >= 5 and consecutive >= len(group) * .7:
            ignored.update(id(word) for word in group)
    rows = []
    for word in sorted(words, key=lambda word: (word['top'], word['x0'])):
        if id(word) in ignored:
            continue
        if rows and abs(word['top'] - rows[-1][0]['top']) <= 3:
            rows[-1].append(word)
        else:
            rows.append([word])
    # A narrow gutter recurs across many rows, unlike ordinary word spacing.
    # Use only central gaps and require support from independent rows.
    votes = {}
    if words:
        left = min(word['x0'] for word in words)
        right = max(word['x1'] for word in words)
        for row in rows:
            supported = set()
            ordered = sorted(row, key=lambda word: word['x0'])
            for a, b in zip(ordered, ordered[1:]):
                if b['x0'] - a['x1'] < 6:
                    continue
                for x in range(int(a['x1']) + 2, int(b['x0']) - 1):
                    if left + .35 * (right-left) < x < left + .65 * (right-left):
                        supported.add(x)
            for x in supported:
                votes[x] = votes.get(x, 0) + 1
    gutter = None
    if votes:
        center = (left + right) / 2
        x = max(votes, key=lambda x: (votes[x], -abs(x-center)))
        crossing = sum(any(word['x0'] < x < word['x1'] for word in row) for row in rows)
        if votes[x] >= max(5, len(rows) * .12) and crossing < votes[x] * .3:
            gutter = x
    lines = []
    for row in rows:
        groups = []
        for word in sorted(row, key=lambda word: word['x0']):
            if (groups and word['x0'] - groups[-1][-1]['x1'] <= max(12, word['size'] * 1.8)
                    and not (gutter is not None and groups[-1][-1]['x1'] <= gutter <= word['x0'])):
                groups[-1].append(word)
            else:
                groups.append([word])
        for group in groups:
            lines.append(dict(text=' '.join(word['text'] for word in group),
                              x0=group[0]['x0'], x1=group[-1]['x1'],
                              top=min(word['top'] for word in group),
                              bottom=max(word['bottom'] for word in group),
                              size=median(word['size'] for word in group)))
    return lines


def column_abstract(lines):
    """Infer the abstract column from the lines directly below its heading."""
    expanded = []
    for line in lines:
        inline = re.match(r'^(abstract|摘\s*要)\s*[:：—–-]\s*(\S.*)$', line['text'], re.I)
        if inline:
            expanded.append({**line, 'text': inline[1], 'top': line['top'] - .02,
                             'bottom': line['top'] - .01,
                             'x1': line['x0'] + len(inline[1]) * line['size'] * .5})
            expanded.append({**line, 'text': inline[2]})
        else:
            expanded.append(line)
    lines = expanded
    for heading in lines:
        if not HEADING.fullmatch(heading['text'].strip()):
            continue
        center = (heading['x0'] + heading['x1']) / 2
        below = sorted([line for line in lines if line['top'] > heading['bottom']
                        and line['x0'] - 3 <= center <= line['x1'] + 3
                        and len(line['text']) > 30], key=lambda line: line['top'])[:6]
        if not below or below[0]['top'] - heading['bottom'] > heading['size'] * 4:
            continue
        left = min(line['x0'] for line in below)
        right = max(line['x1'] for line in below)
        column = [heading] + [line for line in lines if line['top'] > heading['bottom']
                              and line['x0'] >= left - 5 and line['x1'] <= right + 5]
        result = abstract_from_lines(column)
        if result:
            return result
    return ''


def extract_layout_abstract(pdf_bytes):
    import pdfplumber
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as document:
        structured = structured_abstract(document.pages[:4])
        if structured:
            return structured
        for page in document.pages[:3]:
            words = []
            for word in page.dedupe_chars().extract_words(x_tolerance=1, return_chars=True):
                sizes = [char['size'] for char in word['chars'] if char['text'].strip()]
                if sizes:
                    words.append({**word, 'size': median(sizes)})
            result = column_abstract(lines_from_words(words))
            if result:
                return result
    return ''


SUBSECTION = re.compile(r'^(background|objectives?|aims?|methods?|materials? and methods?|results?|conclusions?|findings|interpretation)\s*[:：]?$', re.I)
STRUCTURED_END = re.compile(r'^(?:(?:\d+|[IVXLCDM]+)[.、]?\s+(?:introduction|background|methods?)\b|introduction\b|index\s+terms\b|key\s*words?\b|references\b|引言|关键词)', re.I)


def structured_abstract(pages):
    """Read a structured abstract within its text column, including following pages.

    Cropping BEFORE line construction prevents marginal citation/funding text from
    entering the same line as the abstract. Require subsection and end evidence.
    """
    for page_index, page in enumerate(pages[:3]):
        for heading in page.extract_text_lines():
            if not HEADING.fullmatch(heading['text'].strip()):
                continue
            left = max(0, heading['x0'] - 3)
            right = page.width - 24
            if heading['x0'] < page.width * .25:
                # A left-column abstract must not consume its neighbouring column.
                words = []
                for word in page.extract_words(return_chars=True):
                    words.append({**word, 'size': median(c['size'] for c in word['chars'])})
                below = [line for line in lines_from_words(words)
                         if heading['bottom'] < line['top'] < heading['bottom'] + 180
                         and abs(line['x0'] - heading['x0']) < 15 and len(line['text']) > 30]
                if below:
                    right = min(right, max(line['x1'] for line in below) + 5)
            body = []
            subsections = set()
            ended = False
            for index in range(page_index, len(pages)):
                current = pages[index]
                top = heading['bottom'] + 1 if index == page_index else 45
                if right > current.width or top >= current.height - 45:
                    break
                lines = current.crop((left, top, right, current.height - 45)).extract_text_lines()
                for line in lines:
                    text = line['text'].strip()
                    if not text:
                        continue
                    if STRUCTURED_END.match(text):
                        ended = True
                        break
                    match = SUBSECTION.fullmatch(text)
                    if not body and not match:
                        break
                    if match:
                        subsections.add(match[1].lower())
                    body.append(text)
                if ended or not body:
                    break
            if ended and len(subsections) >= 2:
                text = '\n'.join(body)
                text = re.sub(r'([A-Za-z]+)-\n(?=[a-z])',
                              lambda m: m[1] + ('-' if m[1].lower() in {'high', 'low', 'long', 'short', 'cell', 'risk', 'non', 'multi', 'single'} else ''), text)
                text = re.sub(r'\s+', ' ', text).strip()
                if 80 <= len(text) <= 16000:
                    return text
    return ''
