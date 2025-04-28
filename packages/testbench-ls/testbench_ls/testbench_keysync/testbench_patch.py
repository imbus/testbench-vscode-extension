from .testbench_api import TestBenchApi


def patch_interaction_details(
    server_name: str,
    server_port: str,
    login_name: str,
    password: str,
    project_name: str,
    tov_name: str,
    interaction_uid: str,
    new_name: str,
    new_html_description: str,
) -> dict:
    testbench_api = TestBenchApi(
        server_name, server_port, login_name, password, project_name, tov_name
    )
    test_element = testbench_api.get_test_element(interaction_uid)
    interaction_key = testbench_api.get_interaction_key(test_element)
    if interaction_key:
        testbench_api.patch_interaction(
            testbench_api.project_key, interaction_key, new_name, new_html_description
        )
