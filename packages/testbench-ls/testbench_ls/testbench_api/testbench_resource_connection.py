from typing import Optional

from TestBenchCliReporter.testbench import Connection


class TestBenchResourceConnection:
    _instance = None
    _initialized = False

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(
        self,
        server_name: str,
        server_port: str,
        login_name: str,
        session_token: str,
        project_name: str,
        tov_name: str,
    ):
        if not self._initialized:
            self._test_elements = None
            self._subdivisions = None
            self.connection = Connection(
                f"https://{server_name}:{server_port}/api/",
                loginname=login_name,
                sessionToken=session_token,
                verify=False,
            )
            self.project_key, self.tov_key, _ = self.get_project_path_keys(
                project_name, tov_name, None
            )
            TestBenchResourceConnection._initialized = True

    @classmethod
    def singleton(cls):
        if cls._instance is None:
            raise Exception(
                "TestBenchResourceConnection not initialized. Must call constructor with required parameters first."
            )
        if not cls._initialized:
            raise Exception("TestBenchResourceConnection not properly initialized.")
        return cls._instance

    def get_project_path_keys(
        self,
        project_name: str,
        tov_name: str,
        cycle_name: Optional[str],
    ) -> tuple[str, str, Optional[str]]:
        project_key = self.connection.get_project_key_new_play(project_name)
        tov_key = self.connection.get_tov_key_new_play(project_key, tov_name)
        if not cycle_name:
            return (project_key, tov_key, None)
        cycle_key = self.connection.get_cycle_key_new_play(project_key, tov_key, cycle_name)
        return (project_key, tov_key, cycle_key)

    # @property
    # def subdivisions(self) -> dict[str, Any]:
    #     if not self._subdivisions:
    #         self._subdivisions = {
    #             test_element.get("Subdivision_key").get("serial"): test_element
    #             for test_element in self.get_test_elements(self.tov_key)
    #             if test_element.get("Subdivision_key")
    #         }
    #     return self._subdivisions

    # def is_interaction(self, test_element: dict) -> bool:
    #     return bool(test_element.get("Interaction_key"))

    # def get_interaction_parent_key(self, test_element: dict) -> str:
    #     parent = test_element.get("parent") or test_element.get("libraryKey", {})
    #     return parent.get("serial")

    # def get_interaction_key(self, test_element: dict) -> str:
    #     return test_element.get("Interaction_key", {}).get("serial", "")

    # def get_test_element(self, uid: str) -> dict:
    #     return next(
    #         filter(
    #             lambda test_element: test_element.get(
    #                 "uniqueID",
    #             )
    #             == uid,
    #             self.get_test_elements(self.tov_key),
    #         ),
    #         {},
    #     )

    # def get_test_element_description(self, test_element_key: str):
    #     element = next(
    #         filter(
    #             lambda test_element: test_element.get("Subdivision_key", {}).get("serial")
    #             == test_element_key
    #             or test_element.get("Interaction_key", {}).get("serial") == test_element_key,
    #             self.get_test_elements(self.tov_key),
    #         ),
    #         {},
    #     )
    #     return element.get("uniqueID", "")

    # def get_test_element_uid(self, test_element_key: str):
    #     element = next(
    #         filter(
    #             lambda test_element: test_element.get("Subdivision_key", {}).get("serial")
    #             == test_element_key
    #             or test_element.get("Interaction_key", {}).get("serial") == test_element_key,
    #             self.test_elements,
    #         ),
    #         {},
    #     )
    #     return element.get("uniqueID", "")

    # def get_interactions_resource_path(self, interaction: dict) -> Path:
    #     parent_key = self.get_interaction_parent_key(interaction)
    #     path_parts = []
    #     while parent_key != "0":
    #         path_parts.insert(0, self.subdivisions.get(parent_key).get("name"))
    #         parent_key = self.subdivisions.get(parent_key).get("parent").get("serial")
    #     path_parts[-1] = f"{path_parts[-1]}.resource"
    #     return Path.cwd() / Path(*path_parts)
