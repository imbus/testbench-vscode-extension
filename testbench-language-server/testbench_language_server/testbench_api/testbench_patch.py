from typing import Any

from ..ls_exceptions import TestBenchKeywordNotFound
from .legacy_model import get_interaction_key, get_subdivision_key
from .testbench_get import get_test_element
from .testbench_resource_connection import TestBenchResourceConnection


def patch_interaction_details(
    tb_connection: TestBenchResourceConnection,
    interaction_uid: str,
    new_name: str,
    new_html_description: str,
    new_call_type: str,
) -> dict:
    tb_connection = TestBenchResourceConnection.singleton()
    test_element = get_test_element(tb_connection, interaction_uid)
    if isinstance(test_element, dict):
        raise TestBenchKeywordNotFound(interaction_uid)
    interaction_key = get_interaction_key(test_element)
    if interaction_key:
        patch_interaction(
            tb_connection,
            tb_connection.project_key,
            interaction_key,
            new_name,
            new_html_description,
            new_call_type,
        )


def post_interaction_details(
    tb_connection: TestBenchResourceConnection,
    name: str,
    html_description: str,
    call_type: str,
    subdivision_uid: str,
    parameters: list[dict[str, Any]] | None = None,
) -> dict:
    tb_connection = TestBenchResourceConnection.singleton()
    test_element = get_test_element(tb_connection, subdivision_uid)
    subdivision_key = get_subdivision_key(test_element)
    if subdivision_key:
        return post_interaction(
            tb_connection,
            tb_connection.project_key,
            tb_connection.tov_key,
            subdivision_key,
            name,
            html_description,
            call_type,
            parameters,
        )


def _patch_interaction(
    tb_connection: TestBenchResourceConnection, project_key: str, interaction_key: str, data: dict
) -> dict[Any]:
    tb_connection = TestBenchResourceConnection.singleton().connection
    return dict(
        tb_connection.session.patch(
            f"{tb_connection.server_url}projects/{project_key}/interactions/{interaction_key}/v1",
            json=data,
        ).json()
    )


def _post_interaction(
    tb_connection: TestBenchResourceConnection, project_key: str, tov_key: str, data: dict
) -> dict[Any]:
    tb_connection = TestBenchResourceConnection.singleton().connection
    return dict(
        tb_connection.session.post(
            f"{tb_connection.server_url}projects/{project_key}/tovs/{tov_key}/interactions/v1",
            json=data,
        ).json()
    )


def patch_interaction(
    tb_connection: TestBenchResourceConnection,
    project_key: str,
    interaction_key: str,
    name: str,
    html_description: str,
    call_type: str,
) -> dict[Any]:
    data = {
        "name": name,
        "description": {
            "html": html_description,
            "images": [],
        },
        "callType": call_type,
    }
    return _patch_interaction(tb_connection, project_key, interaction_key, data)


def post_interaction(
    tb_connection: TestBenchResourceConnection,
    project_key: str,
    tov_key: str,
    parent_key: str,
    name: str,
    html_description: str,
    call_type: str,
    parameters: list[dict[str, Any]] | None = None,
) -> dict[Any]:
    data = {
        "parentKey": str(parent_key),
        "name": name,
        "description": {
            "html": html_description,
            "images": [],
        },
        "callType": call_type,
        "parameters": parameters if parameters else [],
    }
    return _post_interaction(tb_connection, project_key, tov_key, data)
