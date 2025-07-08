from lsprotocol.types import (
    AnnotatedTextEdit,
    Position,
    Range,
)
from robot.api.parsing import Keyword, Tags, Token

from .testbench_resource.resource_utils import (
    get_keyword_tags,
    get_keyword_tags_position,
    robot_model_to_string,
)


def get_tags_values(tags: Tags) -> list[str]:
    if not tags:
        return []
    return [tag.value for tag in tags if tag.type not in [Token.TAGS, Token.SEPARATOR, Token.EOL]]


def get_kw_tags_edit(
    existing_keyword: Keyword, new_keyword: Keyword, change_identifier: str
) -> AnnotatedTextEdit | None:
    existing_keyword_tags = get_tags_values(get_keyword_tags(existing_keyword))
    if "robot:private" in existing_keyword_tags:
        return None
    new_tags = get_tags_values(get_keyword_tags(new_keyword))
    additional_tags = [tag for tag in existing_keyword_tags if not tag.startswith("tb:")]
    new_tags.extend(additional_tags)
    all_tags = Tags.from_params(new_tags, eol="")
    if get_tags_values(all_tags) == existing_keyword_tags:
        return None
    tags_start, tags_start_char, tags_end, tags_end_char = get_keyword_tags_position(
        existing_keyword
    )
    new_tags_txt = robot_model_to_string(all_tags)

    tags_edit = AnnotatedTextEdit(
        change_identifier,
        range=Range(
            start=Position(tags_start, tags_start_char),
            end=Position(tags_end, tags_end_char),
        ),
        new_text=f"{new_tags_txt}{'' if existing_keyword_tags else '\n'}",
    )
    return tags_edit
