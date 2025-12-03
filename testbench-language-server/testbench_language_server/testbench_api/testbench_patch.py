from typing import Any

from ..ls_exceptions import TestBenchKeywordNotFound, TestBenchSubdivisionNotFound
from .legacy_model import get_tb_keyword_key, get_subdivision_key
from .testbench_get import get_test_element
from .testbench_resource_connection import TestBenchResourceConnection


def patch_tb_keyword_details(
    tb_connection: TestBenchResourceConnection,
    keyword_uid: str,
    new_name: str,
    new_html_description: str,
    new_call_type: str,
) -> dict:
    tb_connection = TestBenchResourceConnection.singleton()
    test_element = get_test_element(tb_connection, keyword_uid)
    if isinstance(test_element, dict):
        raise TestBenchKeywordNotFound(keyword_uid)
    keyword_key = get_tb_keyword_key(test_element)
    if keyword_key:
        patch_keyword(
            tb_connection,
            tb_connection.project_key,
            keyword_key,
            new_name,
            new_html_description,
            new_call_type,
        )


def post_tb_keyword_details(
    tb_connection: TestBenchResourceConnection,
    name: str,
    html_description: str,
    call_type: str,
    subdivision_uid: str,
    parameters: list[dict[str, Any]] | None = None,
) -> dict:
    tb_connection = TestBenchResourceConnection.singleton()
    test_element = get_test_element(tb_connection, subdivision_uid)
    if isinstance(test_element, dict):
        raise TestBenchSubdivisionNotFound(subdivision_uid)
    subdivision_key = get_subdivision_key(test_element)
    if subdivision_key:
        return post_tb_keyword(
            tb_connection,
            tb_connection.project_key,
            tb_connection.tov_key,
            subdivision_key,
            name,
            html_description,
            call_type,
            parameters,
        )


def _patch_tb_keyword(
    tb_connection: TestBenchResourceConnection, project_key: str, keyword_key: str, data: dict
) -> dict[Any]:
    tb_connection = TestBenchResourceConnection.singleton().connection
    return dict(
        tb_connection.session.patch(
            f"{tb_connection.server_url}2/projects/{project_key}/keywords/{keyword_key}",
            json=data,
        ).json()
    )


def _post_tb_keyword(
    tb_connection: TestBenchResourceConnection, project_key: str, tov_key: str, data: dict
) -> dict[Any]:
    tb_connection = TestBenchResourceConnection.singleton().connection
    return dict(
        tb_connection.session.post(
            f"{tb_connection.server_url}2/projects/{project_key}/tovs/{tov_key}/keywords",
            json=data,
        ).json()
    )


def patch_keyword(
    tb_connection: TestBenchResourceConnection,
    project_key: str,
    keyword_key: str,
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
    return _patch_tb_keyword(tb_connection, project_key, keyword_key, data)


def post_tb_keyword(
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
    return _post_tb_keyword(tb_connection, project_key, tov_key, data)
