import re

from lsprotocol.types import (
    AnnotatedTextEdit,
    Position,
    Range,
)
from robot.api.parsing import Arguments, Documentation, Keyword, Tags, Token

from .messages import IGNORE_TAGS
from .testbench_resource.resource_utils import (
    get_keyword_arguments,
    get_keyword_arguments_position,
    get_keyword_documentation,
    get_keyword_documentation_position,
    get_keyword_tags,
    get_keyword_tags_position,
    robot_model_to_string,
)


def get_tags_values(tags: Tags) -> list[str]:
    if not tags:
        return []
    return [
        tag.value
        for tag in tags
        if tag.type not in [Token.TAGS, Token.SEPARATOR, Token.EOL, Token.CONTINUATION]
    ]


def get_argument_values(arguments: Arguments) -> list[str]:
    if not arguments:
        return []
    return [
        arg.value
        for arg in arguments
        if arg.type not in [Token.ARGUMENTS, Token.SEPARATOR, Token.EOL, Token.CONTINUATION]
    ]


def get_documentation_values(documentation: Documentation) -> list[str]:
    if not documentation:
        return []
    return [
        doc.value
        for doc in documentation
        if doc.type not in [Token.DOCUMENTATION, Token.SEPARATOR, Token.EOL, Token.CONTINUATION]
    ]


def get_kw_tags_edit(
    existing_keyword: Keyword, new_keyword: Keyword, change_identifier: str
) -> AnnotatedTextEdit | None:
    existing_keyword_tags = get_tags_values(get_keyword_tags(existing_keyword))
    if any(tag in existing_keyword_tags for tag in IGNORE_TAGS):
        return None
    new_tags = get_tags_values(get_keyword_tags(new_keyword))
    additional_tags = [tag for tag in existing_keyword_tags if not tag.startswith("tb:")]
    new_tags.extend(additional_tags)
    all_tags = Tags.from_params(new_tags)
    if get_tags_values(all_tags) == existing_keyword_tags:
        return None
    tags_start, tags_start_char, tags_end, tags_end_char = get_keyword_tags_position(
        existing_keyword
    )
    new_tags_txt = robot_model_to_string(all_tags)
    newline = "" if existing_keyword_tags else "\n"
    tags_edit = AnnotatedTextEdit(
        change_identifier,
        range=Range(
            start=Position(tags_start, tags_start_char),
            end=Position(tags_end, tags_end_char),
        ),
        new_text=f"{new_tags_txt}{newline}",
    )
    return tags_edit


def get_kw_arguments_edit(
    existing_keyword: Keyword, new_keyword: Keyword, change_identifier: str
) -> AnnotatedTextEdit | None:
    existing_arguments = get_argument_values(get_keyword_arguments(existing_keyword))
    new_arguments = get_argument_values(get_keyword_arguments(new_keyword))
    if existing_arguments == new_arguments:
        return None
    arg_start, arg_start_char, arg_end, arg_end_char = get_keyword_arguments_position(
        existing_keyword
    )
    new_args_txt = robot_model_to_string(get_keyword_arguments(new_keyword))
    newline = "" if existing_arguments else "\n"
    return AnnotatedTextEdit(
        change_identifier,
        range=Range(
            start=Position(arg_start, arg_start_char),
            end=Position(arg_end, arg_end_char),
        ),
        new_text=f"{new_args_txt}{newline}",
    )


def _normalize_whitespace(text):
    return re.sub(r" {5,}", "    ", text)


def get_kw_documentation_edit(
    existing_keyword: Keyword, new_keyword: Keyword, change_identifier: str
) -> AnnotatedTextEdit | None:
    existing_documentation = get_documentation_values(get_keyword_documentation(existing_keyword))
    new_documentation = get_documentation_values(get_keyword_documentation(new_keyword))
    if re.sub(" ", "", "".join(existing_documentation)) == re.sub(
        " ", "", "".join(new_documentation)
    ):
        return None
    new_docu_txt = robot_model_to_string(get_keyword_documentation(new_keyword))
    new_docu_txt = _normalize_whitespace(new_docu_txt)
    doc_start, doc_start_char, doc_end, doc_end_char = get_keyword_documentation_position(
        existing_keyword
    )
    newline = "" if existing_documentation else "\n"
    return AnnotatedTextEdit(
        change_identifier,
        range=Range(
            start=Position(doc_start, doc_start_char),
            end=Position(doc_end, doc_end_char),
        ),
        new_text=f"{new_docu_txt}{newline}",
    )
