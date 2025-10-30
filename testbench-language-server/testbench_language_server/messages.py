"""Message constants for the TestBench language server."""

# Error messages
ERROR_CONTEXT_NOT_SET = "Missing TestBench context: Specify the context in the comment section of your resource file in the format 'tb:context:<project>/<tov>'."
ERROR_CONTEXT_MISMATCH = "TestBench context mismatch: Use the project view to select the tov that corresponds to your resource file."
ERROR_PUSH_KEYWORD = "Failed to push keyword."
ERROR_CREATE_KEYWORD = "Failed to create keyword."
ERROR_KEYWORD_IS_LOCKED = "Element is locked in TestBench."
ERROR_SUBDIVISON_MAPPING_FORMAT = (
    "The subdivision and library mapping must be specified in the format 'name:value'."
)
ERROR_EMPTY_OUTPUT_DIRECTORY = "Output Directory of TestBench2RobotFramework cannot be empty."
ERROR_DUPLICATE_KEYWORD_UID = (
    "Multiple keywords with uid '{uid}' found. Please resolve the conflict manually."
)
ERROR_DUPLICATE_KEYWORD_UID_IN_FILE = "Multiple keywords with uid '{uid}' found in file '{uri}'. Please resolve the conflict manually."
ERROR_DUPLICATE_KEYWORD_NAME = (
    "Multiple keywords with name '{name}' found. Please resolve the conflict manually."
)
ERROR_DUPLICATE_KEYWORD_NAME_IN_FILE = "Multiple keywords with name '{name}' found in file '{uri}'. Please resolve the conflict manually."
ERROR_FINDING_TESTBENCH_KEYWORD = (
    "TestBench keyword with uid '{uid}' or name '{name}' does not exist."
)
ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID = "TestBench keyword with uid '{uid}' does not exist."
ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID_IN_EXISTING_RESOURCE = "TestBench keyword with uid '{uid}' does not exist in the cached resource. Please save the resource and try again."
ERROR_FINDING_TESTBENCH_SUBDIVISION_WITH_UID = (
    "TestBench subdivision with uid '{uid}' does not exist."
)

# Info messages
INFO_ALREADY_UP_TO_DATE = "Already up to date."
INFO_CHANGES_PUSHED = "Keyword changes pushed to TestBench."
INFO_CREATED_KEYWORD = "Keyword created in TestBench (UID: '{uid}')."
INFO_TESTBENCH_KEYWORD_DOES_NOT_EXIST = (
    "TestBench keyword with name '{name}' does not exist in the selected resource file."
)
INFO_TESTBENCH_KEYWORD_DOES_NOT_EXIST_IN_FILE = "TestBench keyword with name '{name}' and uid '{uid}' does not exist in the selected resource file '{uri}'."

# Warning messages
WARNING_CONTEXT_MISMATCH = "TestBench context mismatch: Selected context '{selected_context}' does not match the resource context '{resource_context}'. "
WARNING_MISSING_CONTEXT = "Missing TestBench context."


# DEBUG MESSAGES
DEBUG_CHECK_CONTEXT = "Checking testbench context. Selected context: {selected_context} - Resource context: {resource_context} "


# COMMANDS
COMMAND_GENERATE_TEST_SUITES = "testbench_ls.generateTestSuites"
COMMAND_FETCH_RESULTS = "testbench_ls.fetchResults"
COMMAND_FIND_INTERACTION_POSITION = "testbench_ls.getInteractionPosition"
COMMAND_UPDATE_SERVER_NAME = "testbench_ls.updateServerName"
COMMAND_UPDATE_SERVER_PORT = "testbench_ls.updateServerPort"
COMMAND_UPDATE_LOGIN_NAME = "testbench_ls.updateLoginName"
COMMAND_UPDATE_SESSION_TOKEN = "testbench_ls.updateSessionToken"
COMMAND_UPDATE_PROJECT = "testbench_ls.updateProject"
COMMAND_UPDATE_TOV = "testbench_ls.updateTov"
COMMAND_PULL_SUBDIVISION = "testbench_ls.pullSubdivision"
COMMAND_PUSH_SUBDIVISION = "testbench_ls.pushSubdivision"
COMMAND_PULL_KEYWORD = "testbench_ls.pullKeyword"
COMMAND_PUSH_KEYWORD = "testbench_ls.pushKeyword"
COMMAND_CREATE_KEYWORD = "testbench_ls.createKeyword"
COMMAND_SHOW_TESTBENCH_SUBDIVISON_DIFF = "testbench_ls.showTestbenchSubdivisionDiff"
COMMAND_SHOW_TESTBENCH_KEYWORD_DIFF = "testbench_ls.showTestbenchKeywordDiff"
COMMAND_ATTEMPT_PUSH_SUBDIVISION = "testbench_ls.attemptPushSubdivision"
COMMAND_ATTEMPT_PUSH_KEYWORD = "testbench_ls.attemptPushKeyword"
COMMAND_ATTEMPT_CREATE_KEYWORD = "testbench_ls.attemptCreateKeyword"

# constants
TESTBENCH_LS_CLASS_NAME = "testbench-language-server"
PULL_SUBDIVISON_TITLE = "Pull changes from TestBench"
PUSH_SUBDIVISON_TITLE = "Push changes to TestBench"
PULL_KEYWORD_TITLE = "Pull keyword from TestBench"
CREATE_KEYWORD_TITLE = "Create keyword in TestBench"
PUSH_KEYWORD_TITLE = "Push keyword to TestBench"
KEYWORD_INTERFACE_CHANGE_LABEL = "Keyword interface changes"
WORKSPACE_APPLY_EDIT_LABEL = "Refactoring Preview"
CONTEXT_CHANGE_LABEL = "TestBench Context Change"

# Variables
CONTEXT_STRING = "tb:context:{project}/{tov}"
IGNORE_TAGS = ["robot:private", "tb:ignore"]
