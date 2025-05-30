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
        cycle_name: str | None,
    ) -> tuple[str, str, str | None]:
        project_key = self.connection.get_project_key_new_play(project_name)
        tov_key = self.connection.get_tov_key_new_play(project_key, tov_name)
        if not cycle_name:
            return (project_key, tov_key, None)
        cycle_key = self.connection.get_cycle_key_new_play(project_key, tov_key, cycle_name)
        return (project_key, tov_key, cycle_key)
