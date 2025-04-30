from robot.api.parsing import (
    Arguments,
    Comment,
    Documentation,
    Keyword,
    KeywordName,
    Tags,
)

from .resource_file import RobotResourceFile
from .testbench_api import TestBenchApi
from .utils import html_2_robot


def create_resources_from_test_elements(
    server_name: str,
    server_port: str,
    login_name: str,
    session_token: str,
    project_name: str,
    tov_name: str,
) -> dict:
    resources: dict[str, RobotResourceFile] = {}
    testbench_api = TestBenchApi(
        server_name, server_port, login_name, session_token, project_name, tov_name
    )
    for test_element in testbench_api.test_elements:
        if not testbench_api.is_interaction(test_element):
            continue
        resource_path = testbench_api.get_interactions_resource_path(test_element)
        resource_uid = testbench_api.subdivisions.get(
            test_element.get("libraryKey").get("serial")
        ).get("uniqueID")
        if not resources.get(resource_uid):
            resource_file = RobotResourceFile(resource_path)
            resource_file.add_documentation(f"tb:uid:{resource_uid}")
            resources[resource_uid] = resource_file
        interaction_key = testbench_api.get_interaction_key(test_element)
        interaction_details = testbench_api.get_interaction(
            testbench_api.project_key, interaction_key
        )
        keyword_arguments = [
            f"${{{param.get('name')}}}"
            for param in interaction_details.get("parameters", [])
            if param.get("evaluationType") == "CallByValue"
        ]
        resources.get(resource_uid).add_keyword(
            interaction_details.get("name"),
            keyword_arguments,
            [f"tb:uid:{interaction_details.get('uniqueID')}"],
            html_2_robot(interaction_details.get("description")),
        )
    return resources


def create_resource(
    server_name: str,
    server_port: str,
    login_name: str,
    session_token: str,
    project_name: str,
    tov_name: str,
    uid: str,
):
    testbench_api = TestBenchApi(
        server_name, server_port, login_name, session_token, project_name, tov_name
    )
    resource_path = None
    resource = None
    for test_element in testbench_api.test_elements:
        if not testbench_api.is_interaction(test_element):
            continue
        parent_uid = testbench_api.get_test_element_uid(
            testbench_api.get_interaction_parent_key(test_element)
        )
        if uid != parent_uid:
            continue
        if not resource_path:
            resource_path = testbench_api.get_interactions_resource_path(test_element)
        if not resource:
            resource = RobotResourceFile(resource_path)
            resource.add_documentation(f"tb:uid:{uid}")
        interaction_key = testbench_api.get_interaction_key(test_element)
        interaction_details = testbench_api.get_interaction(
            testbench_api.project_key, interaction_key
        )
        keyword_arguments = [
            f"{get_argument_type(param.get('name'))}{{{param.get('name').strip('*').strip()}}}{'=' * bool(param.get('defaultValue'))}{param.get('defaultValue', {}).get('name', '') if bool(param.get('defaultValue')) else ''}"
            for param in interaction_details.get("parameters", [])
            if param.get("evaluationType") == "CallByValue"
        ]
        resource.add_keyword(
            interaction_details.get("name"),
            keyword_arguments,
            [f"tb:uid:{interaction_details.get('uniqueID')}"],
            html_2_robot(interaction_details.get("description")),
        )
    return resource


def get_interaction_details(
    server_name: str,
    server_port: str,
    login_name: str,
    session_token: str,
    project_name: str,
    tov_name: str,
    interaction_uid: str,
) -> dict:
    testbench_api = TestBenchApi(
        server_name, server_port, login_name, session_token, project_name, tov_name
    )
    test_element = testbench_api.get_test_element(interaction_uid)
    interaction_key = testbench_api.get_interaction_key(test_element)
    if interaction_key:
        return testbench_api.get_interaction(testbench_api.project_key, interaction_key)
    return {}


def create_keyword(
    server_name: str,
    server_port: str,
    login_name: str,
    session_token: str,
    project,
    tov,
    interaction_uid: str,
) -> Keyword:
    interaction_details = get_interaction_details(
        server_name, server_port, login_name, session_token, project, tov, interaction_uid
    )
    keyword_name = interaction_details.get("name")
    keyword_arguments = [
        f"{get_argument_type(param.get('name'))}{{{param.get('name').strip('*').strip()}}}{'=' * bool(param.get('defaultValue'))}{param.get('defaultValue', {}).get('name', '') if bool(param.get('defaultValue')) else ''}"
        for param in interaction_details.get("parameters", [])
        if param.get("evaluationType") == "CallByValue"
    ]
    keyword_documentation = html_2_robot(interaction_details.get("description"))
    keyword_tags = [f"tb:uid:{interaction_details.get('uniqueID')}"]
    kw = Keyword(
        header=KeywordName.from_params(keyword_name),
        body=[
            Comment.from_params("# Not Implemented"),
            # KeywordCall.from_params("Fail", args=("Not Implemented",)),
        ],
    )
    if keyword_tags:
        kw_tags = Tags.from_params(keyword_tags)
        kw.body.insert(0, kw_tags)
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
    if keyword_documentation:
        doc = Documentation.from_params(keyword_documentation, settings_section=False)
        kw.body.insert(0, doc)
    return kw


def get_argument_type(argument: str) -> str:
    if argument.startswith("**"):
        return "&"
    if argument.startswith("*"):
        return "@"
    return "$"
