from html.parser import HTMLParser


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []

    def handle_data(self, data):
        self.text.append(data)

    def get_text(self):
        return "".join(self.text).strip()


def extract_text_from_html(html):
    html = html.replace('&nbsp;', ' ')
    parser = TextExtractor()
    parser.feed(html)
    return parser.get_text().strip().replace('\n', '\n    ...').replace('\u00A0',' ')
