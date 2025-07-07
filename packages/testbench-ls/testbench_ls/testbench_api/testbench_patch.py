from typing import Any

from .legacy_model import get_interaction_key
from .testbench_get import get_test_element
from .testbench_resource_connection import TestBenchResourceConnection
from ..ls_exceptions import TestBenchKeywordNotFound

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
