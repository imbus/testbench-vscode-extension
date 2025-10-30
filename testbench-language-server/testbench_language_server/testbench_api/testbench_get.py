from .legacy_model import TestElement
from .model import InteractionDetails
from .model_utils import from_dict
from .testbench_resource_connection import TestBenchResourceConnection


def get_test_elements(tb_connection: TestBenchResourceConnection) -> list[TestElement]:
    response = list(
        tb_connection.connection.legacy_session.get(
            f"{tb_connection.connection.server_legacy_url}tovs/{tb_connection.tov_key}/testElements",
            params={"tovKey": tb_connection.tov_key},
        ).json()
    )
    return [from_dict(TestElement, item) for item in response]


def get_test_element(tb_connection: TestBenchResourceConnection, uid: str) -> dict:
    return next(
        filter(
            lambda test_element: test_element.uniqueID == uid
            or (test_element.uniqueID and uid and test_element.uniqueID.lower() == uid.lower()),
            get_test_elements(tb_connection),
        ),
        {},
    )


def get_interaction(
    tb_connection: TestBenchResourceConnection, project_key: str, interaction_key: str
) -> InteractionDetails:
    return from_dict(
        InteractionDetails,
        tb_connection.connection.session.get(
            f"{tb_connection.connection.server_url}projects/{project_key}/interactions/{interaction_key}/v1",
            params={"projectKey": project_key, "interactionKey": interaction_key},
        ).json(),
    )
