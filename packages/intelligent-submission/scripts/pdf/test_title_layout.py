import unittest
from title_layout import title_from_lines


def line(text, top, size=18, x0=70, x1=400):
    return dict(text=text, top=top, size=size, x0=x0, x1=x1)


class TitleLayoutTest(unittest.TestCase):
    def test_wrapped_title_below_editorial_notes(self):
        lines = [line('相关说明：请作者核验数据', 40, 10), line('删除了: 修改说明', 75, 10),
                 line('面向复杂文档处理的', 530), line('多模态元数据抽取方法', 555),
                 line('张三1，李四2，王五3', 585, 12), line('摘要：摘要正文', 620, 10)]
        self.assertEqual(title_from_lines(lines, 10), '面向复杂文档处理的多模态元数据抽取方法')

    def test_english_title_preserves_spaces(self):
        self.assertEqual(title_from_lines([line('A Reliable Framework for', 70), line('Structured Document Metadata Extraction', 95)], 10),
                         'A Reliable Framework for Structured Document Metadata Extraction')

    def test_no_title_in_body_or_editorial_headings(self):
        self.assertEqual(title_from_lines([line('请作者核验实验相关数据', 70), line('Abstract: paper content starts here', 95, 10), line('A Large Heading In The Body', 200, 24)], 10), '')

    def test_separate_blocks_are_not_joined(self):
        self.assertEqual(title_from_lines([line('A Reliable Framework for Document Extraction', 70), line('Additional Material for the Submitted Manuscript', 200)], 10), 'A Reliable Framework for Document Extraction')


if __name__ == '__main__':
    unittest.main()
