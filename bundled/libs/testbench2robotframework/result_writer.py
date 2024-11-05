import html
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from shutil import copytree
from typing import Dict, List, Optional, Union
from urllib.parse import unquote

from robot.result import Keyword, ResultVisitor, TestCase, TestSuite
from robot.result.model import Body

from .config import AttachmentConflictBehaviour, Configuration, ReferenceBehaviour
from .json_reader import TestBenchJsonReader
from .json_writer import write_main_protocol, write_test_structure_element
from .log import logger
from .model import (
    ActivityStatus,
    ExecStatus,
    InteractionDetails,
    InteractionExecutionSummary,
    InteractionType,
    InteractionVerdict,
    MainProtocol,
    ProtocolComments,
    ProtocolTestCaseExecutionSummary,
    ProtocolTestCaseResult,
    ProtocolTestCaseSetExecutionSummary,
    Reference,
    ReferenceType,
    SequencePhase,
    TestCaseDetails,
    TestCaseExecutionDetails,
    VerdictStatus,
)
from .utils import directory_to_zip, ensure_dir_exists, get_directory

BACKGROUND_COLOR = {
    "PASS": "#04AF91",
    "FAIL": "#ce3e01",
    "ERROR": "#ce3e01",
    "SKIP": "#F3E96A",
    "WARN": "#D48627",
    "INFO": "#ddd",
}
COLOR = {
    "PASS": "#fff",
    "FAIL": "#fff",
    "ERROR": "#fff",
    "SKIP": "#000",
    "WARN": "#fff",
    "INFO": "#000",
}

MEGABYTE = 1000 * 1000


class ResultWriter(ResultVisitor):
    def __init__(
        self, json_report: str, json_result: Optional[str], config: Configuration, output_xml, listener_uid=None
    ) -> None:
        self.listener_uid = listener_uid
        self.json_dir = get_directory(json_report)
        self.output_xml = output_xml
        self.reference_behaviour = config.referenceBehaviour
        self.attachment_conflict_behaviour = config.attachmentConflictBehaviour
        self.tempdir = tempfile.TemporaryDirectory(dir=os.curdir)
        self._test_setup_passed: Optional[bool] = None
        if json_result is None:
            self.json_result = self.json_dir
            self.json_result_path = self.json_dir
            self.create_zip = bool(Path(json_report).suffix == ".zip")
        else:
            self.create_zip = bool(Path(json_result).suffix == ".zip")
            self.json_result_path = str(Path(json_result).parent / Path(json_result).stem)
            self.json_result = self.tempdir.name
            if self.create_zip:
                copytree(self.json_dir, self.json_result, dirs_exist_ok=True)
        self.json_reader = TestBenchJsonReader(self.json_dir)
        self.attachments_path = Path(self.json_result, "attachments")
        # if self.attachments_path.exists():  TODO: RR Sollten wir löschen????
        #     shutil.rmtree(self.attachments_path)
        # os.mkdir(self.attachments_path)
        self.test_suites: Dict[str, TestSuite] = {}
        self.keywords: List[Keyword] = []
        self.itb_test_case_catalog: Dict[str, TestCaseDetails] = {}
        self.phase_pattern = config.phasePattern
        self.test_chain: List[TestCase] = []
        self.main_protocol = MainProtocol.from_list([])

    def start_suite(self, suite: TestSuite):
        if suite.metadata:
            self.test_suites[suite.metadata["uniqueID"]] = suite
        self.protocol_test_cases: list[ProtocolTestCaseExecutionSummary] = []

    def _get_interactions_by_type(
        self, interactions: List[InteractionDetails], interaction_type: InteractionType
    ):
        for interaction in interactions:
            if interaction.interactionType == interaction_type:
                yield interaction
            if interaction.interactionType == InteractionType.Compound:
                yield from self._get_interactions_by_type(
                    interaction.interactions, interaction_type
                )

    def _propergate_sequence_phase(self, interaction: InteractionDetails, sequence_phase):
        for child in interaction.interactions:
            child.spec.sequencePhase = sequence_phase
            self._propergate_sequence_phase(child, sequence_phase)

    def end_test(self, test: TestCase):
        self._test_setup_passed = None
        test_chain = get_test_chain(test.name, self.phase_pattern)
        if test_chain:
            if test_chain.index == 1:
                self.test_chain = [test]
            else:
                self.test_chain.append(test)
            if test_chain.index != test_chain.length:
                return
        else:
            self.test_chain = [test]

        test_uid = test_chain.name if test_chain else test.name
        itb_test_case = self.json_reader.read_test_case(test_uid)  # TODO What if name != UID
        for interaction in itb_test_case.interactions:
            self._propergate_sequence_phase(interaction, interaction.spec.sequencePhase)
        self.protocol_test_case: ProtocolTestCaseExecutionSummary = (
            ProtocolTestCaseExecutionSummary(test_uid, itb_test_case.exec.key, None, None, None)
        )
        if itb_test_case.exec is None:
            itb_test_case.exec = TestCaseExecutionDetails.from_dict({})
        if itb_test_case.exec.key in ["", "-1"]:
            logger.warning(
                f"Test case {itb_test_case.uniqueID} was not exported based on "
                f"execution and is therefore not importable."
            )
        try:
            atomic_interactions = list(
                self._get_interactions_by_type(itb_test_case.interactions, InteractionType.Atomic)
            )
            compound_interactions = list(
                self._get_interactions_by_type(itb_test_case.interactions, InteractionType.Compound)
            )
            self._set_atomic_interactions_execution_result(atomic_interactions, self.test_chain)
            for interaction in compound_interactions:
                self._set_compound_interaction_execution_result(interaction)
            self._set_itb_testcase_execution_result(itb_test_case, self.test_chain)
            self._set_itb_testcase_execution_comment(itb_test_case, self.test_chain)
            if self.reference_behaviour != ReferenceBehaviour.NONE:
                self._set_itb_testcase_references(itb_test_case, self.test_chain)
        except TypeError:
            logger.error(
                "Could not find an itb testcase that corresponds "
                "to the given Robot Framework testcase."
            )
        self.itb_test_case_catalog[test_uid] = itb_test_case
        self.protocol_test_cases.append(self.protocol_test_case)
        write_test_structure_element(self.json_result, itb_test_case)
        logger.debug(
            f"Successfully wrote the result from test "
            f"{itb_test_case.uniqueID} to TestBench's Json Report."
        )

    def _set_itb_testcase_references(
        self, itb_test_case: TestCaseDetails, test_chain: List[TestCase]
    ):
        for test in test_chain:
            itb_references = self._get_itb_reference(test.message)
            for reference in itb_references:
                if reference not in itb_test_case.exec.references:
                    itb_test_case.exec.references.append(reference)

    def _get_itb_reference(self, test_message: str) -> List[Reference]:
        references = []
        for path in re.findall(r"itb-reference:\s*(\S*)", test_message):
            if path.startswith("file:///"):
                file_path = Path(unquote(path[len("file:///") :]))
                output_dir = Path(self.output_xml).parent
                if file_path.exists():
                    reference_path = file_path
                elif Path(output_dir, file_path).exists():
                    reference_path = Path(output_dir, file_path)
                else:
                    if (
                        file_path.is_absolute()
                        and self.reference_behaviour == ReferenceBehaviour.REFERENCE
                    ):
                        references.append(self._create_reference(file_path))
                    else:
                        logger.warning(f"Referenced file '{file_path}' does not exist.")
                    continue
                file_size = os.path.getsize(reference_path)
                if file_size >= 10 * MEGABYTE:
                    logger.error(
                        f"Trying to attach file '{reference_path}'. "
                        "Attachment file size must not exceed 10 MB "
                        f"but is {file_size / MEGABYTE} MB."
                    )
                    reference = self._create_reference(reference_path.name)
                else:
                    reference = self._create_attachment(reference_path)
                if reference:
                    references.append(reference)
            elif re.match(r"\S+://", path):
                references.append(Reference(ReferenceType.Hyperlink, path))
            else:
                logger.warning(f"Could not identify type of test message reference '{path}'.")
        return references

    @staticmethod
    def _create_reference(reference_path: Union[Path, str]) -> Reference:
        return Reference(ReferenceType.Reference, str(reference_path))

    def _create_attachment(self, filepath: Path) -> Optional[Reference]:
        if self.reference_behaviour == ReferenceBehaviour.REFERENCE:
            return self._create_reference(filepath.resolve())
        ensure_dir_exists(self.attachments_path)
        filename = Path(filepath).name
        if (
            not Path(self.attachments_path, filename).exists()
            or self.attachment_conflict_behaviour == AttachmentConflictBehaviour.USE_NEW
        ):
            shutil.copyfile(filepath, self.attachments_path / filename, follow_symlinks=True)
            return Reference(ReferenceType.Attachment, f"attachments/{filename}")
        if self.attachment_conflict_behaviour == AttachmentConflictBehaviour.USE_EXISTING:
            return Reference(ReferenceType.Attachment, f"attachments/{filename}")
        if self.attachment_conflict_behaviour == AttachmentConflictBehaviour.RENAME_NEW:
            unique_path = self._create_unique_path(self.attachments_path / filename)
            shutil.copyfile(filepath, unique_path, follow_symlinks=True)
            unique_file = Path(unique_path).name
            logger.info(
                f"Attachment '{filename}' does already exist. "
                f"Creating new unique attachment '{unique_file}'."
            )
            return Reference(ReferenceType.Attachment, f"attachments/{unique_file}")
        if self.attachment_conflict_behaviour == AttachmentConflictBehaviour.ERROR:
            logger.error(f"Attachment '{filename}' does already exist.")
            return None
        return None

    @staticmethod
    def _create_unique_path(attachement_path: Path) -> Path:
        counter = 1
        attachment_stem = attachement_path.stem
        while attachement_path.exists():
            attachement_path = Path(
                f"{attachement_path.parent}",
                f"{attachment_stem}_{counter}{attachement_path.suffix}",
            )
            counter += 1
        return attachement_path

    def _set_itb_testcase_execution_comment(self, itb_test_case, test_chain: List[TestCase]):
        exec_comments = []
        for test in test_chain:
            message = re.sub(r"\s*itb-reference:\s*(\S*)", "", test.message)
            html_message = (
                message[len("*HTML*") :].replace("<hr>", "<br/>").replace("<br>", "<br/>").strip()
                if test.message.startswith("*HTML*")
                else html.escape(message)
            )
            test_chain_obj = get_test_chain(test.name, self.phase_pattern)
            test_phase_name = (
                f"<b>Phase {test_chain_obj.index}/{test_chain_obj.length} : "
                f"<span {self.render_status(test.status)}>{test.status}</span></b>"
                if test_chain_obj
                else f"<b><span {self.render_status(test.status)}>{test.status}</span></b>"
            )
            exec_comment = (
                f"{test_phase_name}"
                "<pre>"
                f"Start Time:   {self.get_isotime_from_robot_timestamp(test.starttime)}\n"
                f"End Time:     {self.get_isotime_from_robot_timestamp(test.endtime)}\n"
                f"Elapsed Time: {timedelta(milliseconds=test.elapsedtime)!s}\n"
                "</pre>"
                f"Message: <p><pre>{html_message}</pre></p>\n"
            )
            exec_comments.append(exec_comment)
        itb_test_case.exec.comments = f"<html><body>{''.join(exec_comments)}</body></html>"
        self.protocol_test_case.comments = ProtocolComments(
            html=f"<html><body>{''.join(exec_comments)}</body></html>"
        )
        end_time=test.end_time.replace(tzinfo=timezone(datetime.now(timezone.utc).astimezone().utcoffset()))
        # self.protocol_test_case.result.timestamp = end_time.isoformat() # Isoformat currently not suported by server
        self.protocol_test_case.result.timestamp = f"{end_time.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]}Z"
        self.protocol_test_case.durationMillis = test.elapsedtime

    def _set_itb_testcase_execution_result(self, itb_test_case, test_chain):
        has_failed_chain = list(filter(lambda tc: tc.status.upper() == "FAIL", test_chain))
        passed_keywords = all(tc.status.upper() == "PASS" for tc in test_chain)
        elapsed_time = sum([tc.elapsedtime for tc in test_chain])
        itb_test_case.exec.actualDuration = elapsed_time
        self.protocol_test_case.durationMillis = elapsed_time
        if has_failed_chain:
            protocol_result = self._set_itb_test_case_status(itb_test_case, "fail")
            self.protocol_test_case.result = protocol_result
        elif passed_keywords:
            protocol_result = self._set_itb_test_case_status(itb_test_case, "pass")
            self.protocol_test_case.result = protocol_result
        else:
            protocol_result = self._set_itb_test_case_status(itb_test_case, "undef")
            self.protocol_test_case.result = protocol_result

    def _get_test_phase_body(self, test_phase: TestCase) -> Body:
        return test_phase.body

    def _get_test_phase_setup(self, test_phase: TestCase) -> List[Keyword]:
        test_phase_setup = []
        if test_phase.has_setup and test_phase.setup:
            self._test_setup_passed = test_phase.setup.passed
            if test_phase.setup.name == f"Setup-{test_phase.name}":
                test_phase_setup = list(
                    filter(
                        lambda kw: isinstance(kw, Keyword)
                        and kw.parent.name == f"Setup-{test_phase.name}",
                        test_phase.setup.body,
                    )
                )
            else:
                test_phase_setup = [test_phase.setup]
        return test_phase_setup

    def _get_test_phase_teardown(self, test_phase: TestCase) -> List[Keyword]:
        test_phase_teardown = []
        if test_phase.has_teardown and test_phase.teardown:
            if test_phase.teardown.name == f"Teardown-{test_phase.name}":
                test_phase_teardown = list(
                    filter(
                        lambda kw: isinstance(kw, Keyword)
                        and kw.parent.name == f"Teardown-{test_phase.name}",
                        test_phase.teardown.body,
                    )
                )
            else:
                test_phase_teardown = [test_phase.teardown]
        return test_phase_teardown

    def _set_atomic_interactions_execution_result(
        self, atomic_interactions: List[InteractionDetails], test_chain: List[TestCase]
    ):
        self._test_setup_passed = True
        test_chain_setup = [
            keyword
            for test_phase in test_chain
            for keyword in self._get_test_phase_setup(test_phase)
        ]
        test_chain_body = [
            keyword
            for test_phase in test_chain
            for keyword in self._get_test_phase_body(test_phase)
        ]
        test_chain_teardown = [
            keyword
            for test_phase in test_chain
            for keyword in self._get_test_phase_teardown(test_phase)
        ]
        setup_interactions = self._filter_atomic_interactions_by_sequence_phase(
            atomic_interactions, SequencePhase.Setup
        )
        test_step_interactions = self._filter_atomic_interactions_by_sequence_phase(
            atomic_interactions, SequencePhase.TestStep
        )
        teardown_interactions = self._filter_atomic_interactions_by_sequence_phase(
            atomic_interactions, SequencePhase.Teardown
        )
        self._set_interaction_verdicts(setup_interactions, test_chain_setup, SequencePhase.Setup)
        self._set_interaction_verdicts(
            test_step_interactions, test_chain_body, SequencePhase.TestStep
        )
        self._set_interaction_verdicts(
            teardown_interactions, test_chain_teardown, SequencePhase.Teardown
        )

    def _set_interaction_verdicts(
        self,
        interaction_list: List[InteractionDetails],
        test_chain_body: List[Keyword],
        sequence_phase: SequencePhase,
    ):
        for index, interaction in enumerate(interaction_list):
            if interaction.exec is None:
                interaction.exec = InteractionExecutionSummary.from_dict({})
            if sequence_phase == SequencePhase.TestStep and not self._test_setup_passed:
                interaction.exec.verdict = InteractionVerdict.Skipped
                continue
            if index < len(test_chain_body):
                keyword = test_chain_body[index]
                self._check_matching_interaction_and_keyword_name(keyword, interaction)
                interaction.exec = self._get_interaction_exec_from_keyword(keyword)
                continue
            if sequence_phase == SequencePhase.Setup and not self._test_setup_passed:
                interaction.exec.verdict = InteractionVerdict.Skipped
                continue
            interaction.exec.verdict = InteractionVerdict.Undefined

    def _filter_atomic_interactions_by_sequence_phase(
        self, atomic_interactions: List[InteractionDetails], sequence_phase: SequencePhase
    ):
        return list(
            filter(
                lambda atomic_interaction: atomic_interaction.spec.sequencePhase == sequence_phase,
                atomic_interactions,
            )
        )

    def _get_interaction_exec_from_keyword(self, keyword: Keyword) -> InteractionExecutionSummary:
        return InteractionExecutionSummary.from_dict(
            {
                'verdict': self._get_interaction_result(keyword.status),
                'time': keyword.endtime,
                'duration': keyword.elapsedtime,
                'comments': self.get_html_keyword_comment(keyword),
            }
        )

    def _check_matching_interaction_and_keyword_name(
        self, keyword: Keyword, interaction: InteractionDetails
    ) -> None:
        if not is_normalized_equal(keyword.kwname, interaction.name) and not is_normalized_equal(
            keyword.kwname.split('.')[-1], interaction.name
        ):
            raise NameError(
                f"Execution can not be parsed, "
                f"because keyword name '{keyword.kwname}' does not match with "
                f"interaction '{interaction.name}' name."
            )

    def _get_keyword_messages(self, keyword: Keyword):
        if hasattr(keyword, "messages"):
            for message in keyword.messages:
                yield self._create_itb_exec_comment(message)
        if hasattr(keyword, "body"):
            for kw in keyword.body:
                yield from self._get_keyword_messages(kw)

    def get_html_keyword_comment(self, keyword: Keyword):
        messages = list(self._get_keyword_messages(keyword))
        return (
            "<html>"
            "<body>"
            "<style>"
            "td {padding: 5px; border: none;} "
            "table {font-family: monospace; border: none;}"
            "</style>"
            "<pre>"
            f"Start Time:   {self.get_isotime_from_robot_timestamp(keyword.starttime)}\n"
            f"End Time:     {self.get_isotime_from_robot_timestamp(keyword.endtime)}\n"
            f"Elapsed Time: {timedelta(milliseconds=keyword.elapsedtime)!s}\n"
            "</pre>"
            "<table>"
            "<tr>"
            f"{'</tr><tr>'.join(messages)}"
            "</tr>"
            "</table>"
            "</body>"
            "</html>"
        )

    def _create_itb_exec_comment(
        self,
        message,
    ) -> str:  # Todo: low prio: pattern für message in config festlegen
        message_time = self.get_isotime_from_robot_timestamp(
            message.timestamp, time_format="%H:%M:%S.%f"
        )
        msg = message.html_message.replace("<hr>", "<br/>").replace("<br>", "<br/>").strip()
        return (
            f"<td {self.render_status(message.level)}><b>{message.level}</b></td>"
            f"<td><pre>{msg}</pre></td><td>{message_time}</td>"
        )

    @staticmethod
    def get_isotime_from_robot_timestamp(timestamp, time_format="%Y-%m-%d %H:%M:%S.%f"):
        try:
            return timestamp.astimezone().strftime(time_format)[:-3]
        except AttributeError:
            return (
                datetime.strptime(timestamp, "%Y%m%d %H:%M:%S.%f")
                .astimezone()
                .strftime(time_format)[:-3]
            )

    def _set_compound_interaction_execution_result(self, compound_interaction: InteractionDetails):
        atomic_interactions = list(
            self._get_interactions_by_type(
                compound_interaction.interactions, InteractionType.Atomic
            )
        )
        if compound_interaction.exec is None:
            compound_interaction.exec = InteractionExecutionSummary.from_dict({})
        compound_interaction.exec.verdict = InteractionVerdict.Skipped
        for atomic in atomic_interactions:
            if atomic.exec is None:
                logger.debug(
                    f"Atomic interaction {atomic.uniqueID} "
                    f"had no exec details and therefore ignored."
                )
                atomic.exec = InteractionExecutionSummary.from_dict({})
            if atomic.exec.verdict is InteractionVerdict.Fail:
                compound_interaction.exec.verdict = InteractionVerdict.Fail
                break
            if atomic.exec.verdict is InteractionVerdict.Pass:
                compound_interaction.exec.verdict = InteractionVerdict.Pass

        compound_interaction.exec.duration = sum(
            [interaction.exec.duration for interaction in atomic_interactions]
        )
        compound_interaction.exec.time = atomic_interactions[-1].exec.time

    @staticmethod
    def _set_itb_test_case_status(
        itb_test_case: TestCaseDetails, robot_status: str
    ) -> ProtocolTestCaseResult:
        robot_status = robot_status.lower()
        if robot_status == "pass":
            itb_test_case.exec.status = ActivityStatus.Performed
            itb_test_case.exec.verdict = VerdictStatus.Pass
            return ProtocolTestCaseResult(
                None, ActivityStatus.Performed, VerdictStatus.Pass, ExecStatus.NotBlocked
            )
        if robot_status == "fail":
            itb_test_case.exec.status = ActivityStatus.Performed
            itb_test_case.exec.verdict = VerdictStatus.Fail
            return ProtocolTestCaseResult(
                None, ActivityStatus.Performed, VerdictStatus.Fail, ExecStatus.NotBlocked
            )
        itb_test_case.exec.status = ActivityStatus.Running
        itb_test_case.exec.verdict = VerdictStatus.Undefined
        return ProtocolTestCaseResult(
            None, ActivityStatus.Running, VerdictStatus.Undefined, ExecStatus.NotBlocked
        )

    def end_suite(self, suite: TestSuite):
        if not suite.metadata.get("uniqueID") or len(suite.suites):
            return
        test_case_set = self.json_reader.read_test_case_set(suite.metadata["uniqueID"])
        if not test_case_set:
            return
        test_case_set.exec.verdict = suite.status

        for testcase in test_case_set.testCases:
            current_itb_test_case = self.itb_test_case_catalog.get(testcase.uniqueID)
            if current_itb_test_case is None:
                continue
            testcase.exec.verdict = current_itb_test_case.exec.verdict
            testcase.exec.status = current_itb_test_case.exec.status
            testcase.exec.execStatus = current_itb_test_case.exec.execStatus
            testcase.exec.comments = current_itb_test_case.exec.comments
        suite_start_time = "99999999 00:00:00.000"
        suite_end_time = "00000000 00:00:00.000"
        table_content = []
        for test in suite.tests:
            suite_start_time = min(suite_start_time, test.starttime)
            suite_end_time = max(suite_end_time, test.endtime)
            test_chain = get_test_chain(test.name, self.phase_pattern)

            if test_chain:
                name = test_chain.name if test_chain.index == 1 else ""
                phase = f"Phase {test_chain.index}/{test_chain.length}"
            else:
                name = test.name
                phase = ""
            if test.status != "PASS":
                message = re.sub(r"\s*itb-reference:\s*(\S*)", "", test.message)
                message = (
                    message[len("*HTML*") :]
                    .replace('<hr>', '<br />')
                    .replace('<br>', '<br />')
                    .strip()
                    if message.startswith("*HTML*")
                    else message
                )
            else:
                message = self.get_isotime_from_robot_timestamp(test.endtime)

            table_content.append(
                f"<td>{name}</td>"
                f"<td>{phase}</td>"
                f"<td {self.render_status(test.status)}><b>{test.status}</b></td>"
                f"<td><pre>{message}</pre></td>"
            )

        test_case_set.exec.comments = (
            "<html>"
            "<head>"
            "<style>"
            "td {padding: 5px; border: none; white-space: pre-wrap;} "
            "table {font-family: monospace; border: none;}"
            "</style>"
            "</head>"
            "<body>"
            "<pre>"
            f"Start Time:   {self.get_isotime_from_robot_timestamp(suite_start_time)}\n"
            f"End Time:     {self.get_isotime_from_robot_timestamp(suite_end_time)}\n"
            "</pre>"
            "<table>"
            "<tr>"
            f"{'</tr><tr>'.join(table_content)}"
            "</tr>"
            "</table>"
            "</body>"
            "</html>"
        )
        self.protocol_test_case_set = ProtocolTestCaseSetExecutionSummary(
            test_case_set.key,
            suite.elapsedtime,
            test_case_set.exec.key,
            self.protocol_test_cases,
            ProtocolComments(html=test_case_set.exec.comments),
        )
        self.main_protocol.protocolTestCaseSetExecutionSummary.append(self.protocol_test_case_set)
        write_test_structure_element(self.json_result, test_case_set)
        logger.debug(
            f"Successfully wrote the result from suite "
            f"{test_case_set.uniqueID} to TestBench's Json Report."
        )
        if self.listener_uid:
            self.write_listener_mode_protocols()

    def write_listener_mode_protocols(self):
        write_main_protocol(
                self.json_result, self.main_protocol.protocolTestCaseSetExecutionSummary
            )
        os.makedirs(Path(self.json_result_path)/self.listener_uid)
        shutil.copy(Path(self.json_result)/"protocol.json", Path(self.json_result_path)/self.listener_uid/"protocol.json")
        shutil.copy(Path(self.json_result)/"project.json", Path(self.json_result_path)/self.listener_uid/"project.json")
        for filename in os.listdir(self.json_result):
            logger.info(filename)
            if filename.startswith(self.listener_uid) and filename.endswith(".json"):
                shutil.copy(Path(self.json_result)/filename, Path(self.json_result_path)/self.listener_uid/filename)
        directory_to_zip(Path(self.json_result_path)/self.listener_uid)
        shutil.rmtree(Path(self.json_result_path)/self.listener_uid)


    @staticmethod
    def render_status(status):
        return (
            "style='"
            f"background-color: {BACKGROUND_COLOR.get(status, '#fff')}; "
            f"color: {COLOR.get(status, '#000')};'"
        )

    def end_result(self, result):
        tt_tree = self.json_reader.read_test_theme_tree()
        if tt_tree:
            test_suite_counter = 0
            for tse in [tt_tree.root, *tt_tree.nodes]:
                if self.test_suites.get(tse.base.uniqueID) is None:
                    continue
                execution_result = self._get_execution_result(
                    self.test_suites[tse.base.uniqueID].status
                )
                tse.exec.verdict = execution_result["execution_verdict"]
                tse.exec.status = execution_result["activity_status"]
                test_suite_counter += 1
            write_test_structure_element(self.json_result, tt_tree)
            write_main_protocol(
                self.json_result, self.main_protocol.protocolTestCaseSetExecutionSummary
            )
            if test_suite_counter and self.itb_test_case_catalog:
                logger.info(f"Successfully read {test_suite_counter} test suites.")
            else:
                logger.warning("No test suites with execution information found.")
            if self.create_zip:
                directory_to_zip(Path(self.json_result), self.json_result_path)
            elif self.json_result != self.json_result_path:
                # if not self.create_zip:
                copytree(self.json_dir, self.json_result_path, dirs_exist_ok=True)
                copytree(self.json_result, self.json_result_path, dirs_exist_ok=True)
            self.tempdir.cleanup()
        logger.info(f"Successfully wrote the robot execution results to TestBench's Json Report: '{Path(self.json_result_path).absolute()}{self.create_zip*'.zip'}'")

    @staticmethod
    def _get_execution_result(robot_status: str) -> Dict:
        robot_status = robot_status.lower()
        if robot_status == "pass":
            return {
                "execution_verdict": VerdictStatus.Pass,
                "activity_status": ActivityStatus.Performed,
            }
        if robot_status == "fail":
            return {
                "execution_verdict": VerdictStatus.Fail,
                "activity_status": ActivityStatus.Performed,
            }
        return {
            "execution_verdict": VerdictStatus.Undefined,
            "activity_status": ActivityStatus.Skipped,
        }

    @staticmethod
    def _get_interaction_result(robot_status: str) -> InteractionVerdict:
        robot_status = robot_status.upper()
        if robot_status == "PASS":
            return InteractionVerdict.Pass
        if robot_status == "FAIL":
            return InteractionVerdict.Fail
        if robot_status == "NOT RUN":
            return InteractionVerdict.Skipped
        return InteractionVerdict.Skipped


class TestChain:
    def __init__(self, name, index, length):
        self.name = str(name)
        self.index = int(index)
        self.length = int(length)


def get_test_chain(test_name: str, phase_pattern: str) -> Optional[TestChain]:
    matcher = re.match(get_test_chain_pattern(phase_pattern), test_name)
    if matcher:
        return TestChain(*matcher.groups())
    return None


def get_test_chain_pattern(phase_pattern: str) -> str:
    testcase_placeholder = str(uuid.uuid4().int)
    index_placeholder = str(uuid.uuid4().int)
    length_placeholder = str(uuid.uuid4().int)
    raw_pattern = re.escape(
        phase_pattern.format(
            testcase=testcase_placeholder,
            index=index_placeholder,
            length=length_placeholder,
        )
    )
    return (
        raw_pattern.replace(testcase_placeholder, r"(.+?)")
        .replace(index_placeholder, r"(\d)")
        .replace(length_placeholder, r"(\d)")
    )


def get_normalized_keyword_name(keyword_name: str) -> str:
    return re.sub(r"[\s_]", "", keyword_name.lower())


def is_normalized_equal(kw_one: str, kw_two: str) -> bool:
    norm_kw_one = get_normalized_keyword_name(kw_one)
    norm_kw_two = get_normalized_keyword_name(kw_two)
    return norm_kw_one == norm_kw_two
