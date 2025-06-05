import re
from pathlib import Path

from robot.api.parsing import (
    Arguments,
    Comment,
    CommentSection,
    Documentation,
    EmptyLine,
    File,
    Keyword,
    KeywordName,
    KeywordSection,
    SectionHeader,
    SettingSection,
    Tags,
    Token,
    get_model,
)
from robot.parsing.model import Block, Statement


class TestBenchResourceModel:
    def __init__(self, path: Path, load_existing=False):
        self._setting_section = None
        self._comment_section = None
        self._keyword_section = None
        if load_existing:
            self.file = get_model(path)
        else:
            self.file: File = File(
                [
                    CommentSection(header=SectionHeader.from_params(Token.COMMENT_HEADER)),
                    SettingSection(header=SectionHeader.from_params(Token.SETTING_HEADER)),
                    KeywordSection(header=SectionHeader.from_params(Token.KEYWORD_HEADER)),
                ],
                source=path,
            )

    def get_resource_file_end_position(self):
        return (self.file.sections[-1].end_lineno, self.file.sections[-1].end_col_offset)

    def __str__(self):
        file_strings = []
        for section in self.file.sections:
            file_strings.append("".join(token.value for token in section.header.tokens))
            for item in section.body:
                file_strings.append("".join(self.rf_item_to_string(item)))
        return "".join(file_strings)

    def rf_item_to_string(self, item):
        if isinstance(item, Block):
            if hasattr(item, "header"):
                for body_item in [item.header, *item.body]:
                    yield from self.rf_item_to_string(body_item)
            else:
                for body_item in item.body:
                    yield from self.rf_item_to_string(body_item)
        elif isinstance(item, Statement):
            yield "".join(token.value for token in item.tokens)

    def __eq__(self, other):
        objects_are_equal = True
        if self.tb_subdivision_uid != other.tb_subdivision_uid:
            print("Resource files have mismatching uids.")
            return False
        if self.file.source != other.file.source:
            print(f"Resource files with uid {self.tb_subdivision_uid} have mismatching paths.")
            objects_are_equal = False
        if self.documentation != other.documentation:
            print(
                f"Resource files with uid {self.tb_subdivision_uid} have mismatching documentation."
            )
            objects_are_equal = False
        for kw in other.keywords:
            kw_uid = other.get_kw_uid(kw)
            kws_with_same_uid = self.get_keywords(kw_uid)
            if not kws_with_same_uid:
                print(f"Keyword '{kw.header[0]}' has been deleted.")
                objects_are_equal = False
            elif len(kws_with_same_uid) > 1:
                print(
                    f"Multiple keywords with uid '{kw_uid}' found in resource file with uid {self.tb_subdivision_uid}."
                )
                objects_are_equal = False
            elif str(kw.header[0]) != str(kws_with_same_uid[0].header[0]):
                print(
                    f"Keywordname has changed from '{kw.header[0]}' to '{kws_with_same_uid[0].header[0]}',"
                )
        if self.keyword_names != other.keyword_names:
            print(f"Resource files with uid {self.tb_subdivision_uid} contain different keywords.")
            objects_are_equal = False
        return objects_are_equal

    @classmethod
    def from_file(cls, path: Path):
        robot_resource_file = cls(path, True)
        return robot_resource_file

    @property
    def comments(self) -> list[str]:
        if not self.comment_section:
            return ""
        return [
            token.value
            for comment in self.comment_section.body
            for token in comment
            if isinstance(comment, Comment)
        ]

    @property
    def tb_subdivision_uid(self) -> str:
        uid_match = re.search(r".*tb:uid:(?P<tb_uid>.*$)", "".join(self.comments), re.MULTILINE)
        if uid_match:
            return uid_match.group("tb_uid").strip()
        return ""

    @property
    def tb_tov_context(self) -> tuple[str, str]:
        context_match = re.search(
            r".*tb:context:(?P<tb_context>.*$)", "".join(self.comments), re.MULTILINE
        )
        if context_match:
            return tuple(map(str.strip, context_match.group("tb_context").split("/", 1)))
        return ("", "")

    @property
    def keyword_names(self) -> list[str]:
        return [keyword.name for keyword in self.keyword_section.body]

    @property
    def keywords(self):
        if not self.keyword_section:
            return []
        keywords = filter(lambda item: isinstance(item, Keyword), self.keyword_section.body)
        return keywords or []

    @property
    def documentation(self):
        if not self.setting_section:
            return ""
        return next(
            filter(lambda item: isinstance(item, Documentation), self.setting_section.body),
            Documentation(tokens=[]),
        ).value

    @property
    def keyword_section(self):
        if not self._keyword_section:
            self._keyword_section = next(
                (section for section in self.file.sections if isinstance(section, KeywordSection)),
                None,
            )
        return self._keyword_section

    @property
    def comment_section(self):
        if not self._comment_section:
            self._comment_section = next(
                (section for section in self.file.sections if isinstance(section, CommentSection)),
                None,
            )
        return self._comment_section

    @property
    def setting_section(self):
        if not self._setting_section:
            self._setting_section = next(
                (section for section in self.file.sections if isinstance(section, SettingSection)),
                None,
            )
        return self._setting_section

    def add_comment(self, comment: str):
        if not comment or comment in self.comments:
            return
        self.comment_section.body.extend(
            [
                Comment.from_params(
                    comment,
                    indent="",
                ),
                EmptyLine.from_params(),
                EmptyLine.from_params(),
            ]
        )

    def add_documentation(self, documentation: str):
        if not documentation or self.documentation:
            return
        self.setting_section.body.extend(
            [
                Documentation.from_params(documentation),
                EmptyLine.from_params(),
                EmptyLine.from_params(),
            ]
        )

    def add_keyword(
        self,
        name,
        args: list[str] | None = None,
        tags: list[str] | None = None,
        documentation: str | None = None,
    ):
        if name in self.keyword_names:
            return
        kw = Keyword(
            header=KeywordName.from_params(name),
            body=[
                Comment.from_params("# Not Implemented"),
                # KeywordCall.from_params("Fail", args=("Not Implemented",)),
                EmptyLine.from_params(),
            ],
        )
        if tags:
            kw_tags = Tags.from_params(tags)
            kw.body.insert(0, kw_tags)
        if args:
            kw_arguments = Arguments.from_params(
                [
                    f"${{{arg.strip('*').strip()}}}"
                    if not arg.startswith("$")
                    and not arg.startswith("@")
                    and not arg.startswith("&")
                    else arg
                    for arg in args
                ]
            )
            kw.body.insert(0, kw_arguments)
        if documentation:
            doc = Documentation.from_params(documentation, settings_section=False)
            kw.body.insert(0, doc)
        self.keyword_section.body.append(kw)

    def get_keywords(self, uid: str) -> list[Keyword]:
        keywords = []
        for kw in self.keywords:
            tags = self.get_kw_tags(kw)
            if f"tb:uid:{uid}" in tags:
                keywords.append(kw)
        return keywords

    def get_kw_tags(self, kw: Keyword) -> list[str]:
        tags = []
        for item in kw.body:
            if isinstance(item, Tags):
                tags = list(item.values)
        return tags

    def get_kw_uid(self, kw: Keyword) -> str:
        tags = self.get_kw_tags(kw)
        for tag in tags:
            uid_match = re.match(r".*tb:uid:(?P<tb_uid>.*$)", tag)
            if uid_match:
                return uid_match.group("tb_uid")
        return ""

    def save(self):
        self.file.save()
