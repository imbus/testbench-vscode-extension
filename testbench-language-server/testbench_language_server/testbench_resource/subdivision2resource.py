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
    get_tb_keyword_key,
    get_tb_keyword_parent_key,
    get_keywords_resource_path,
    get_test_element_uid,
    is_tb_keyword,
)
from ..testbench_api.model import (
    KeywordCallType,
    KeywordDetails,
    ParameterEvaluationType,
)
from ..testbench_api.testbench_get import get_tb_keyword, get_test_element, get_test_elements
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
        if not is_tb_keyword(test_element):
            continue
        parent_uid = get_test_element_uid(
            test_elements, get_tb_keyword_parent_key(test_elements, test_element)
        )
        if uid != parent_uid:
            continue
        resource_path = get_keywords_resource_path(test_elements, test_element)
        if not resource:
            resource = TestBenchResourceModel(resource_path)
            resource.add_comment(f"tb:uid:{uid}")
        keyword_key = get_tb_keyword_key(test_element)
        keyword_details = get_tb_keyword(tb_connection, tb_connection.project_key, keyword_key)
        keyword_arguments = [
            f"{_get_argument_type(param.name)}{{{param.name.strip('*').strip()}}}{'=' * bool(param.defaultValue)}{param.defaultValue.name if bool(param.defaultValue) else ''}"
            for param in keyword_details.parameters
            if param.evaluationType == ParameterEvaluationType.CallByValue
        ]
        keyword_tags = [f"tb:uid:{keyword_details.uniqueID}"]
        if keyword_details.defaultCallType == KeywordCallType.Check:
            keyword_tags.append("tb:check")
        resource.add_keyword(
            keyword_details.name,
            keyword_arguments,
            keyword_tags,
            html_2_robot(keyword_details.description),
        )
    return resource


def get_tb_keyword_details(
    keyword_uid: str,
) -> KeywordDetails:
    tb_connection = TestBenchResourceConnection.singleton()
    test_element = get_test_element(tb_connection, keyword_uid)
    if isinstance(test_element, dict):
        raise TestBenchKeywordNotFound(keyword_uid)
    keyword_key = get_tb_keyword_key(test_element)
    if keyword_key:
        return get_tb_keyword(tb_connection, tb_connection.project_key, keyword_key)
    return KeywordDetails


def create_rf_keyword_from_tb_keyword(
    keyword_uid: str,
) -> Keyword:
    tb_keyword_details = get_tb_keyword_details(keyword_uid)
    keyword_name = tb_keyword_details.name
    keyword_arguments = [
        f"{_get_argument_type(param.name)}{{{param.name.strip('*').strip()}}}{'=' * bool(param.defaultValue)}{param.defaultValue.name if bool(param.defaultValue) else ''}"
        for param in tb_keyword_details.parameters
        if param.evaluationType == ParameterEvaluationType.CallByValue
    ]
    keyword_documentation = html_2_robot(tb_keyword_details.description)
    keyword_tags = [f"tb:uid:{tb_keyword_details.uniqueID}"]
    if tb_keyword_details.defaultCallType == KeywordCallType.Check:
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
