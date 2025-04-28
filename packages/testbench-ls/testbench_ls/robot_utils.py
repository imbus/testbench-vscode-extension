from typing import Union

from robot.api.parsing import (
    Arguments,
    Documentation,
    File,
    Keyword,
    KeywordSection,
    SettingSection,
    Tags,
    VariableSection,
)
from robot.parsing.model import Block, Statement


def get_keyword_documentation(keyword: Keyword) -> Documentation:
    return next(filter(lambda item: isinstance(item, Documentation), keyword.body), None)


def get_keyword_documentation_position(keyword: Keyword) -> tuple[int]:
    documentation = get_keyword_documentation(keyword)
    if not documentation:
        return (keyword.lineno, 0, keyword.lineno, 0)
    return (
        documentation.lineno - 1,
        documentation.col_offset,
        documentation.end_lineno - 1,
        documentation.end_col_offset,
    )


def get_keyword_arguments(keyword: Keyword) -> Arguments:
    return next(filter(lambda item: isinstance(item, Arguments), keyword.body), None)


def get_keyword_section(file: File):
    return next(filter(lambda item: isinstance(item, KeywordSection), file.sections), None)


def get_keyword_section_position(file: File) -> tuple[int]:
    keyword_section = get_keyword_section(file)
    if not keyword_section:
        return (file.end_lineno - 1, 0, file.lineno - 1, 0)
    return (
        keyword_section.lineno - 1,
        keyword_section.col_offset,
        keyword_section.end_lineno - 1,
        keyword_section.end_col_offset,
    )


def get_setting_section(file: File):
    return next(filter(lambda item: isinstance(item, SettingSection), file.sections), None)


def get_setting_section_position(file: File) -> tuple[int]:
    setting_section = get_setting_section(file)
    if not setting_section:
        return (file.end_lineno - 1, 0, file.lineno - 1, 0)
    return (
        setting_section.lineno - 1,
        setting_section.col_offset,
        setting_section.end_lineno - 1,
        setting_section.end_col_offset,
    )


def get_variables_section(file: File):
    return next(filter(lambda item: isinstance(item, VariableSection), file.sections), None)


def get_variables_section_position(file: File) -> tuple[int]:
    variables_section = get_variables_section(file)
    if not variables_section:
        return (file.end_lineno - 1, 0, file.lineno - 1, 0)
    return (
        variables_section.lineno - 1,
        variables_section.col_offset,
        variables_section.end_lineno - 1,
        variables_section.end_col_offset,
    )


def get_keyword_arguments_position(keyword: Keyword) -> tuple[int]:
    arguments = get_keyword_arguments(keyword)
    if not arguments:
        return (keyword.lineno, 0, keyword.lineno, 0)
    return (
        arguments.lineno - 1,
        arguments.col_offset,
        arguments.end_lineno - 1,
        arguments.end_col_offset,
    )


def get_keyword_tags(keyword: Keyword) -> Tags:
    return next(filter(lambda item: isinstance(item, Tags), keyword.body), None)


def get_keyword_tags_position(keyword: Keyword) -> tuple[int]:
    tags = get_keyword_tags(keyword)
    if not tags:
        return (keyword.lineno, 0, keyword.lineno, 0)
    return (tags.lineno - 1, tags.col_offset, tags.end_lineno - 1, tags.end_col_offset)


def robot_model_to_string(model_item: Union[Block, Statement]) -> str:
    return "".join(_robot_item_to_string(model_item))  # .rstrip()


def _robot_item_to_string(item):
    if isinstance(item, Block):
        if hasattr(item, "header"):
            for body_item in [item.header, *item.body]:
                yield from _robot_item_to_string(body_item)
        else:
            for body_item in item.body:
                yield from _robot_item_to_string(body_item)
    elif isinstance(item, Statement):
        yield "".join(token.value for token in item.tokens)
