import unittest
from abstract_layout import abstract_from_lines, lines_from_words, column_abstract


def line(text, top, size=11):
    return dict(text=text, top=top, bottom=top+size, size=size, x0=50)


class AbstractLayoutTests(unittest.TestCase):
    def test_chart_labels_are_excluded_even_with_scrambled_pdf_order(self):
        lines = [line('Abstract', 20, 15),
                 line('We present a reproducible scientific document ranking method.', 40),
                 line('Experiments compare methods and validate the results.', 55),
                 line('Figure 1 Comparison of methods', 160), line('1.2', 80, 5)]
        self.assertEqual(abstract_from_lines(lines),
                         'We present a reproducible scientific document ranking method. Experiments compare methods and validate the results.')

    def test_structured_abstract_preserves_background_and_methods(self):
        lines = [line('Abstract', 20, 15), line('Background: Scientific document analysis requires robust extraction.', 40),
                 line('Methods: We compare several approaches on a controlled dataset.', 55),
                 line('1 Introduction', 75, 14)]
        self.assertIn('Methods: We compare', abstract_from_lines(lines))

    def test_no_heading_or_unclosed_page_does_not_invent_abstract(self):
        body = line('We evaluate a robust extraction method across diverse documents.', 40)
        self.assertEqual(abstract_from_lines([body]), '')
        self.assertEqual(abstract_from_lines([line('Abstract', 20, 15), body]), '')

    def test_two_columns_keep_heading_separate_and_remove_review_numbers(self):
        words = []
        def add(text, x, top, size=10):
            words.append(dict(text=text, x0=x, x1=x+len(text)*4, top=top, bottom=top+size, size=size))
        add('Abstract', 100, 30, 12)
        add('Unrelated right column introduction', 310, 30)
        for i, text in enumerate(['We evaluate scientific document extraction.',
                                  'The approach preserves the correct reading order.',
                                  'Experiments cover multiple document layouts.',
                                  'The results improve extraction accuracy.',
                                  'No unrelated introduction text is included.']):
            add(str(i+1).zfill(3), 20, 50+i*13, 8)
            add(text, 60, 50+i*13)
            add('Other column discussion of unrelated findings.', 310, 50+i*13)
            add(str(i+41).zfill(3), 530, 50+i*13, 8)
        add('1. Introduction', 60, 125, 12)
        result = column_abstract(lines_from_words(words))
        self.assertTrue(result.startswith('We evaluate scientific'))
        self.assertTrue(result.endswith('text is included.'))
        self.assertNotIn('Other column', result)
        self.assertNotIn('001', result)

    def test_numeric_results_in_prose_are_not_treated_as_review_gutters(self):
        words = [dict(text='2.81M', x0=60, x1=90, top=50, bottom=60, size=10),
                 dict(text='parameters', x0=94, x1=150, top=50, bottom=60, size=10)]
        self.assertEqual(lines_from_words(words)[0]['text'], '2.81M parameters')

    def test_hyphenated_compounds_and_wrapped_words(self):
        result = abstract_from_lines([line('Abstract', 20, 15),
                 line('The method works on resource-', 40),
                 line('constrained devices and improves appli-', 55),
                 line('cations with content-adaptive processing.', 70),
                 line('1 Introduction', 90, 14)])
        self.assertIn('resource-constrained', result)
        self.assertIn('applications', result)

    def test_ieee_inline_abstract_narrow_gutter_and_index_terms(self):
        words = []
        sentences = ['Abstract—Specular highlight detection removes reflected light.',
                     'We propose a three-stage network to restore image quality.',
                     'A learned mask guides feature fusion and refinement.',
                     'The network preserves texture and removes highlights.',
                     'Experiments demonstrate accurate image restoration.',
                     'The results recover details obscured by highlights.',
                     'Index Terms—Image restoration, highlight removal',
                     'I. INTRODUCTION']
        for i, sentence in enumerate(sentences):
            words.append(dict(text=sentence, x0=49, x1=300, top=200+i*12,
                              bottom=209+i*12, size=9))
            words.append(dict(text='Unrelated right column introduction and references [1].',
                              x0=312, x1=563, top=201+i*12, bottom=211+i*12, size=10))
        result = column_abstract(lines_from_words(words))
        self.assertTrue(result.startswith('Specular highlight detection'))
        self.assertTrue(result.endswith('obscured by highlights.'))
        self.assertNotIn('Unrelated', result)
        self.assertNotIn('Index Terms', result)
        self.assertNotIn('INTRODUCTION', result)

    def test_inline_colon_abstract_and_roman_section_end(self):
        lines = [dict(text='Abstract: We evaluate reliable extraction from scientific documents.',
                      x0=50, x1=300, top=30, bottom=40, size=10),
                 dict(text='The method preserves complete content and avoids unrelated text.',
                      x0=50, x1=300, top=44, bottom=54, size=10),
                 dict(text='I. INTRODUCTION',x0=50,x1=160,top=65,bottom=75,size=10)]
        result=column_abstract(lines)
        self.assertTrue(result.startswith('We evaluate'))
        self.assertTrue(result.endswith('unrelated text.'))

    def test_numeric_compound_prefix_is_preserved(self):
        result=abstract_from_lines([line('Abstract',20,15),
                 line('The proposed approach uses a three-',40),
                 line('stage network for image restoration and detail recovery.',55),
                 line('Index Terms—Image restoration',75)])
        self.assertIn('three-stage network',result)
        self.assertNotIn('Index Terms',result)


if __name__ == '__main__':
    unittest.main()
