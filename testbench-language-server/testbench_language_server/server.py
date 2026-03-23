import pathlib
import re

import requests  # type: ignore
from lsprotocol.types import (
    INITIALIZE,
    TEXT_DOCUMENT_CODE_ACTION,
    TEXT_DOCUMENT_CODE_LENS,
    TEXT_DOCUMENT_DID_CHANGE,
    TEXT_DOCUMENT_DID_OPEN,
    WORKSPACE_APPLY_EDIT,
    AnnotatedTextEdit,
    ApplyWorkspaceEditParams,
    ChangeAnnotation,
    ChangeAnnotationIdentifier,
    CodeAction,
    CodeActionKind,
    CodeActionParams,
    CodeLens,
    CodeLensParams,
    Command,
    Diagnostic,
    DiagnosticSeverity,
    DidOpenTextDocumentParams,
    InitializeParams,
    InitializeResult,
    OptionalVersionedTextDocumentIdentifier,
    Position,
    PublishDiagnosticsParams,
    Range,
    ServerCapabilities,
    TextDocumentEdit,
    TextDocumentSyncKind,
    WorkspaceEdit,
)
from pygls.lsp.server import LanguageServer
from pygls.workspace.text_document import TextDocument
from robot.api.parsing import Keyword, KeywordName, KeywordSection, SectionHeader, Token
from testbench2robotframework.cli import get_tb2robot_file_configuration
from testbench2robotframework.robotframework2testbench import robot2testbench
from testbench2robotframework.testbench2robotframework import testbench2robotframework

from testbench_language_server import __version__
from testbench_language_server.testbench_api.testbench_resource_connection import (
    TestBenchResourceConnection,
)

from .constants import CONTEXT_MISMATCH_CODE, MISSING_CONTEXT_CODE
from .file_edits import (
    get_deleted_testbench_kw_tags_edit,
    get_kw_arguments_edit,
    get_kw_documentation_edit,
    get_kw_tags_edit,
    get_tags_values,
)
from .ls_exceptions import (
    MultipleKeywordsWithName,
    MultipleKeywordsWithUid,
    TestBenchKeywordNotFound,
    TestBenchSubdivisionNotFound,
)
from .ls_logging import LogLevel, log, show_error, show_info, show_warning
from .messages import (
    COMMAND_ATTEMPT_CREATE_KEYWORD,
    COMMAND_ATTEMPT_PUSH_KEYWORD,
    COMMAND_ATTEMPT_PUSH_SUBDIVISION,
    COMMAND_CREATE_KEYWORD,
    COMMAND_FETCH_RESULTS,
    COMMAND_FIND_KEYWORD_POSITION,
    COMMAND_GENERATE_TEST_SUITES,
    COMMAND_PULL_KEYWORD,
    COMMAND_PULL_SUBDIVISION,
    COMMAND_PUSH_KEYWORD,
    COMMAND_PUSH_SUBDIVISION,
    COMMAND_SHOW_TESTBENCH_KEYWORD_DIFF,
    COMMAND_SHOW_TESTBENCH_SUBDIVISON_DIFF,
    COMMAND_UPDATE_LOGIN_NAME,
    COMMAND_UPDATE_PROJECT,
    COMMAND_UPDATE_SERVER_NAME,
    COMMAND_UPDATE_SERVER_PORT,
    COMMAND_UPDATE_SESSION_TOKEN,
    COMMAND_UPDATE_TOV,
    CONTEXT_CHANGE_LABEL,
    CONTEXT_STRING,
    CREATE_KEYWORD_TITLE,
    DEBUG_CHECK_CONTEXT,
    ERROR_CONTEXT_MISMATCH,
    ERROR_CONTEXT_NOT_SET,
    ERROR_CREATE_KEYWORD,
    ERROR_DUPLICATE_KEYWORD_NAME,
    ERROR_DUPLICATE_KEYWORD_NAME_IN_FILE,
    ERROR_DUPLICATE_KEYWORD_UID,
    ERROR_DUPLICATE_KEYWORD_UID_IN_FILE,
    ERROR_EMPTY_OUTPUT_DIRECTORY,
    ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID,
    ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID_IN_EXISTING_RESOURCE,
    ERROR_FINDING_TESTBENCH_SUBDIVISION_WITH_UID,
    ERROR_KEYWORD_IS_LOCKED,
    ERROR_PUSH_KEYWORD,
    ERROR_SUBDIVISON_MAPPING_FORMAT,
    IGNORE_TAGS,
    INFO_ALREADY_UP_TO_DATE,
    INFO_CHANGES_PUSHED,
    INFO_CREATED_KEYWORD,
    INFO_TESTBENCH_KEYWORD_DOES_NOT_EXIST,
    INFO_TESTBENCH_KEYWORD_DOES_NOT_EXIST_IN_FILE,
    KEYWORD_INTERFACE_CHANGE_LABEL,
    PULL_KEYWORD_TITLE,
    PULL_SUBDIVISON_TITLE,
    PUSH_KEYWORD_TITLE,
    PUSH_SUBDIVISON_TITLE,
    TESTBENCH_LS_CLASS_NAME,
    WARNING_CONTEXT_MISMATCH,
    WARNING_MISSING_CONTEXT,
    WORKSPACE_APPLY_EDIT_LABEL,
)
from .testbench_api.testbench_patch import patch_tb_keyword_details, post_tb_keyword_details
from .testbench_resource.resource_documentation import ResourceDocumentation
from .testbench_resource.resource_utils import (
    get_comment_section_end_position,
    get_keyword_section,
    get_keyword_section_position,
    get_keyword_tags,
    get_setting_section,
    get_setting_section_position,
    get_testbench_context_position,
    get_variables_section,
    get_variables_section_position,
    robot_model_to_string,
)
from .testbench_resource.subdivision2resource import (
    create_resource_from_subdivision,
    create_rf_keyword_from_tb_keyword,
)
from .testbench_resource.testbench_resource_model import (
    TestBenchResourceModel,
    get_kw_name,
    get_kw_uid,
    get_tb_keyword_call_type,
)


class TestBenchLanguageServer(LanguageServer):
    def __init__(self):
        super().__init__(TESTBENCH_LS_CLASS_NAME, __version__)
        self.server_name = None
        self.server_port = None
        self.project = None
        self.login_name = None
        self.session_token = None
        self.tov = None

    def set_server_name(self, server_name: str):
        self.server_name = server_name

    def set_server_port(self, server_port: str):
        self.server_port = server_port

    def set_login_name(self, login_name: str):
        self.login_name = login_name

    def set_session_token(self, session_token: str):
        self.session_token = session_token

    def set_project(self, project: str):
        self.project = project

    def set_tov(self, tov: str):
        self.tov = tov

    # def generate_ai_documentation(self, keyword: Keyword):
    #     keyword_string = robot_model_to_string(keyword)
    #     data = {
    #         "keyword_code": keyword_string,
    #         "language": "ENG",
    #         "arguments_exist": True,
    #         "return_value_exists": False,
    #     }
    #     url = f"{self.ai_server_address}/generate-rf-keyword-description"
    #     response = requests.post(url, json=data)
    #     return response.json().get("description", "No documentation found")


testbench_ls = TestBenchLanguageServer()


def parse_subdivision_mapping(ls: LanguageServer, values: list[str]) -> dict[str, str]:
    subdivision_mapping = {}
    for value in values:
        try:
            subdivision, import_value = value.split(":", 1)
            subdivision_mapping[subdivision] = import_value
        except ValueError:
            show_error(ls, ERROR_SUBDIVISON_MAPPING_FORMAT)
    return subdivision_mapping


@testbench_ls.command(COMMAND_GENERATE_TEST_SUITES)
def generate_test_suites(ls: LanguageServer, kwargs):
    toml_settings = get_tb2robot_file_configuration(None)
    settings = {
        "clean": kwargs.get("clean"),
        "compound-keyword-logging": kwargs.get("compound_keyword_logging"),
        "config": None,
        "fully-qualified": kwargs.get("fully_qualified"),
        "library-regex": list(
            rf"(?:.*\.)?(?P<resourceName>[^.]+?)\s*{re.escape(marker)}.*"
            for marker in kwargs.get("library_marker", ())
        ),
        "library-root": kwargs.get("library_root", ()),
        "log-suite-numbering": kwargs.get("log_suite_numbering"),
        "output-directory": pathlib.Path(kwargs.get("output_directory")).as_posix(),
        "resource-directory": pathlib.Path(kwargs.get("resource_directory"), "").as_posix(),
        "resource-directory-regex": kwargs.get("resource_directory_regex", ""),
        "resource-regex": list(
            rf"(?:.*\.)?(?P<resourceName>[^.]+?)\s*{re.escape(marker)}.*"
            for marker in kwargs.get("resource_marker", ())
        ),
        "resource-root": kwargs.get("resource_root", ()),
        "library-mapping": parse_subdivision_mapping(ls, kwargs.get("library_mapping", [])),
        "resource-mapping": parse_subdivision_mapping(ls, kwargs.get("resource_mapping", [])),
    }
    report_path = pathlib.Path(kwargs.get("testbench_report"))
    if kwargs.get("use_config_file"):
        if not toml_settings.get("output-directory"):
            show_error(ls, ERROR_EMPTY_OUTPUT_DIRECTORY)
            return False
        testbench2robotframework(report_path, toml_settings)
    else:
        if not settings.get("output-directory"):
            show_error(ls, ERROR_EMPTY_OUTPUT_DIRECTORY)
            return False
        testbench2robotframework(report_path, settings)
    return True


@testbench_ls.command(COMMAND_FETCH_RESULTS)
def generate_test_suites(ls: LanguageServer, kwargs):
    robot2testbench(
        json_input_report=pathlib.Path(kwargs.get("testbench_report")),
        robot_result_xml=pathlib.Path(kwargs.get("robot_result")),
        json_output_result=pathlib.Path(kwargs.get("output_directory")),
        config={}
    )


@testbench_ls.feature(INITIALIZE)
def initialize(params: InitializeParams) -> InitializeResult:
    server_capabilities = ServerCapabilities(text_document_sync=TextDocumentSyncKind.Full)
    return InitializeResult(capabilities=server_capabilities)


@testbench_ls.command(COMMAND_UPDATE_SERVER_NAME)
def update_server_name(ls: LanguageServer, *args):
    new_name, *_ = args
    ls.set_server_name(new_name)


@testbench_ls.command(COMMAND_UPDATE_SERVER_PORT)
def update_server_port(ls: LanguageServer, *args):
    new_port, *_ = args
    ls.set_server_port(new_port)


@testbench_ls.command(COMMAND_UPDATE_LOGIN_NAME)
def update_login_name(ls: LanguageServer, *args):
    new_name, *_ = args
    ls.set_login_name(new_name)


@testbench_ls.command(COMMAND_UPDATE_SESSION_TOKEN)
def update_session_token(ls: LanguageServer, *args):
    new_session_token, *_ = args
    ls.set_session_token(new_session_token)


@testbench_ls.command(COMMAND_UPDATE_PROJECT)
def update_project(ls: LanguageServer, *args):
    new_project, *_ = args
    ls.set_project(new_project)
    tb_connection = TestBenchResourceConnection.singleton()
    tb_connection.update_project(new_project)
    for docum in testbench_ls.workspace.text_documents:
        document = testbench_ls.workspace.get_text_document(docum)
        diagnostics = get_context_diagnostics(testbench_ls, document)
        ls.text_document_publish_diagnostics(
            PublishDiagnosticsParams(document.uri, diagnostics=diagnostics, version=document.version)
        )


@testbench_ls.command(COMMAND_UPDATE_TOV)
def update_tov(ls: LanguageServer, *args):
    new_tov, *_ = args
    ls.set_tov(new_tov)
    tb_connection = TestBenchResourceConnection.singleton()
    tb_connection.update_tov(new_tov)
    for docum in testbench_ls.workspace.text_documents:
        document = testbench_ls.workspace.get_text_document(docum)
        diagnostics = get_context_diagnostics(testbench_ls, document)
        ls.text_document_publish_diagnostics(
            PublishDiagnosticsParams(document.uri, diagnostics=diagnostics, version=document.version)
        )


@testbench_ls.feature(TEXT_DOCUMENT_CODE_LENS)
def code_lens_provider(ls: LanguageServer, params: CodeLensParams):
    code_lenses = []
    document_uri = params.text_document.uri
    document = testbench_ls.workspace.get_text_document(document_uri)
    testbench_resource = TestBenchResourceModel.from_file(document.source)
    if not testbench_resource.tb_subdivision_uid:
        return code_lenses
    pull_resource_lens = CodeLens(
        range=Range(start=Position(line=0, character=0), end=Position(line=0, character=0)),
        command=Command(
            title=PULL_SUBDIVISON_TITLE,
            command=COMMAND_PULL_SUBDIVISION,
            arguments=[document_uri, testbench_resource.tb_subdivision_uid, True],
        ),
    )
    code_lenses.append(pull_resource_lens)
    push_resource_lens = CodeLens(
        range=Range(start=Position(line=0, character=0), end=Position(line=0, character=0)),
        command=Command(
            title=PUSH_SUBDIVISON_TITLE,
            command=COMMAND_ATTEMPT_PUSH_SUBDIVISION,
            arguments=[document_uri, testbench_resource.tb_subdivision_uid],
        ),
    )
    code_lenses.append(push_resource_lens)
    for keyword in testbench_resource.keywords:
        keyword_uid = get_kw_uid(keyword)
        if any(tag in IGNORE_TAGS for tag in get_tags_values(get_keyword_tags(keyword))):
            continue
        keyword_line = keyword.lineno - 1
        if not keyword_uid:
            keyword_name = get_kw_name(keyword)
            code_lenses.append(
                CodeLens(
                    range=Range(
                        start=Position(line=keyword_line, character=0),
                        end=Position(line=keyword_line, character=0),
                    ),
                    command=Command(
                        title=CREATE_KEYWORD_TITLE,
                        command=COMMAND_ATTEMPT_CREATE_KEYWORD,
                        arguments=[document_uri, keyword_name],
                    ),
                )
            )
        else:
            code_lenses.append(
                CodeLens(
                    range=Range(
                        start=Position(line=keyword_line, character=0),
                        end=Position(line=keyword_line, character=0),
                    ),
                    command=Command(
                        title=PULL_KEYWORD_TITLE,
                        command=COMMAND_PULL_KEYWORD,
                        arguments=[document_uri, keyword_uid],
                    ),
                )
            )
            code_lenses.append(
                CodeLens(
                    range=Range(
                        start=Position(line=keyword_line, character=0),
                        end=Position(line=keyword_line, character=0),
                    ),
                    command=Command(
                        title=PUSH_KEYWORD_TITLE,
                        command=COMMAND_ATTEMPT_PUSH_KEYWORD,
                        arguments=[document_uri, keyword_uid],
                    ),
                )
            )
    return code_lenses


def context_is_valid(
    ls: LanguageServer, existing_resource: TestBenchResourceModel, silent=False
) -> bool:
    try:
        project, tov = existing_resource.tb_tov_context
    except ValueError:
        return False
    log(
        ls,
        DEBUG_CHECK_CONTEXT.format(
            selected_context=f"{ls.project}/{ls.tov}",
            resource_context=f"{project}/{tov}",
        ),
        LogLevel.DEBUG,
    )
    if not project or not tov:
        if not silent:
            show_error(ls, ERROR_CONTEXT_NOT_SET)
        return False
    if project != ls.project or tov != ls.tov:
        if not silent:
            show_error(ls, ERROR_CONTEXT_MISMATCH)
        return False
    return True


@testbench_ls.command(COMMAND_SHOW_TESTBENCH_SUBDIVISON_DIFF)
def show_testbench_diff(ls: LanguageServer, kwargs):
    document_uri = kwargs.get("document_uri")
    subdivision_uid = kwargs.get("subdivision_uid")
    document = testbench_ls.workspace.get_text_document(document_uri)
    existing_resource = TestBenchResourceModel.from_file(document.source)
    if not existing_resource.tb_subdivision_uid or not context_is_valid(ls, existing_resource):
        return
    new_resource = create_resource_from_subdivision(
        uid=subdivision_uid,
    )
    change_identifier = ChangeAnnotationIdentifier()
    edits = []
    create_kw_section = not bool(get_keyword_section(existing_resource.file))
    if create_kw_section:
        minimum_empty_lines_before_section = 0
        if get_variables_section(existing_resource.file):
            _, _, kw_section_start, _ = get_variables_section_position(existing_resource.file)
        elif get_setting_section(existing_resource.file):
            _, _, kw_section_start, _ = get_setting_section_position(existing_resource.file)
        else:
            _, _, kw_section_start, _ = get_testbench_context_position(existing_resource.file)
            minimum_empty_lines_before_section = 1
        edits.extend(
            keyword_section_edit(
                kw_section_start,
                change_identifier,
                minimum_empty_lines_before_section=minimum_empty_lines_before_section,
                existing_trailing_newline_count=_count_trailing_newline_characters(document.source),
            )
        )
    else:
        _, _, kw_section_start, _ = get_keyword_section_position(existing_resource.file)
    for new_keyword in new_resource.keyword_section.body:
        try:
            keyword_match = get_matching_testbench_keyword(new_keyword, existing_resource)
        except MultipleKeywordsWithUid as e:
            show_error(
                ls,
                ERROR_DUPLICATE_KEYWORD_UID.format(uid=e.uid),
            )
            continue
        except MultipleKeywordsWithName as e:
            show_error(
                ls,
                ERROR_DUPLICATE_KEYWORD_NAME.format(uid=e.name),
            )
            continue
        if not keyword_match:
            edits.append(new_keyword_edit(new_keyword, kw_section_start + 1, change_identifier))
        else:
            if get_keyword_tags(keyword_match) and any(
                tag in IGNORE_TAGS for tag in get_tags_values(get_keyword_tags(keyword_match))
            ):
                continue
            edits.extend(create_keyword_edits(keyword_match, new_keyword, change_identifier))
    if not edits:
        show_info(ls, INFO_ALREADY_UP_TO_DATE)
        return
    testbench_content = apply_text_edits(robot_model_to_string(existing_resource.file), edits)
    ls.protocol.notify(
        "testbench-language-server/display-diff",
        {"path": document_uri, "virtualContent": testbench_content},
    )


def apply_text_edits(content: str, text_edits: list[AnnotatedTextEdit]) -> str:
    if not text_edits:
        return content
    lines = content.splitlines(keepends=True)

    def edit_position_offset(pos):
        return sum(len(l) for l in lines[: pos.line]) + pos.character

    for edit in sorted(
        text_edits,
        key=lambda e: (
            e.range.start.line,
            e.range.start.character,
            e.range.end.line,
            e.range.end.character,
        ),
        reverse=True,
    ):
        start = edit.range.start
        end = edit.range.end
        start_offset = edit_position_offset(start)
        end_offset = edit_position_offset(end)
        content = content[:start_offset] + edit.new_text + content[end_offset:]
        lines = content.splitlines(keepends=True)
    return content


@testbench_ls.command(COMMAND_ATTEMPT_PUSH_SUBDIVISION)
def attempt_push_subdivision(ls: LanguageServer, *args):
    document_uri, subdivision_uid, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    existing_resource = TestBenchResourceModel.from_file(document.source)
    if not existing_resource.tb_subdivision_uid or not context_is_valid(ls, existing_resource):
        return
    new_resource = create_resource_from_subdivision(
        uid=subdivision_uid,
    )
    change_identifier = ChangeAnnotationIdentifier()
    edits = []
    create_kw_section = not bool(get_keyword_section(existing_resource.file))
    if create_kw_section:
        minimum_empty_lines_before_section = 0
        if get_variables_section(existing_resource.file):
            _, _, kw_section_start, _ = get_variables_section_position(existing_resource.file)
        elif get_setting_section(existing_resource.file):
            _, _, kw_section_start, _ = get_setting_section_position(existing_resource.file)
        else:
            _, _, kw_section_start, _ = get_testbench_context_position(existing_resource.file)
            minimum_empty_lines_before_section = 1
        edits.extend(
            keyword_section_edit(
                kw_section_start,
                change_identifier,
                minimum_empty_lines_before_section=minimum_empty_lines_before_section,
                existing_trailing_newline_count=_count_trailing_newline_characters(document.source),
            )
        )
    else:
        _, _, kw_section_start, _ = get_keyword_section_position(existing_resource.file)
    if new_resource and new_resource.keyword_section:
        for new_keyword in new_resource.keyword_section.body:
            try:
                keyword_match = get_matching_testbench_keyword(new_keyword, existing_resource)
            except MultipleKeywordsWithUid as e:
                show_error(
                    ls,
                    ERROR_DUPLICATE_KEYWORD_UID.format(uid=e.uid),
                )
                continue
            except MultipleKeywordsWithName as e:
                show_error(
                    ls,
                    ERROR_DUPLICATE_KEYWORD_NAME.format(uid=e.name),
                )
                continue
            if not keyword_match:
                edits.append(new_keyword_edit(new_keyword, kw_section_start + 1, change_identifier))
            else:
                if get_keyword_tags(keyword_match) and any(
                    tag in IGNORE_TAGS for tag in get_tags_values(get_keyword_tags(keyword_match))
                ):
                    continue
                edits.extend(create_keyword_edits(keyword_match, new_keyword, change_identifier))
    if not edits:
        show_info(ls, INFO_ALREADY_UP_TO_DATE)
        return
    ls.protocol.notify(
        "testbench-language-server/attempt-push-subdivision",
        {"path": document_uri, "subdivisionUid": subdivision_uid},
    )


@testbench_ls.command(COMMAND_ATTEMPT_PUSH_KEYWORD)
def attempt_push_keyword(ls: LanguageServer, *args):
    document_uri, keyword_uid, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = TestBenchResourceModel.from_file(document.source)
    if not context_is_valid(ls, resource):
        return
    change_identifier = ChangeAnnotationIdentifier()
    existing_keywords = resource.get_keywords(keyword_uid)
    try:
        new_keyword = create_rf_keyword_from_tb_keyword(
            keyword_uid,
        )
    except TestBenchKeywordNotFound as e:
        show_error(ls, ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID.format(uid=e.uid))
        return
    if len(existing_keywords) > 1:
        show_error(
            ls,
            ERROR_DUPLICATE_KEYWORD_UID.format(uid=keyword_uid),
        )
        return
    edits = create_keyword_edits(existing_keywords[0], new_keyword, change_identifier)
    if not edits:
        show_info(ls, INFO_ALREADY_UP_TO_DATE)
        return
    ls.protocol.notify(
        "testbench-language-server/attempt-push-keyword",
        {"path": document_uri, "keyword_uid": keyword_uid},
    )


@testbench_ls.command(COMMAND_ATTEMPT_CREATE_KEYWORD)
def attempt_create_keyword(ls: LanguageServer, *args):
    document_uri, keyword_name, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = TestBenchResourceModel.from_file(document.source)
    if not context_is_valid(ls, resource):
        return
    change_identifier = ChangeAnnotationIdentifier()
    existing_keywords = resource.get_keywords_by_name(keyword_name)
    if len(existing_keywords) > 1:
        show_error(
            ls,
            ERROR_DUPLICATE_KEYWORD_NAME.format(name=keyword_name),
        )
        return
    if len(existing_keywords) == 1:
        ls.protocol.notify(
            "testbench-language-server/attempt-create-keyword",
            {"path": document_uri, "keyword_name": keyword_name},
        )
        return


@testbench_ls.command("testbench_ls.get_resource_directory_subdivision_index")
def get_resource_directory_subdivision_index(ls: LanguageServer, kwargs) -> int:
    # must be the same as in testbench2robotframework
    subdivision_parts = kwargs.get("subdivision_parts")
    resource_directory_regex = kwargs.get("resource_directory_regex")
    if not subdivision_parts:
        return -1
    if not resource_directory_regex:
        return -1
    for index, part in enumerate(subdivision_parts):
        resource_directory_match = re.match(resource_directory_regex, part, flags=re.IGNORECASE)
        if resource_directory_match:
            return index
    return -1


@testbench_ls.command(COMMAND_PUSH_SUBDIVISION)
def push_testbench_subdivision(ls: LanguageServer, kwargs):
    document_uri = kwargs.get("document_uri")
    document = testbench_ls.workspace.get_text_document(document_uri)
    existing_resource = TestBenchResourceModel.from_file(document.source)
    if not existing_resource.tb_subdivision_uid or not context_is_valid(ls, existing_resource):
        return
    rd = ResourceDocumentation(document.path)
    push_success = True
    for keyword in existing_resource.keyword_section.body:
        if get_keyword_tags(keyword) and any(
            tag in IGNORE_TAGS for tag in get_tags_values(get_keyword_tags(keyword))
        ):
            continue
        keyword_uid = get_kw_uid(keyword)
        existing_keywords = existing_resource.get_keywords(keyword_uid)
        if len(existing_keywords) > 1:
            show_error(
                ls,
                ERROR_DUPLICATE_KEYWORD_UID.format(uid=keyword_uid),
            )
            push_success = False
            continue
        new_docu = (
            rd.get_keyword_documentation(keyword_uid)
            .replace("<br>", "<br/>")
            .replace("<hr>", "<br/>")
        )
        html_description = f"<html><body>{new_docu}</body></html>"
        call_type = get_tb_keyword_call_type(keyword)
        try:
            tb_connection = TestBenchResourceConnection.singleton()
            response = patch_tb_keyword_details(
                tb_connection,
                keyword_uid,
                keyword.name,
                html_description,
                call_type.value,
            )
        except requests.exceptions.HTTPError as http_error:
            if http_error.response.status_code == 409:
                show_error(ls, f"{ERROR_PUSH_KEYWORD}: {ERROR_KEYWORD_IS_LOCKED}.")
                push_success = False
            else:
                show_error(ls, f"{ERROR_PUSH_KEYWORD}: {http_error.response.json().get('message')}")
                push_success = False
        except TestBenchKeywordNotFound as not_found_error:
            show_error(ls, ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID.format(uid=not_found_error.uid))
            push_success = False
    if push_success:
        show_info(ls, INFO_CHANGES_PUSHED)


@testbench_ls.command(COMMAND_PULL_SUBDIVISION)
def pull_testbench_subdivision(ls: LanguageServer, *args):
    document_uri, subdivision_uid, needs_user_confirmation, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    existing_resource = TestBenchResourceModel.from_file(document.source)
    if not existing_resource.tb_subdivision_uid or not context_is_valid(ls, existing_resource):
        return
    new_resource = create_resource_from_subdivision(
        uid=subdivision_uid,
    )
    change_identifier = ChangeAnnotationIdentifier()
    edits = []
    create_kw_section = not bool(get_keyword_section(existing_resource.file))
    if create_kw_section:
        minimum_empty_lines_before_section = 0
        if get_variables_section(existing_resource.file):
            kw_section_start = get_variables_section_position(existing_resource.file)[-2]
        elif get_setting_section(existing_resource.file):
            kw_section_start = get_setting_section_position(existing_resource.file)[-2]
        else:
            kw_section_start = get_testbench_context_position(existing_resource.file)[-2]
            minimum_empty_lines_before_section = 1
        edits.extend(
            keyword_section_edit(
                kw_section_start,
                change_identifier,
                minimum_empty_lines_before_section=minimum_empty_lines_before_section,
                existing_trailing_newline_count=_count_trailing_newline_characters(document.source),
            )
        )
    else:
        _, _, kw_section_start, _ = get_keyword_section_position(existing_resource.file)
    visited_keywords = []
    if new_resource and new_resource.keyword_section:
        for new_keyword in new_resource.keyword_section.body:
            visited_keywords.append(get_kw_uid(new_keyword).lower())
            try:
                keyword_match = get_matching_testbench_keyword(new_keyword, existing_resource)
            except MultipleKeywordsWithUid as e:
                show_error(
                    ls,
                    ERROR_DUPLICATE_KEYWORD_UID.format(uid=e.uid),
                )
                continue
            except MultipleKeywordsWithName as e:
                show_error(
                    ls,
                    ERROR_DUPLICATE_KEYWORD_NAME.format(uid=e.name),
                )
                continue
            if not keyword_match:
                edits.append(new_keyword_edit(new_keyword, kw_section_start + 1, change_identifier))
            else:
                if get_keyword_tags(keyword_match) and any(
                    tag in IGNORE_TAGS for tag in get_tags_values(get_keyword_tags(keyword_match))
                ):
                    continue
                edits.extend(create_keyword_edits(keyword_match, new_keyword, change_identifier))
    if existing_resource and existing_resource.keyword_section:
        for existing_keyword in existing_resource.keyword_section.body:
            if not isinstance(existing_keyword, Keyword):
                continue
            if (
                not get_kw_uid(existing_keyword)
                or get_kw_uid(existing_keyword).lower() in visited_keywords
            ):
                continue
            if get_keyword_tags(existing_keyword) and any(
                tag in IGNORE_TAGS for tag in get_tags_values(get_keyword_tags(existing_keyword))
            ):
                continue
            edits.append(get_deleted_testbench_kw_tags_edit(existing_keyword, change_identifier))
    if not edits:
        show_info(ls, INFO_ALREADY_UP_TO_DATE)
        return
    edit = create_workspace_edit(
        document_uri,
        edits,
        change_identifier,
        KEYWORD_INTERFACE_CHANGE_LABEL,
        needs_user_confirmation,
    )
    ls.protocol.send_request(
        WORKSPACE_APPLY_EDIT, ApplyWorkspaceEditParams(edit, WORKSPACE_APPLY_EDIT_LABEL)
    )


def get_matching_testbench_keyword(
    rf_keyword: Keyword, testbench_resource: TestBenchResourceModel
) -> Keyword | None:
    keyword_uid = get_kw_uid(rf_keyword)
    keywords_with_matching_uid = testbench_resource.get_keywords(keyword_uid)
    if len(keywords_with_matching_uid) == 1:
        return keywords_with_matching_uid[0]
    if len(keywords_with_matching_uid) > 1:
        raise MultipleKeywordsWithUid(keyword_uid)
    keywords_with_matching_name = testbench_resource.get_keywords_by_name(rf_keyword.name)
    if len(keywords_with_matching_name) == 1:
        return keywords_with_matching_name[0]
    if len(keywords_with_matching_uid) > 1:
        raise MultipleKeywordsWithName(rf_keyword.name)


def new_keyword_edit(new_keyword, kw_section_start_row, change_identifier):
    return AnnotatedTextEdit(
        change_identifier,
        range=Range(
            start=Position(kw_section_start_row + 2, 0),
            end=Position(kw_section_start_row + 2, 0),
        ),
        new_text=robot_model_to_string(new_keyword),
    )


def _count_trailing_newline_characters(source_text: str) -> int:
    trailing_newline_count = 0
    index = len(source_text) - 1

    # Count trailing LF and CRLF line breaks at EOF.
    while index >= 0:
        if source_text[index] != "\n":
            break
        trailing_newline_count += 1
        index -= 1
        if index >= 0 and source_text[index] == "\r":
            index -= 1

    return trailing_newline_count


def keyword_section_edit(
    keyword_section_line,
    change_identifier,
    minimum_empty_lines_before_section: int = 0,
    existing_trailing_newline_count: int = 0,
):
    keyword_section_text = robot_model_to_string(
        KeywordSection(SectionHeader.from_params(Token.KEYWORD_HEADER))
    )
    required_line_breaks_before_section = minimum_empty_lines_before_section + 1
    missing_line_breaks = max(
        0, required_line_breaks_before_section - existing_trailing_newline_count
    )
    if missing_line_breaks > 0:
        keyword_section_text = "\n" * missing_line_breaks + keyword_section_text
    return [
        AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(keyword_section_line + 3, 0),
                end=Position(keyword_section_line + 3, 0),
            ),
            new_text=keyword_section_text,
        )
    ]


def create_keyword_edits(
    existing_keyword: Keyword,
    new_keyword: Keyword | None,
    change_identifier: ChangeAnnotationIdentifier,
) -> list[AnnotatedTextEdit]:
    edits = []
    if not new_keyword:
        edits.append(
            AnnotatedTextEdit(
                change_identifier,
                range=Range(
                    start=Position(existing_keyword.lineno - 1, 0),
                    end=Position(existing_keyword.end_lineno - 1, existing_keyword.end_col_offset),
                ),
                new_text="",
            )
        )
        return edits
    documentation_edit = get_kw_documentation_edit(existing_keyword, new_keyword, change_identifier)
    if documentation_edit:
        edits.append(documentation_edit)

    if existing_keyword.name != new_keyword.name:
        name_edit = AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(
                    existing_keyword.header.lineno - 1, existing_keyword.header.col_offset
                ),
                end=Position(existing_keyword.header.end_lineno, 0),
            ),
            new_text=robot_model_to_string(KeywordName.from_params(new_keyword.name)),
        )
        edits.append(name_edit)

    tags_edit = get_kw_tags_edit(existing_keyword, new_keyword, change_identifier)
    if tags_edit:
        edits.append(tags_edit)
    arguments_edit = get_kw_arguments_edit(existing_keyword, new_keyword, change_identifier)
    if arguments_edit:
        edits.append(arguments_edit)
    return edits


@testbench_ls.command(COMMAND_SHOW_TESTBENCH_KEYWORD_DIFF)
def show_testbench_keyword_diff(ls: LanguageServer, kwargs):
    document_uri = kwargs.get("document_uri")
    keyword_uid = kwargs.get("keyword_uid")
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = TestBenchResourceModel.from_file(document.source)
    if not context_is_valid(ls, resource):
        return
    change_identifier = ChangeAnnotationIdentifier()
    existing_keywords = resource.get_keywords(keyword_uid)
    try:
        new_keyword = create_rf_keyword_from_tb_keyword(
            keyword_uid,
        )
    except TestBenchKeywordNotFound as e:
        show_error(ls, ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID.format(uid=e.uid))
        return
    if len(existing_keywords) > 1:
        show_error(
            ls,
            ERROR_DUPLICATE_KEYWORD_UID.format(uid=keyword_uid),
        )
        return
    edits = create_keyword_edits(existing_keywords[0], new_keyword, change_identifier)
    if not edits:
        show_info(ls, INFO_ALREADY_UP_TO_DATE)
        return
    testbench_content = apply_text_edits(robot_model_to_string(resource.file), edits)
    ls.protocol.notify(
        "testbench-language-server/display-diff",
        {"path": document_uri, "virtualContent": testbench_content},
    )


@testbench_ls.command(COMMAND_PULL_KEYWORD)
def pull_testbench_keyword(ls: LanguageServer, *args):
    document_uri, keyword_uid = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = TestBenchResourceModel.from_file(document.source)
    if not context_is_valid(ls, resource):
        return
    change_identifier = ChangeAnnotationIdentifier()
    existing_keywords = resource.get_keywords(keyword_uid)
    if not existing_keywords:
        show_warning(
            ls,
            ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID_IN_EXISTING_RESOURCE.format(uid=keyword_uid),
        )
        return
    try:
        new_keyword = create_rf_keyword_from_tb_keyword(
            keyword_uid,
        )
    except TestBenchKeywordNotFound as e:
        show_error(ls, ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID.format(uid=e.uid))
        return
    if len(existing_keywords) > 1:
        show_error(
            ls,
            ERROR_DUPLICATE_KEYWORD_UID.format(uid=keyword_uid),
        )
        return
    edits = create_keyword_edits(existing_keywords[0], new_keyword, change_identifier)
    if not edits:
        show_info(ls, INFO_ALREADY_UP_TO_DATE)
        return
    edit = create_workspace_edit(
        document_uri, edits, change_identifier, KEYWORD_INTERFACE_CHANGE_LABEL
    )
    ls.protocol.send_request(
        WORKSPACE_APPLY_EDIT, ApplyWorkspaceEditParams(edit, WORKSPACE_APPLY_EDIT_LABEL)
    )


def create_workspace_edit(
    document_uri: str,
    edits: list[AnnotatedTextEdit],
    change_identifier: ChangeAnnotationIdentifier,
    change_label: str,
    needs_user_confirmation: bool = True,
) -> WorkspaceEdit:
    return WorkspaceEdit(
        document_changes=[
            TextDocumentEdit(
                text_document=OptionalVersionedTextDocumentIdentifier(document_uri),
                edits=edits,
            )
        ],
        change_annotations={
            change_identifier: ChangeAnnotation(
                change_label, needs_confirmation=needs_user_confirmation
            )
        },
    )


@testbench_ls.command(COMMAND_PUSH_KEYWORD)
def push_testbench_keyword(ls: LanguageServer, kwargs):
    document_uri = kwargs.get("document_uri")
    keyword_uid = kwargs.get("keyword_uid")
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = TestBenchResourceModel.from_file(document.source)
    if not context_is_valid(ls, resource):
        return
    robot_keywords = resource.get_keywords(keyword_uid)
    if len(robot_keywords) > 1:
        show_error(
            ls,
            ERROR_DUPLICATE_KEYWORD_UID.format(uid=keyword_uid),
        )
        return
    rd = ResourceDocumentation(document.path)
    new_docu = (
        rd.get_keyword_documentation(keyword_uid).replace("<br>", "<br/>").replace("<hr>", "<br/>")
    )
    html_description = f"<html><body>{new_docu}</body></html>"
    call_type = get_tb_keyword_call_type(robot_keywords[0])

    try:
        tb_connection = TestBenchResourceConnection.singleton()
        response = patch_tb_keyword_details(
            tb_connection,
            keyword_uid,
            robot_keywords[0].name,
            html_description,
            call_type.value,
        )
        show_info(ls, INFO_CHANGES_PUSHED)
    except requests.exceptions.HTTPError as http_error:
        if http_error.response.status_code == 409:
            show_error(ls, f"{ERROR_PUSH_KEYWORD}: {ERROR_KEYWORD_IS_LOCKED}.")
        else:
            show_error(ls, f"{ERROR_PUSH_KEYWORD}: {http_error.response.json().get('message')}")
    except TestBenchKeywordNotFound as not_found_error:
        show_error(ls, ERROR_FINDING_TESTBENCH_KEYWORD_WITH_UID.format(uid=not_found_error.uid))


@testbench_ls.command(COMMAND_CREATE_KEYWORD)
def create_testbench_keyword(ls: LanguageServer, kwargs):
    document_uri = kwargs.get("document_uri")
    keyword_name = kwargs.get("keyword_name")
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = TestBenchResourceModel.from_file(document.source)
    if not context_is_valid(ls, resource):
        return
    subdivision_uid = resource.tb_subdivision_uid
    robot_keywords = resource.get_keywords_by_name(keyword_name)
    if len(robot_keywords) > 1:
        show_error(
            ls,
            ERROR_DUPLICATE_KEYWORD_NAME.format(name=keyword_name),
        )
        return
    rd = ResourceDocumentation(document.path)
    new_docu = (
        rd.get_keyword_documentation_by_name(keyword_name)
        .replace("<br>", "<br/>")
        .replace("<hr>", "<br/>")
    )
    html_description = f"<html><body>{new_docu}</body></html>"
    arguments = rd.get_keyword_arguments(keyword_name)
    tb_parameters = [{"name": arg, "evaluationType": "CallByValue"} for arg in arguments]
    call_type = get_tb_keyword_call_type(robot_keywords[0])
    try:
        tb_connection = TestBenchResourceConnection.singleton()
        response = post_tb_keyword_details(
            tb_connection,
            robot_keywords[0].name,
            html_description,
            call_type.value,
            subdivision_uid,
            tb_parameters,
        )
        created_kw_uid = response.get("uniqueID")
        show_info(ls, INFO_CREATED_KEYWORD.format(uid=created_kw_uid))
        change_identifier = ChangeAnnotationIdentifier()
        new_keyword = create_rf_keyword_from_tb_keyword(
            created_kw_uid,
        )
        edits = create_keyword_edits(robot_keywords[0], new_keyword, change_identifier)
        if not edits:
            show_info(ls, INFO_ALREADY_UP_TO_DATE)
            return
        edit = create_workspace_edit(
            document_uri,
            edits,
            change_identifier,
            KEYWORD_INTERFACE_CHANGE_LABEL,
            False,
        )
        ls.protocol.send_request(
            WORKSPACE_APPLY_EDIT, ApplyWorkspaceEditParams(edit, WORKSPACE_APPLY_EDIT_LABEL)
        )
    except requests.exceptions.HTTPError as http_error:
        show_error(ls, f"{ERROR_CREATE_KEYWORD}: {http_error.response.json().get('message')}")
    except TestBenchSubdivisionNotFound as not_found_error:
        show_error(ls, ERROR_FINDING_TESTBENCH_SUBDIVISION_WITH_UID.format(uid=not_found_error.uid))


@testbench_ls.feature(TEXT_DOCUMENT_CODE_ACTION)
def code_actions(ls: LanguageServer, params: CodeActionParams):
    document_uri = params.text_document.uri
    document = ls.workspace.get_text_document(params.text_document.uri)
    resource = TestBenchResourceModel.from_file(document.source)
    diagnostics = params.context.diagnostics
    context_diagnostics = [
        diagnostic
        for diagnostic in diagnostics
        if diagnostic.code in (MISSING_CONTEXT_CODE, CONTEXT_MISMATCH_CODE)
    ]
    if not context_diagnostics:
        return []
    return [
        CodeAction(
            "Apply selected TestBench context",
            CodeActionKind.QuickFix,
            command=Command(
                title="apply_testbench_context",
                command="testbench_ls.applyTestBenchContext",
                arguments=[document_uri, params.range.start.line],
            ),
            diagnostics=context_diagnostics,
        )
    ]


@testbench_ls.command(
    "testbench_ls.applyTestBenchContext",
)
def apply_selected_context(ls: LanguageServer, *args):
    document_uri, start_line, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    change_identifier = ChangeAnnotationIdentifier()
    resource = TestBenchResourceModel.from_file(document.source)
    if context_is_valid(ls, resource, silent=True):
        return []
    cont_start, cont_start_char, cont_end, cont_end_char = get_testbench_context_position(
        resource.file
    )
    updated_context = CONTEXT_STRING.format(project=ls.project, tov=ls.tov)
    if all(v == 0 for v in (cont_start, cont_start_char, cont_end, cont_end_char)):
        _, _, cont_end, cont_end_char = get_comment_section_end_position(resource.file)
        cont_start = cont_end
        cont_start_char = cont_end_char
        updated_context = f"\n{updated_context}"
    edits = [
        AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(cont_start, cont_start_char),
                end=Position(cont_end, cont_end_char),
            ),
            new_text=updated_context,
        )
    ]
    edit = create_workspace_edit(document_uri, edits, change_identifier, CONTEXT_CHANGE_LABEL)
    ls.protocol.send_request(
        WORKSPACE_APPLY_EDIT, ApplyWorkspaceEditParams(edit, WORKSPACE_APPLY_EDIT_LABEL)
    )


def get_context_diagnostics(ls: LanguageServer, document: TextDocument) -> list[Diagnostic]:
    resource = TestBenchResourceModel.from_file(document.source)
    if not resource.tb_subdivision_uid:
        return []
    if context_is_valid(ls, resource, silent=True):
        return []
    cont_start, cont_start_char, cont_end, cont_end_char = get_testbench_context_position(
        resource.file
    )
    if all(v == 0 for v in (cont_start, cont_start_char, cont_end, cont_end_char)):
        comment_start, comment_start_char, comment_end, comment_end_char = (
            get_comment_section_end_position(resource.file)
        )
        return [
            Diagnostic(
                code=MISSING_CONTEXT_CODE,
                range=Range(
                    start=Position(comment_start, comment_start_char),
                    end=Position(comment_end, comment_end_char),
                ),
                message=WARNING_MISSING_CONTEXT,
                severity=DiagnosticSeverity.Warning,
            )
        ]
    project, tov = resource.tb_tov_context
    return [
        Diagnostic(
            code=CONTEXT_MISMATCH_CODE,
            range=Range(
                start=Position(cont_start, cont_start_char),
                end=Position(cont_end, cont_end_char),
            ),
            message=WARNING_CONTEXT_MISMATCH.format(
                selected_context=f"{ls.project}/{ls.tov}",
                resource_context=f"{project}/{tov}",
            ),
            severity=DiagnosticSeverity.Warning,
        )
    ]


@testbench_ls.feature(TEXT_DOCUMENT_DID_OPEN)
def did_open(ls: LanguageServer, params: DidOpenTextDocumentParams):
    document = ls.workspace.get_text_document(params.text_document.uri)
    diagnostics = get_context_diagnostics(ls, document)
    ls.text_document_publish_diagnostics(
        PublishDiagnosticsParams(document.uri, diagnostics=diagnostics, version=document.version)
    )


@testbench_ls.feature(TEXT_DOCUMENT_DID_CHANGE)
def did_change(ls: LanguageServer, params: DidOpenTextDocumentParams):
    document = ls.workspace.get_text_document(params.text_document.uri)
    diagnostics = get_context_diagnostics(ls, document)
    ls.text_document_publish_diagnostics(
        PublishDiagnosticsParams(document.uri, diagnostics=diagnostics, version=document.version)
    )


@testbench_ls.command(COMMAND_FIND_KEYWORD_POSITION)
def find_keyword_position(ls: LanguageServer, *args) -> int | None:
    document_uri, keyword_name, keyword_uid, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = TestBenchResourceModel.from_file(document.source)
    keywords_by_uid = resource.get_keywords(keyword_uid)
    if len(keywords_by_uid) > 1:
        show_warning(
            ls,
            ERROR_DUPLICATE_KEYWORD_UID.format(uid=keyword_uid),
        )
        log(
            ls,
            ERROR_DUPLICATE_KEYWORD_UID_IN_FILE.format(uid=keyword_uid, uri=document_uri),
            LogLevel.DEBUG,
        )
        return None
    if len(keywords_by_uid) == 1:
        return keywords_by_uid[0].lineno - 1
    keywords_by_name = resource.get_keywords_by_name(keyword_name)
    if len(keywords_by_name) > 1:
        show_warning(
            ls,
            ERROR_DUPLICATE_KEYWORD_NAME.format(name=keyword_name),
        )
        log(
            ls,
            ERROR_DUPLICATE_KEYWORD_NAME_IN_FILE.format(name=keyword_name, uri=document_uri),
            LogLevel.DEBUG,
        )
        return None
    if len(keywords_by_uid) == 1:
        return keywords_by_name[0].lineno - 1
    show_info(ls, INFO_TESTBENCH_KEYWORD_DOES_NOT_EXIST.format(name=keyword_name))
    log(
        ls,
        INFO_TESTBENCH_KEYWORD_DOES_NOT_EXIST_IN_FILE.format(
            name=keyword_name, uid=keyword_uid, uri=document_uri
        ),
        LogLevel.INFO,
    )
    return None


def start_language_server(
    server_name: str,
    server_port: str,
    login_name: str,
    session_token: str,
    project: str,
    tov: str,
):
    TestBenchResourceConnection(server_name, server_port, login_name, session_token, project, tov)
    testbench_ls.set_server_name(server_name)
    testbench_ls.set_server_port(server_port)
    testbench_ls.set_login_name(login_name)
    testbench_ls.set_session_token(session_token)
    testbench_ls.set_project(project)
    testbench_ls.set_tov(tov)
    testbench_ls.start_io()
