import logging
import re

import requests  # type: ignore
from testbench2robotframework.cli import generate_tests
from lsprotocol.types import (
    INITIALIZE,
    TEXT_DOCUMENT_CODE_ACTION,
    TEXT_DOCUMENT_CODE_LENS,
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
    ExecuteCommandParams,
    InitializeParams,
    InitializeResult,
    OptionalVersionedTextDocumentIdentifier,
    Position,
    Range,
    ServerCapabilities,
    TextDocumentEdit,
    TextDocumentSyncKind,
    WorkspaceEdit,
)
from pygls.server import LanguageServer
from robot.api.parsing import Documentation, Keyword, KeywordSection, SectionHeader, Token

from testbench_ls import __version__
import pathlib

from .robot_utils import (
    get_keyword_arguments,
    get_keyword_arguments_position,
    get_keyword_documentation,
    get_keyword_documentation_position,
    get_keyword_section,
    get_keyword_section_position,
    get_keyword_tags,
    get_keyword_tags_position,
    get_setting_section_position,
    get_variables_section,
    get_variables_section_position,
    robot_model_to_string,
)
from .testbench_keysync.resource_creation import (
    create_keyword,
    create_resource,
)
from .testbench_keysync.resource_documentation import ResourceDocumentation
from .testbench_keysync.resource_file import RobotResourceFile
from .testbench_keysync.testbench_patch import patch_interaction_details

class TestBenchLanguageServer(LanguageServer):
    def __init__(self):
        super().__init__("testbench-language-server", __version__)
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

@testbench_ls.command("testbench_ls.generateTestSuites")
def generate_test_suites(ls: LanguageServer, kwargs):
    """Generate Robot Framework test suites via testbench2robotframework."""
    kwargs, *_ = kwargs
    generate_tests.callback(
        clean=None,
        compound_interaction_logging=None,
        config=None,
        fully_qualified=None,
        library_regex=(),
        library_root=(),
        log_suite_numbering=False,
        output_directory=None,
        resource_directory=None,
        resource_regex=(),
        resource_root=(),
        library_mapping={},
        resource_mapping={},
        testbench_report=pathlib.Path(kwargs.get("testbench_report")),
    )


@testbench_ls.feature(INITIALIZE)
def initialize(params: InitializeParams) -> InitializeResult:
    server_capabilities = ServerCapabilities(text_document_sync=TextDocumentSyncKind.Full)
    return InitializeResult(capabilities=server_capabilities)


@testbench_ls.command("testbench_ls.updateServerName")
def update_server_name(ls: LanguageServer, args):
    """Update the server name."""
    new_name, *_ = args
    ls.set_server_name(new_name)


@testbench_ls.command("testbench_ls.updateServerPort")
def update_server_port(ls: LanguageServer, args):
    """Update the server port."""
    new_port, *_ = args
    ls.set_server_port(new_port)


@testbench_ls.command("testbench_ls.updateLoginName")
def update_login_name(ls: LanguageServer, args):
    """Update the login name."""
    new_name, *_ = args
    ls.set_login_name(new_name)


@testbench_ls.command("testbench_ls.updateSessionToken")
def update_session_token(ls: LanguageServer, args):
    """Update the session_token."""
    new_session_token, *_ = args
    ls.set_session_token(new_session_token)


@testbench_ls.command("testbench_ls.updateProject")
def update_project(ls: LanguageServer, args):
    """Update the project."""
    new_project, *_ = args
    ls.set_project(new_project)


@testbench_ls.command("testbench_ls.updateTov")
def update_tov(ls: LanguageServer, args):
    """Update the TOV."""
    new_tov, *_ = args
    ls.set_tov(new_tov)


@testbench_ls.feature(TEXT_DOCUMENT_CODE_LENS)
def code_lens_provider(ls: LanguageServer, params: CodeLensParams):
    code_lenses = []
    document_uri = params.text_document.uri
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = RobotResourceFile.from_file(document.source)
    if resource.tb_subdivision_uid:
        pull_resource_lens = CodeLens(
            range=Range(start=Position(line=0, character=0), end=Position(line=0, character=0)),
            command=Command(
                title="Pull TestBench Subdivision",
                command="testbench_ls.pullSubdivision",
                arguments=[document_uri, resource.tb_subdivision_uid],
            ),
        )
        code_lenses.append(pull_resource_lens)
    for keyword in resource.keywords:
        keyword_uid = resource.get_kw_uid(keyword)
        if keyword_uid:
            keyword_line = keyword.lineno - 1
            code_lenses.append(
                CodeLens(
                    range=Range(
                        start=Position(line=keyword_line, character=0),
                        end=Position(line=keyword_line, character=0),
                    ),
                    command=Command(
                        title="Pull TestBench Keyword",
                        command="testbench_ls.pullKeyword",
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
                        title="Push TestBench Keyword",
                        command="testbench_ls.pushKeyword",
                        arguments=[document_uri, keyword_uid],
                    ),
                )
            )
    return code_lenses


@testbench_ls.command("testbench_ls.pullSubdivision")
def pull_testbench_subdivision(ls: LanguageServer, args):
    document_uri, subdivision_uid, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    logging.info(f"{ls.server_name} {ls.server_port}  {ls.login_name}  {ls.session_token}")
    new_resource = create_resource(
        ls.server_name,
        ls.server_port,
        ls.login_name,
        ls.session_token,
        ls.project,
        ls.tov,
        uid=subdivision_uid,
    )
    existing_resource = RobotResourceFile.from_file(document.source)
    change_identifier = ChangeAnnotationIdentifier()
    edits = []
    create_kw_section = not bool(get_keyword_section(existing_resource.file))
    if create_kw_section:
        if get_variables_section(existing_resource.file):
            _, _, kw_section_start, _ = get_variables_section_position(existing_resource.file)
        else:
            _, _, kw_section_start, _ = get_setting_section_position(existing_resource.file)
        edits.extend(keyword_section_edit(kw_section_start, change_identifier))

    else:
        _, _, kw_section_start, _ = get_keyword_section_position(existing_resource.file)
    for new_keyword in new_resource.keyword_section.body:
        keyword_uid = new_resource.get_kw_uid(new_keyword)
        existing_keyword = existing_resource.get_keyword(keyword_uid)
        if existing_keyword:
            edits.extend(create_keyword_edits(existing_keyword, new_keyword, change_identifier))
        else:
            edits.append(new_keyword_edit(new_keyword, kw_section_start + 1, change_identifier))

    if edits:
        edit = WorkspaceEdit(
            document_changes=[
                TextDocumentEdit(
                    text_document=OptionalVersionedTextDocumentIdentifier(document_uri),
                    edits=edits,
                )
            ],
            change_annotations={
                change_identifier: ChangeAnnotation(
                    "Keyword interface changes", needs_confirmation=False
                )
            },
        )
        ls.lsp.send_request(
            WORKSPACE_APPLY_EDIT, ApplyWorkspaceEditParams(edit, "Refactoring Preview")
        )


def new_keyword_edit(new_keyword, kw_section_start_row, change_identifier):
    return AnnotatedTextEdit(
        change_identifier,
        range=Range(
            start=Position(kw_section_start_row + 2, 0),
            end=Position(kw_section_start_row + 2, 0),
        ),
        new_text=robot_model_to_string(new_keyword),
    )


def keyword_section_edit(keyword_section_line, change_identifier):
    return [
        AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(keyword_section_line + 3, 0),
                end=Position(keyword_section_line + 3, 0),
            ),
            new_text=robot_model_to_string(
                KeywordSection(SectionHeader.from_params(Token.KEYWORD_HEADER))
            ),
        )
    ]


def create_keyword_edits(
    existing_keyword, new_keyword, change_identifier
) -> list[AnnotatedTextEdit]:
    edits = []
    existing_keyword_documentation = get_keyword_documentation(existing_keyword)
    new_keyword_documentation = get_keyword_documentation(new_keyword)
    if existing_keyword_documentation:
        new_docu = robot_model_to_string(new_keyword_documentation).rstrip()
    else:
        new_docu = robot_model_to_string(new_keyword_documentation)
    if re.sub(
        r"\s|\n|\.\.\.", r"", robot_model_to_string(new_keyword_documentation), flags=re.MULTILINE
    ) != re.sub(
        r"\s|\n|\.\.\.",
        r"",
        robot_model_to_string(existing_keyword_documentation),
        flags=re.MULTILINE,
    ):
        doc_start, doc_start_char, doc_end, doc_end_char = get_keyword_documentation_position(
            existing_keyword
        )
        documentation_edit = AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(doc_start, doc_start_char),
                end=Position(doc_end, doc_end_char),
            ),
            new_text=new_docu,
        )
        edits.append(documentation_edit)

    if existing_keyword.name != new_keyword.name:
        name_edit = AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(existing_keyword.lineno - 1, 0),
                end=Position(existing_keyword.lineno - 1, len(existing_keyword.name)),
            ),
            new_text=new_keyword.name,
        )
        edits.append(name_edit)

    existing_keyword_tags = get_keyword_tags(existing_keyword)
    new_keyword_tags = get_keyword_tags(new_keyword)
    if robot_model_to_string(new_keyword_tags) != robot_model_to_string(existing_keyword_tags):
        tags_start, tags_start_char, tags_end, tags_end_char = get_keyword_tags_position(
            existing_keyword
        )
        tags_edit = AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(tags_start, tags_start_char),
                end=Position(tags_end, tags_end_char),
            ),
            new_text=robot_model_to_string(new_keyword_tags).rstrip(),
        )
        # edits.append(tags_edit)

    existing_keyword_arguments = get_keyword_arguments(existing_keyword)
    new_keyword_arguments = get_keyword_arguments(new_keyword)
    if existing_keyword_arguments:
        new_args = robot_model_to_string(new_keyword_arguments).rstrip()
    else:
        new_args = robot_model_to_string(new_keyword_arguments)
    if robot_model_to_string(new_keyword_arguments) != robot_model_to_string(
        existing_keyword_arguments
    ):
        arg_start, arg_start_char, arg_end, arg_end_char = get_keyword_arguments_position(
            existing_keyword
        )
        arguments_edit = AnnotatedTextEdit(
            change_identifier,
            range=Range(
                start=Position(arg_start, arg_start_char),
                end=Position(arg_end, arg_end_char),
            ),
            new_text=new_args,
        )
        edits.append(arguments_edit)
    return edits


@testbench_ls.command("testbench_ls.pullKeyword")
def pull_testbench_keyword(ls: LanguageServer, args):
    document_uri, keyword_uid, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = RobotResourceFile.from_file(document.source)
    edits = []
    change_identifier = ChangeAnnotationIdentifier()

    existing_keyword = resource.get_keyword(keyword_uid)
    new_keyword = create_keyword(
        ls.server_name, ls.server_port, ls.login_name, ls.session_token, ls.project, ls.tov, keyword_uid
    )
    edits.extend(create_keyword_edits(existing_keyword, new_keyword, change_identifier))
    if edits:
        edit = WorkspaceEdit(
            document_changes=[
                TextDocumentEdit(
                    text_document=OptionalVersionedTextDocumentIdentifier(document_uri),
                    edits=edits,
                )
            ],
            change_annotations={
                change_identifier: ChangeAnnotation(
                    "Keyword interface changes", needs_confirmation=True
                )
            },
        )
        ls.lsp.send_request(
            WORKSPACE_APPLY_EDIT, ApplyWorkspaceEditParams(edit, "Refactoring Preview")
        )


@testbench_ls.command("testbench_ls.pushKeyword")
def push_testbench_keyword(ls: LanguageServer, args):
    document_uri, keyword_uid, *_ = args
    document = testbench_ls.workspace.get_text_document(document_uri)
    resource = RobotResourceFile.from_file(document.source)
    robot_keyword = resource.get_keyword(keyword_uid)
    rd = ResourceDocumentation(document.path)
    new_docu = rd.get_keyword_documentation(keyword_uid)
    html_description = (
        f"<html><body>{new_docu.replace('<br>', '<br/>').replace('<hr>', '<br/>')}</body></html>"
    )
    try:
        response = patch_interaction_details(
            ls.server_name,
            ls.server_port,
            ls.login_name,
            ls.session_token,
            ls.project,
            ls.tov,
            keyword_uid,
            robot_keyword.name,
            html_description,
        )
    except requests.exceptions.HTTPError as http_error:
        if http_error.response.status_code == 409:
            ls.send_notification(
                    "custom/notification",
                    {"message": f"Failed to push keyword: Element is locked in TestBench."},
                )
        else:
            ls.send_notification(
                "custom/notification",
                {"message": f"Failed to push keyword: {http_error.response.text}"},
            )
    


# @testbench_ls.feature(TEXT_DOCUMENT_CODE_ACTION)
# def code_actions(ls: LanguageServer, params: CodeActionParams):
#     document_uri = params.text_document.uri
#     code_actions = []
#     document = testbench_ls.workspace.get_text_document(document_uri)
#     resource = RobotResourceFile.from_file(document.source)
#     for keyword in resource.keywords:
#         if (
#             params.range.start.line >= keyword.lineno - 1
#             and params.range.start.line <= keyword.end_lineno - 1
#         ):
#             code_action = CodeAction(
#                 "Create AI Documentation",
#                 CodeActionKind.QuickFix,
#                 command=Command(
#                     title="create_ai_documentation",
#                     command="testbench_ls.createKeywordDocumentation",
#                     arguments=[document_uri, params.range.start.line],
#                 ),
#             )
#             code_actions.append(code_action)
#             return code_actions
#     return code_actions


# @testbench_ls.command("testbench_ls.createKeywordDocumentation")
# def create_keyword_documentation(ls: LanguageServer, args):
#     if not ls.ai_server_address:
#         ls.send_notification(
#             "custom/notification",
#             {"message": "Extension setting 'testbenchExtension.ai_server_address' not set."},
#         )
#         return
#     document_uri, start_line, *_ = args
#     document = testbench_ls.workspace.get_text_document(document_uri)
#     resource = RobotResourceFile.from_file(document.source)
#     edits = []
#     change_identifier = ChangeAnnotationIdentifier()
#     existing_keyword = next(
#         filter(
#             lambda keyword: start_line >= keyword.lineno - 1
#             and start_line <= keyword.end_lineno - 1,
#             list(resource.keywords),
#         )
#     )
#     existing_keyword_documentation = get_keyword_documentation(existing_keyword)
#     doc_start, doc_start_char, doc_end, doc_end_char = get_keyword_documentation_position(
#         existing_keyword
#     )
#     new_keyword_documentation = ls.generate_ai_documentation(existing_keyword)
#     new_keyword_documentation = Documentation.from_params(
#         new_keyword_documentation, settings_section=False
#     )

#     if existing_keyword_documentation:
#         new_docu = robot_model_to_string(new_keyword_documentation).rstrip()
#     else:
#         new_docu = robot_model_to_string(new_keyword_documentation)
#     documentation_edit = AnnotatedTextEdit(
#         change_identifier,
#         range=Range(
#             start=Position(doc_start, doc_start_char),
#             end=Position(doc_end, doc_end_char),
#         ),
#         new_text=new_docu,
#     )
#     edits.append(documentation_edit)
#     if edits:
#         edit = WorkspaceEdit(
#             document_changes=[
#                 TextDocumentEdit(
#                     text_document=OptionalVersionedTextDocumentIdentifier(document_uri),
#                     edits=edits,
#                 )
#             ],
#             change_annotations={
#                 change_identifier: ChangeAnnotation(
#                     "Keyword interface changes", needs_confirmation=False
#                 )
#             },
#         )
#         ls.lsp.send_request(
#             WORKSPACE_APPLY_EDIT, ApplyWorkspaceEditParams(edit, "Refactoring Preview")
#         )


def start_language_server(
    server_name: str,
    server_port: str,
    login_name: str,
    session_token: str,
    project: str,
    tov: str,
):
    logging.basicConfig(filename="pygls.log", filemode="w", level=logging.DEBUG)
    testbench_ls.set_server_name(server_name)
    testbench_ls.set_server_port(server_port)
    testbench_ls.set_login_name(login_name)
    testbench_ls.set_session_token(session_token)
    testbench_ls.set_project(project)
    testbench_ls.set_tov(tov)
    testbench_ls.start_io()
