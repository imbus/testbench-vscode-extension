from lsprotocol.types import (
    AnnotatedTextEdit,
    Position,
    Range,
)
from robot.api.parsing import (
    Keyword,
)

from .testbench_resource.resource_utils import (
    get_keyword_tags,
    get_keyword_tags_position,
    robot_model_to_string,
)
from .testbench_resource.testbench_resource_model import get_kw_uid


def get_kw_tags_edit(
    existing_keyword: Keyword, new_keyword: Keyword, change_identifier: str
) -> AnnotatedTextEdit | None:
    existing_keyword_tags = robot_model_to_string(get_keyword_tags(existing_keyword))
    new_keyword_uid = f"tb:uid:{get_kw_uid(new_keyword)}"
    if (
        new_keyword_uid not in existing_keyword_tags
        and "robot:private" not in existing_keyword_tags
    ):
        _, _, tags_end, tags_end_char = get_keyword_tags_position(existing_keyword)
        if tags_end_char == 0:
            new_tags = robot_model_to_string(get_keyword_tags(new_keyword))

        tags_edit = AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(tags_end, tags_end_char),
                end=Position(tags_end, tags_end_char),
            ),
            new_text=new_tags,
        )
        return tags_edit
