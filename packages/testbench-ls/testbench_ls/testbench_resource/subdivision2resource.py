from robot.api.parsing import (
    Arguments,
    Comment,
    Documentation,
    Keyword,
    KeywordName,
    Tags,
)

from ..ls_exceptions import TestBenchKeywordNotFound
from ..testbench_api.legacy_model import (
    get_interaction_key,
    get_interaction_parent_key,
    get_interactions_resource_path,
    get_test_element_uid,
    is_interaction,
)
from ..testbench_api.model import (
    InteractionCallType,
    InteractionDetails,
    ParameterEvaluationType,
)
from ..testbench_api.testbench_get import get_interaction, get_test_element, get_test_elements
from ..testbench_api.testbench_resource_connection import TestBenchResourceConnection
from .resource_utils import html_2_robot
from .testbench_resource_model import TestBenchResourceModel


def create_resource_from_subdivision(
    uid: str,
):
    resource = None
    tb_connection = TestBenchResourceConnection.singleton()
    test_elements = get_test_elements(tb_connection)
    for test_element in test_elements:
        if not is_interaction(test_element):
            continue
        parent_uid = get_test_element_uid(
            test_elements, get_interaction_parent_key(test_elements, test_element)
        )
        if uid != parent_uid:
            continue
        resource_path = get_interactions_resource_path(test_elements, test_element)
        if not resource:
            resource = TestBenchResourceModel(resource_path)
            resource.add_comment(f"tb:uid:{uid}")
        interaction_key = get_interaction_key(test_element)
        interaction_details = get_interaction(
            tb_connection, tb_connection.project_key, interaction_key
        )
        keyword_arguments = [
            f"{_get_argument_type(param.name)}{{{param.name.strip('*').strip()}}}{'=' * bool(param.defaultValue)}{param.defaultValue.name if bool(param.defaultValue) else ''}"
            for param in interaction_details.parameters
            if param.evaluationType == ParameterEvaluationType.CallByValue
        ]
        keyword_tags = [f"tb:uid:{interaction_details.uniqueID}"]
        if interaction_details.defaultCallType == InteractionCallType.Check:
            keyword_tags.append("tb:check")
        resource.add_keyword(
            interaction_details.name,
            keyword_arguments,
            keyword_tags,
            html_2_robot(interaction_details.description),
        )
    return resource


def get_interaction_details(
    interaction_uid: str,
) -> InteractionDetails:
    tb_connection = TestBenchResourceConnection.singleton()
    test_element = get_test_element(tb_connection, interaction_uid)
    if isinstance(test_element, dict):
        raise TestBenchKeywordNotFound(interaction_uid)
    interaction_key = get_interaction_key(test_element)
    if interaction_key:
        return get_interaction(tb_connection, tb_connection.project_key, interaction_key)
    return InteractionDetails


def create_keyword_from_interaction(
    interaction_uid: str,
) -> Keyword:
    interaction_details = get_interaction_details(interaction_uid)
    keyword_name = interaction_details.name
    keyword_arguments = [
        f"{_get_argument_type(param.name)}{{{param.name.strip('*').strip()}}}{'=' * bool(param.defaultValue)}{param.defaultValue.name if bool(param.defaultValue) else ''}"
        for param in interaction_details.parameters
        if param.evaluationType == ParameterEvaluationType.CallByValue
    ]
    keyword_documentation = html_2_robot(interaction_details.description)
    keyword_tags = [f"tb:uid:{interaction_details.uniqueID}"]
    if interaction_details.defaultCallType == InteractionCallType.Check:
        keyword_tags.append("tb:check")
    kw = Keyword(
        header=KeywordName.from_params(keyword_name),
        body=[
            Comment.from_params("# Not Implemented"),
            # KeywordCall.from_params("Fail", args=("Not Implemented",)),
        ],
    )
    if keyword_arguments:
        kw_arguments = Arguments.from_params(
            [
                f"${{{arg.strip('*').strip()}}}"
                if not arg.startswith("$") and not arg.startswith("@") and not arg.startswith("&")
                else arg
                for arg in keyword_arguments
            ]
        )
        kw.body.insert(0, kw_arguments)
    if keyword_tags:
        kw_tags = Tags.from_params(keyword_tags)
        kw.body.insert(0, kw_tags)
    if keyword_documentation:
        doc = Documentation.from_params(keyword_documentation, settings_section=False)
        kw.body.insert(0, doc)
    return kw


def _get_argument_type(argument: str) -> str:
    if argument.startswith("**"):
        return "&"
    if argument.startswith("*"):
        return "@"
    return "$"
