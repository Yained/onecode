import unittest
from abstract_layout import structured_abstract
from title_layout import title_from_lines


def line(text, top, x0=198, x1=560, size=10):
    return dict(text=text, top=top, bottom=top+size, x0=x0, x1=x1, size=size)


class Page:
    width = 612
    height = 792

    def __init__(self, lines):
        self.lines = lines

    def extract_text_lines(self):
        return self.lines

    def crop(self, box):
        left, top, right, bottom = box
        return Page([item for item in self.lines if item['x0'] >= left and item['x1'] <= right
                     and item['top'] >= top and item['bottom'] <= bottom])


class StructuredLayoutTests(unittest.TestCase):
    def pages(self):
        return [Page([line('Abstract', 300, x1=270, size=14),
                      line('Background', 330),
                      line('We investigate prognostic markers in circulating cell-free DNA.', 350),
                      line('Citation: authors and journal metadata', 370, x0=36, x1=185),
                      line('Methods', 370),
                      line('We measure molecular profiles in a prospective patient cohort.', 390),
                      line('Results', 420),
                      line('The markers predict long-term outcomes in the study cohort.', 440),
                      line('Journal DOI and page 1', 770)]),
                Page([line('Funding: sidebar information', 60, x0=36, x1=185),
                      line('Conclusion', 60),
                      line('These markers improve assessment of postoperative survival.', 80),
                      line('1. Introduction', 130),
                      line('Unrelated introduction body must not enter the abstract.', 150)])]

    def test_cross_page_subsections_exclude_sidebar_and_footer(self):
        result = structured_abstract(self.pages())
        for word in ['Background', 'Methods', 'Results', 'Conclusion']:
            self.assertIn(word, result)
        self.assertTrue(result.endswith('postoperative survival.'))
        for word in ['Citation', 'Funding', 'DOI', 'Introduction', 'Unrelated']:
            self.assertNotIn(word, result)

    def test_unclosed_structured_abstract_is_not_guessed(self):
        self.assertEqual(structured_abstract(self.pages()[:1]), '')

    def test_prose_background_without_subsection_evidence_is_not_structured(self):
        pages = [Page([line('Abstract', 100), line('Background knowledge informs this scientific investigation.', 120),
                       line('1. Introduction', 150)])]
        self.assertEqual(structured_abstract(pages), '')

    def test_short_first_title_line_and_two_word_continuation(self):
        lines = [line('Journal Masthead', 20, size=22),
                 line('5-hydroxymethylcytosines from circulating', 130, size=16),
                 line('cell-free DNA as noninvasive prognostic markers', 148, size=16),
                 line('for gastric cancer', 166, size=16),
                 line('Authors and affiliations', 195), line('Abstract', 300)]
        self.assertEqual(title_from_lines(lines, 10),
                         '5-hydroxymethylcytosines from circulating cell-free DNA as noninvasive prognostic markers for gastric cancer')
        self.assertEqual(title_from_lines([line('Thermal Stability and Sublimation Pressures of Some', 100, size=16),
                                          line('Ruthenocene Compounds', 120, size=16)], 10),
                         'Thermal Stability and Sublimation Pressures of Some Ruthenocene Compounds')


if __name__ == '__main__':
    unittest.main()
