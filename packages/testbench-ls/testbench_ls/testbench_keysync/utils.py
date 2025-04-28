import re

from markdownify import MarkdownConverter


class RobotDocumentationConverter(MarkdownConverter):
    def __init__(self, **options):
        super().__init__(
            **options,
            escape_asterisks=False,
            escape_underscores=False,
            escape_misc=False,
            wrap=True,
            wrap_width=80,
        )

    def convert_b(self, el, text, parent_tags):
        robot_text = re.sub(
            r"\*\*", "*", super().convert_b(el, text, parent_tags), flags=re.MULTILINE
        )
        return robot_text

    def convert_i(self, el, text, parent_tags):
        text = text.replace("*", "<b>")
        return super().convert_i(el, text, parent_tags).replace("*", "_").replace("<b>", "*")

    def convert_th(self, el, text, parent_tags):
        text = f"= {text} ="
        return f"{super().convert_th(el, text, parent_tags)}"

    def convert_table(self, el, text, parent_tags):
        return re.sub(
            r"^\|[\s\-\|]*\|\n",
            "",
            super().convert_table(el, text, parent_tags),
            flags=re.MULTILINE,
        )

    def convert_li(self, el, text, parent_tags):
        return re.sub(
            r"^\*|\d+\.", r"-", super().convert_li(el, text, parent_tags), flags=re.MULTILINE
        )

    def convert_code(self, el, text, parent_tags):
        robot_text = re.sub(
            r"`", r"``", super().convert_code(el, text, parent_tags), flags=re.MULTILINE
        )
        return robot_text

    def convert_a(self, el, text, parent_tags):
        robot_text = re.sub(
            r"<|>|`", r"", super().convert_code(el, text, parent_tags), flags=re.MULTILINE
        )
        return robot_text

    def convert_pre(self, el, text, parent_tags):
        robot_text = (
            super()
            .convert_pre(el, text, parent_tags)
            .replace("```", "")
            .replace("\n", "\n| ")
            .strip("\n |")
        )
        return f"| {robot_text}"

    def _convert_hn(self, n, el, text, parent_tags):
        text = f"{int(n - 1) * '='} {text} {int(n - 1) * '='}"
        return super()._convert_hn(n, el, text, parent_tags).replace("#", "")


def html_2_robot(html: str, **options) -> str:
    return RobotDocumentationConverter(heading_style="ATX_CLOSED", **options).convert(html).strip()
