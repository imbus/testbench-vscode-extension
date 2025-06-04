"""Message constants for the TestBench language server."""

# Error messages
ERROR_CONTEXT_NOT_SET = "TestBench context not set: Specify the context in the comment section of your resource file in the format 'tb:context:<project>/<tov>'."
ERROR_CONTEXT_MISMATCH = "TestBench context mismatch: Use the project view to select the tov that corresponds to your resource file."
ERROR_PUSH_KEYWORD = "Failed to push keyword"
ERROR_KEYWORD_IS_LOCKED = "Element is locked in TestBench"
ERROR_SUBDIVISON_MAPPING_FORMAT = "The subdivision and library mapping must be specified in the format 'name:value'."
ERROR_EMPTY_OUTPUT_DIRECTORY = "Output Directory of TestBench2RobotFramework cannot be empty."

# COMMANDS
COMMAND_GENERATE_TEST_SUITES = "testbench_ls.generateTestSuites"

# constants
TESTBENCH_LS_CLASS_NAME = "testbench-language-server"