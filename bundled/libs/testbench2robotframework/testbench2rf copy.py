from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePath
from typing import Union
from uuid import uuid4

from robot.parsing.lexer.tokens import Token
from robot.parsing.model.blocks import (
    File,
    Keyword,
    KeywordSection,
    SettingSection,
    TestCase,
    TestCaseSection,
)
from robot.parsing.model.statements import (
    Comment,
    EmptyLine,
    KeywordCall,
    LibraryImport,
    Metadata,
    ResourceImport,
    SectionHeader,
    Setup,
    Statement,
    Tags,
    Teardown,
    TestCaseName,
    VariablesImport,
)

try:
    from robot.parsing.model.statements import TestTags
except ImportError:
    from robot.parsing.model.statements import ForceTags as TestTags

from .config import Configuration
from .json_reader import TestCaseSet
from .log import logger
from .model import (
    InteractionDetails,
    InteractionType,
    ParameterUseType,
    SequencePhase,
    TestCaseDetails,
    TestStructureTreeNode,
    UdfType,
    UserDefinedField,
)
from .utils import PathResolver

SEPARATOR = "    "
ROBOT_PATH_SEPARATOR = "/"
RELATIVE_RESOURCE_INDICATOR = r"^{root}"
SECTION_SEPARATOR = [EmptyLine.from_params()] * 2
LINE_SEPARATOR = [EmptyLine.from_params()]
UNKNOWN_IMPORT_TYPE = str(uuid4())
LIBRARY_IMPORT_TYPE = str(uuid4())
RESOURCE_IMPORT_TYPE = str(uuid4())


@dataclass
class InteractionCall:
    name: str


@dataclass
class AtomicInteractionCall(InteractionCall):
    cbv_parameters: dict[str, str]
    cbr_parameters: dict[str, str]
    indent: int
    import_prefix: str
    sequence_phase: str


@dataclass
class CompoundInteractionCall(InteractionCall):
    cbv_parameters: dict[str, str]
    cbr_parameters: dict[str, str]
    indent: int
    sequence_phase: str


class RfTestCase:
    def __init__(self, test_case_details: TestCaseDetails, config: Configuration) -> None:
        self.uid: str = test_case_details.uniqueID
        self.interaction_calls: list[InteractionCall] = []
        self.used_imports: dict[str, set[str]] = {}
        self.config = config
        self.lib_pattern_list = [re.compile(pattern) for pattern in config.rfLibraryRegex]
        self.res_pattern_list = [re.compile(pattern) for pattern in config.rfResourceRegex]
        for interaction in test_case_details.interactions:
            self._get_interaction_calls(interaction)
        self.rf_tags = self._get_tags(test_case_details)
        self.setup_keyword: Keyword = None
        self.teardown_keyword: Keyword = None
        # TODO description

    @staticmethod
    def _get_tags(test_case_details: TestCaseDetails) -> list[str]:
        tags = [keyword.name for keyword in test_case_details.spec.keywords]
        tags.extend([udf.robot_tag for udf in test_case_details.spec.udfs if udf.robot_tag])
        return tags

    @staticmethod
    def _get_udf_tags(user_defined_fields: list[UserDefinedField]) -> list[str]:
        udfs = []
        for udf in user_defined_fields:
            if udf.valueType in [UdfType.Enumeration, UdfType.String] and udf.value:
                udfs.append(f"{udf.name}:{udf.value}")
            elif udf.valueType == UdfType.Boolean and udf.value.lower() == "true":
                udfs.append(udf.name)
        return udfs

    def _get_interaction_calls(self, interaction: InteractionDetails, indent: int = 0) -> None:
        indent += 1
        if interaction.interactionType != InteractionType.Textuell:
            cbv_params = self._get_params_by_use_type(interaction, ParameterUseType.CallByValue)
            cbr_params = self._get_params_by_use_type(
                interaction,
                ParameterUseType.CallByReference,
                ParameterUseType.CallByReferenceMandatory,
            )
            if interaction.interactionType == InteractionType.Compound:
                self._append_compound_ia_and_analyze_children(
                    cbr_params, cbv_params, indent, interaction
                )
            elif interaction.interactionType == InteractionType.Atomic:
                self._append_atomic_ia(
                    cbr_params, cbv_params, indent, interaction
                )  # TODO: Else für textuelle Interaktionen

    def _append_atomic_ia(
        self,
        cbr_params: dict[str, str],
        cbv_params: dict[str, str],
        indent: int,
        interaction: InteractionDetails,
    ):
        resource_type, import_prefix = self._get_keyword_import(interaction)

        if resource_type not in self.used_imports:
            self.used_imports[resource_type] = {import_prefix}
        else:
            self.used_imports[resource_type].add(import_prefix)
        self.interaction_calls.append(
            AtomicInteractionCall(
                name=interaction.name,
                cbv_parameters=cbv_params,
                cbr_parameters=cbr_params,
                indent=indent,
                import_prefix=import_prefix,
                sequence_phase=interaction.spec.sequencePhase,
            )
        )

    def _get_keyword_import(self, interaction) -> tuple[str, str]:
        for pattern in self.lib_pattern_list:
            match = pattern.search(interaction.path)
            if match:
                return LIBRARY_IMPORT_TYPE, match[1].strip()
        for pattern in self.res_pattern_list:
            match = pattern.search(interaction.path)
            if match:
                return RESOURCE_IMPORT_TYPE, match[1].strip()

        ia_path_parts = interaction.path.split(".")
        if len(ia_path_parts) == 1:
            return UNKNOWN_IMPORT_TYPE, ia_path_parts[0]
        root_subdivision, import_prefix = ia_path_parts[:2]
        if root_subdivision in self.config.rfLibraryRoots:
            return LIBRARY_IMPORT_TYPE, import_prefix
        if root_subdivision in self.config.rfResourceRoots:
            return RESOURCE_IMPORT_TYPE, import_prefix

        return root_subdivision, import_prefix

    def _append_compound_ia_and_analyze_children(
        self,
        cbr_params: dict[str, str],
        cbv_params: dict[str, str],
        indent: int,
        interaction_detail: InteractionDetails,
    ):
        self.interaction_calls.append(
            CompoundInteractionCall(
                interaction_detail.name,
                cbv_parameters=cbv_params,
                cbr_parameters=cbr_params,
                indent=indent,
                sequence_phase=interaction_detail.spec.sequencePhase,
            )
        )
        for interaction in interaction_detail.interactions:
            self._get_interaction_calls(interaction, indent)

    def _create_rf_keyword_calls(
        self, interaction_calls: list[InteractionCall]
    ) -> list[list[Statement]]:
        keyword_lists: list[list[Statement]] = [[]]
        tc_index = 0
        is_first_atomic = True
        for interaction_call in interaction_calls:
            if isinstance(interaction_call, AtomicInteractionCall):
                if (
                    self.is_splitting_ia(interaction_call, keyword_lists, tc_index)
                    and not is_first_atomic
                ):
                    tc_index += 1
                    keyword_lists.append([])
                is_first_atomic = False
                keyword_lists[tc_index].append(self._create_rf_keyword(interaction_call))
            elif (
                isinstance(interaction_call, CompoundInteractionCall)
                and self.config.logCompoundInteractions
            ):
                keyword_lists[tc_index].append(self._create_rf_compound_keyword(interaction_call))
        return keyword_lists

    def is_splitting_ia(self, interaction_call, keyword_lists, tc_index):
        return (
            re.search(
                self.config.testCaseSplitPathRegEx,
                f"{interaction_call.import_prefix}.{interaction_call.name}",
            )
            and keyword_lists[tc_index]
            and self.config.testCaseSplitPathRegEx
        )

    def _create_rf_setup_call(
        self, setup_interaction: Union[AtomicInteractionCall, CompoundInteractionCall]
    ) -> Setup:
        cbr_parameters = self._create_cbr_parameters(setup_interaction)
        if cbr_parameters:
            logger.error("No variable assignment in [setup] possible.")
        import_prefix = self._get_interaction_import_prefix(setup_interaction)
        interaction_indent = self._get_interaction_indent(setup_interaction)
        cbv_parameters = self._create_cbv_parameters(setup_interaction)
        return Setup.from_params(
            name=f"{import_prefix}{setup_interaction.name}",
            args=tuple(cbv_parameters),
            indent=interaction_indent,
        )

    def _create_rf_keyword_from_interaction_list(
        self, keyword_name: str, interactions: list[InteractionCall]
    ):
        keyword_calls_lists = self._create_rf_keyword_calls(interactions)
        keyword = Keyword(header=TestCaseName.from_params(keyword_name))
        keyword.body.extend(keyword_calls_lists[0])
        keyword.body.extend(LINE_SEPARATOR)
        return keyword

    def _create_rf_setup(self, setup_interactions: list[InteractionCall]) -> Union[Setup, None]:
        rf_setup = None
        if len(setup_interactions) == 1:
            rf_setup = self._create_rf_setup_call(setup_interactions[0])
        elif len(setup_interactions) > 1:
            self.setup_keyword = self._create_rf_keyword_from_interaction_list(
                f"Setup-{self.uid}", setup_interactions
            )
            rf_setup = Setup.from_params(name=self.setup_keyword.name)
        return rf_setup

    def _get_teardown_params(self, interaction_calls: list[InteractionCall]):
        if len(interaction_calls) == 1:
            interaction = interaction_calls[0]
            return {
                "name": f"{self._get_interaction_import_prefix(interaction)}{interaction.name}",
                "args": tuple(self._create_cbv_parameters(interaction)),
                "indent": self._get_interaction_indent(interaction),
            }
        return {"name": f"Teardown-{self.uid}"}

    def _create_rf_teardown(
        self, teardown_interactions: list[InteractionCall]
    ) -> Union[Setup, None]:
        rf_teardown = None
        if teardown_interactions:
            teardown_params = self._get_teardown_params(teardown_interactions)
            rf_teardown = Teardown.from_params(**teardown_params)
            if len(teardown_interactions) > 1:
                self.teardown_keyword = self._create_rf_keyword_from_interaction_list(
                    f"Teardown-{self.uid}", teardown_interactions
                )
        return rf_teardown

    def to_robot_ast_test_cases(
        self,
    ) -> list[
        TestCase
    ]:  # TODO: Separate testcase splitting from this method --> new method: to_robot_ast_test_case
        setup_interactions = list(
            filter(
                lambda interaction: interaction.sequence_phase == SequencePhase.Setup,
                self.interaction_calls,
            )
        )
        rf_setup = self._create_rf_setup(setup_interactions)
        test_step_interactions = list(
            filter(
                lambda interaction: interaction.sequence_phase == SequencePhase.TestStep,
                self.interaction_calls,
            )
        )
        rf_keyword_call_lists = self._create_rf_keyword_calls(test_step_interactions)
        teardown_interactions = list(
            filter(
                lambda interaction: interaction.sequence_phase == SequencePhase.Teardown,
                self.interaction_calls,
            )
        )
        rf_teardown = self._create_rf_teardown(teardown_interactions)
        rf_test_cases: list[TestCase] = []
        multiple_tests = len(rf_keyword_call_lists) > 1
        for index, rf_keywords in enumerate(rf_keyword_call_lists):
            phase_pattern = self.config.phasePattern
            tc_name = (
                phase_pattern.format(
                    testcase=self.uid, index=index + 1, length=len(rf_keyword_call_lists)
                )
                if multiple_tests
                else self.uid
            )
            # suffix = f' : Phase {index + 1}/{len(rf_keyword_lists)}' if multiple_tests else ''
            # tc_name = f"{self.uid}{suffix}"  # TODO later UID or Comments
            rf_test_case = TestCase(header=TestCaseName.from_params(tc_name))
            if self.rf_tags:
                rf_test_case.body.append(Tags.from_params(self.rf_tags))
            if index == 0 and rf_setup:
                rf_test_case.body.append(rf_setup)
            rf_test_case.body.extend(rf_keywords)
            if index == len(rf_keyword_call_lists) - 1 and rf_teardown:
                rf_test_case.body.append(rf_teardown)
            if index != len(rf_keyword_call_lists) - 1:
                rf_test_case.body.extend(LINE_SEPARATOR)
            rf_test_cases.append(rf_test_case)
        return rf_test_cases

    @staticmethod
    def _create_cbv_parameters(interaction: AtomicInteractionCall) -> list[str]:
        parameters = []
        previous_arg_forces_named = False
        for name, value in interaction.cbv_parameters.items():
            if value == "undef.":
                previous_arg_forces_named = True
                continue
            if re.match(r'^\*\*\ ?', name):
                escaped_value = RfTestCase.escape_argument_value(value, False, False)
                parameters.append(escaped_value)
            elif re.match(r'^\*\ ?', name):
                escaped_value = RfTestCase.escape_argument_value(value, False)
                parameters.append(escaped_value)
                previous_arg_forces_named = True
            elif re.search(r'(^-\ ?|=$)', name) or previous_arg_forces_named:
                escaped_value = RfTestCase.escape_argument_value(value, equal_sign_escaping=False)
                pure_name = re.sub(r'(^-\ ?|=$)', "", name)
                parameters.append(f"{pure_name}={escaped_value}")
                previous_arg_forces_named = True
            elif value.find("=") != -1 and value[: value.find("=")] in interaction.cbv_parameters:
                escaped_value = RfTestCase.escape_argument_value(value)
                parameters.append(escaped_value)
            else:
                escaped_value = RfTestCase.escape_argument_value(value, True, False)
                parameters.append(escaped_value)
        return parameters

    @staticmethod
    def escape_argument_value(value: str, space_escaping=True, equal_sign_escaping=True) -> str:
        if space_escaping:
            value = re.sub(r'^(?= )|(?<= )$|(?<= )(?= )', r'\\', value)
        if equal_sign_escaping:
            value = re.sub(r'(?<!\\)=', r'\=', value)
        return re.sub(r'^#', r'\#', value)

    @staticmethod
    def _create_cbr_parameters(interaction: AtomicInteractionCall) -> list[str]:
        cbr_parameters = list(
            filter(lambda parameter: parameter != "", interaction.cbr_parameters.values())
        )
        for index, parameter in enumerate(cbr_parameters):
            if not parameter.startswith('${'):
                cbr_parameters[index] = f"${{{parameter}}}"
        return cbr_parameters

    def _get_interaction_import_prefix(self, interaction: AtomicInteractionCall) -> str:
        return (self.config.fullyQualified or False) * f"{interaction.import_prefix}."

    def _get_interaction_indent(
        self, interaction: Union[AtomicInteractionCall, CompoundInteractionCall]
    ) -> str:
        return SEPARATOR * interaction.indent if self.config.logCompoundInteractions else SEPARATOR

    def _create_rf_keyword(self, interaction: AtomicInteractionCall) -> KeywordCall:
        import_prefix = self._get_interaction_import_prefix(interaction)
        interaction_indent = self._get_interaction_indent(interaction)
        cbv_parameters = self._create_cbv_parameters(interaction)
        cbr_parameters = self._create_cbr_parameters(interaction)
        return KeywordCall.from_params(
            assign=tuple(cbr_parameters),
            name=f"{import_prefix}{interaction.name}",
            args=tuple(cbv_parameters),
            indent=interaction_indent,
        )

    def _create_rf_compound_keyword(self, interaction: CompoundInteractionCall) -> Comment:
        interaction_indent = " " * (interaction.indent * 4)
        return Comment.from_params(
            comment=self._generate_compound_interaction_comment(interaction),
            indent=interaction_indent,
        )  # TODO  prio later key=value als named erlauben config?

    @staticmethod
    def _generate_compound_interaction_comment(interaction: CompoundInteractionCall) -> str:
        cbr_params = SEPARATOR.join(
            [
                f"{param_name}={param_value}"
                for param_name, param_value in interaction.cbr_parameters.items()
            ]
        )
        cbv_params = SEPARATOR.join(
            [
                f"{param_name}={param_value}"
                for param_name, param_value in interaction.cbv_parameters.items()
            ]
        )
        cmd = []
        if cbr_params:
            cmd.append(cbr_params)
        cmd.append(interaction.name)
        if cbv_params:
            cmd.append(cbv_params)
        return f"# {SEPARATOR.join(cmd)}"

    @staticmethod
    def _get_params_by_use_type(
        interaction: InteractionDetails, *param_use_types: ParameterUseType
    ) -> dict[str, str]:
        return {
            parameter.name: parameter.value
            for parameter in interaction.parameters
            if parameter.parameterUseType in param_use_types
        }


def create_test_suites(
    test_case_set_catalog: dict[str, TestCaseSet],
    path_resolver: PathResolver,
    config: Configuration,
) -> dict[str, File]:
    tcs_paths = path_resolver.tcs_paths
    test_suites = {}
    for uid, test_case_set in test_case_set_catalog.items():
        test_suites[uid] = RobotSuiteFileBuilder(
            test_case_set, tcs_paths[uid], config
        ).create_test_suite_file()
    tt_paths = path_resolver.tt_paths
    for uid, test_theme in path_resolver.tt_catalog.items():
        test_suites[uid] = RobotInitFileBuilder(
            test_theme, tt_paths[uid], config
        ).create_init_file()
    return test_suites


class RobotInitFileBuilder:
    def __init__(
        self, test_theme: TestStructureTreeNode, tt_path: PurePath, config: Configuration
    ) -> None:
        self.test_theme = test_theme
        self.tt_path = PurePath(tt_path)
        self.config = config

    def create_init_file(self) -> File:
        sections = [self._create_setting_section()]
        return File(sections, source=str(self.tt_path / "__init__"))

    def _create_setting_section(self) -> SettingSection:
        setting_section = SettingSection(header=SectionHeader.from_params(Token.SETTING_HEADER))
        setting_section_meta_data = self._get_setting_section_metadata()
        setting_section.body.extend(
            [
                create_meta_data(metadata_name, metadata_value)
                for metadata_name, metadata_value in setting_section_meta_data.items()
            ]
        )
        return setting_section

    def _get_setting_section_metadata(self) -> dict[str, str]:
        meta_data = {
            "UniqueID": self.test_theme.baseInformation.uniqueID,
            "Numbering": self.test_theme.baseInformation.numbering,
        }
        if self.test_theme.specification:
            meta_data["Specification Status"] = self.test_theme.specification.status
        return meta_data


def create_meta_data(name, value):
    tokens = [
        Token(Metadata, 'Metadata', 1),
        Token(SEPARATOR, '    ', 2),
        Token('NAME', name, 3),
        Token(SEPARATOR, '    ', 4),
        Token('ARGUMENT', value, 5),
        Token('EOL', '\n', 6),
    ]
    return Metadata(tokens)


class RobotSuiteFileBuilder:
    def __init__(
        self, test_case_set: TestCaseSet, tcs_path: PurePath, config: Configuration
    ) -> None:
        self.test_case_set = test_case_set
        self.tcs_path = tcs_path
        self.config = config
        self._rf_test_cases: list[RfTestCase] = [
            RfTestCase(test_case_details=test_case, config=config)
            for test_case in self.test_case_set.test_cases.values()
        ]
        self.setup_keywords: list[Keyword] = []
        self.teardown_keywords: list[Keyword] = []

    def create_test_suite_file(self) -> File:
        sections = [self._create_setting_section(), self._create_test_case_section()]
        keyword_section = self._create_keywords_section()
        if keyword_section:
            sections[-1].body.extend(SECTION_SEPARATOR)
            sections.append(keyword_section)
        return File(sections, source=str(self.tcs_path))

    def _create_test_case_section(self) -> TestCaseSection:
        test_case_section = TestCaseSection(header=SectionHeader.from_params(Token.TESTCASE_HEADER))
        robot_ast_test_cases = []
        for index, test_case in enumerate(self._rf_test_cases):
            robot_ast_test_cases.extend(test_case.to_robot_ast_test_cases())
            if index != len(self._rf_test_cases) - 1:
                robot_ast_test_cases[-1].body.extend(LINE_SEPARATOR)
            if test_case.setup_keyword:
                self.setup_keywords.append(test_case.setup_keyword)
            if test_case.teardown_keyword:
                self.teardown_keywords.append(test_case.teardown_keyword)
        test_case_section.body.extend(robot_ast_test_cases)
        return test_case_section

    def _create_keywords_section(self) -> Union[KeywordSection, None]:
        if not self.setup_keywords and not self.teardown_keywords:
            return None
        keywords_section = KeywordSection(header=SectionHeader.from_params(Token.KEYWORD_HEADER))
        keywords_section.body.extend(self.setup_keywords)
        keywords_section.body.extend(self.teardown_keywords)
        return keywords_section

    def _get_used_subdivisions(self) -> dict[str, set[str]]:
        import_dict: dict[str, set[str]] = {}
        for test_case in self._rf_test_cases:
            for root, import_names in test_case.used_imports.items():
                if root not in import_dict:
                    import_dict[root] = import_names
                else:
                    import_dict[root].update(import_names)
        return import_dict

    def _create_rf_variable_imports(self) -> list[VariablesImport]:
        return [
            VariablesImport.from_params(name=variable_file)
            for variable_file in self.config.forcedImport.variables
        ]

    def _create_rf_resource_imports(self, import_dict: dict[str, set[str]]) -> list[ResourceImport]:
        resources = {
            str(resource)
            for resource_root, resources in import_dict.items()
            for resource in resources
            if not self._is_library(resource_root) and self._is_resource(resource_root)
        }
        resources.update(self.config.forcedImport.resources)
        resource_paths = {
            self._create_resource_path(resource) for resource in sorted(resources)
        }  # TODO Fix Paths to correct models
        return [ResourceImport.from_params(res) for res in sorted(resource_paths)]

    def _create_resource_path(self, resource: str) -> str:
        subdivision_mapping = self.config.subdivisionsMapping.resources.get(resource)
        resource = re.sub(".resource", "", resource)
        if not subdivision_mapping:
            if not self.config.resourceDirectory:
                return f"{resource}.resource"
            if not re.match(RELATIVE_RESOURCE_INDICATOR, self.config.resourceDirectory):
                return Path(self.config.resourceDirectory, f"{resource}.resource").as_posix()
            generation_directory = self._replace_relative_resource_indicator(
                self.config.generationDirectory
            )
            robot_file_path = Path(generation_directory) / self.tcs_path.parent
            resource_directory = self._replace_relative_resource_indicator(
                self.config.resourceDirectory
            )
            resource_import = (
                Path(os.path.relpath(Path(resource_directory), robot_file_path))
                / f"{resource}.resource"
            )
            return resource_import.as_posix()
        root_path = Path(os.curdir).absolute()
        subdivision_mapping = re.sub(
            r"^{resourceDirectory}", self.config.resourceDirectory, subdivision_mapping
        )
        subdivision_mapping = re.sub(
            RELATIVE_RESOURCE_INDICATOR, str(root_path).replace('\\', '/'), subdivision_mapping
        )
        return str(subdivision_mapping)

    def _replace_relative_resource_indicator(self, path: Union[Path, str]) -> str:
        root_path = Path(os.curdir).absolute()
        return re.sub(
            RELATIVE_RESOURCE_INDICATOR,
            str(root_path).replace('\\', ROBOT_PATH_SEPARATOR),
            str(path),
            flags=re.IGNORECASE,
        ).replace('\\', ROBOT_PATH_SEPARATOR)

    def _get_relative_resource_directory(self) -> str:
        root_path = Path(os.curdir).absolute()
        return re.sub(
            RELATIVE_RESOURCE_INDICATOR,
            str(root_path).replace('\\', ROBOT_PATH_SEPARATOR),
            self.config.resourceDirectory,
            flags=re.IGNORECASE,
        ).replace('\\', ROBOT_PATH_SEPARATOR)

    @staticmethod
    def _is_library(root_subdivision: str) -> bool:
        return root_subdivision == LIBRARY_IMPORT_TYPE

    @staticmethod
    def _is_resource(root_subdivision: str) -> bool:
        return root_subdivision == RESOURCE_IMPORT_TYPE

    def _create_rf_library_imports(self, import_dict: dict[str, set[str]]) -> list[LibraryImport]:
        libraries = {
            str(library)
            for library_root, libraries in import_dict.items()
            for library in libraries
            if self._is_library(library_root)
        }
        libraries.update(self.config.forcedImport.libraries)
        lib_imports = {
            self.config.subdivisionsMapping.libraries.get(library, library) for library in libraries
        }
        return [LibraryImport.from_params(lib) for lib in sorted(lib_imports)]

    def _create_rf_test_tags(self) -> Union[TestTags, None]:
        tb_keyword_names = [keyword.name for keyword in self.test_case_set.details.spec.keywords]
        udfs = [udf.robot_tag for udf in self.test_case_set.details.spec.udfs if udf.robot_tag]
        test_tags = tb_keyword_names + udfs
        if test_tags:
            return TestTags.from_params(test_tags)
        return None

    def _create_rf_unknown_imports(self, import_dict: dict[str, set[str]]) -> list[Comment]:
        unknown_imports = {
            str(unknown_import)
            for root_subdivision, unknown_imports in import_dict.items()
            for unknown_import in unknown_imports
            if not self._is_library(root_subdivision) and not self._is_resource(root_subdivision)
        }
        for root, subdivision_names in import_dict.items():
            logger.debug(
                f"{self.test_case_set.details.uniqueID} has imports {list(subdivision_names)} "
                f"from unknown root subdivision '{root}'!"
            )
        if unknown_imports:
            logger.warning(
                f"{self.test_case_set.details.uniqueID} has unknown imports. "
                f"TestBench Subdivisions which correspond to Libraries or Resources "
                f"need to be declared in the configuration file. "
                f"See Log for more details."
            )
        return [
            Comment.from_params(comment=f"# UNKNOWN    {unknown}", indent="")
            for unknown in unknown_imports
        ]

    def _create_setting_section(self) -> SettingSection:
        subdivisions = self._get_used_subdivisions()
        setting_section = SettingSection(header=SectionHeader.from_params(Token.SETTING_HEADER))
        setting_section.body.extend(self._create_rf_variable_imports())
        setting_section.body.extend(self._create_rf_library_imports(subdivisions))
        setting_section.body.extend(self._create_rf_resource_imports(subdivisions))
        setting_section.body.extend(self._create_rf_unknown_imports(subdivisions))
        setting_section_meta_data = self.test_case_set.metadata
        setting_section.body.extend(
            [
                create_meta_data(metadata_name, metadata_value)
                for metadata_name, metadata_value in setting_section_meta_data.items()
            ]
        )
        setting_section.body.append(self._create_rf_test_tags())
        setting_section.body.extend(SECTION_SEPARATOR)
        return setting_section
