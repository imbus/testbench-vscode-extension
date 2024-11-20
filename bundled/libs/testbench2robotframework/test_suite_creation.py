import os
import re
from pathlib import Path, PurePath
from typing import Dict, List, Set, Union
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
    Tags,
    Teardown,
    TestCaseName,
    VariablesImport,
)

from testbench2robotframework.config import Configuration
from testbench2robotframework.model import (
    InteractionDetails,
    ParameterUseType,
    SequencePhase,
    TestCaseSetDetails,
    TestStructureTreeNode,
)
from testbench2robotframework.test_theme_tree import (
    AtomicInteractionNode,
    CompoundInteractionNode,
    TestCaseNode,
    TestCaseSetNode,
    TestThemeNode,
    TestThemeTreeVisitor,
)

try:
    from robot.parsing.model.statements import TestTags
except ImportError:
    from robot.parsing.model.statements import ForceTags as TestTags

UNKNOWN_IMPORT_TYPE = str(uuid4())
LIBRARY_IMPORT_TYPE = str(uuid4())
RESOURCE_IMPORT_TYPE = str(uuid4())
SEPARATOR = "    "
SECTION_SEPARATOR = [EmptyLine.from_params()] * 2
LINE_SEPARATOR = [EmptyLine.from_params()]
CWD_INDICATOR = r"^{root}"


class TestSuiteCreationVisitor(TestThemeTreeVisitor):
    def __init__(self, config: Configuration) -> None:
        super().__init__()
        self.test_suites = {}
        self.config = config
        self.lib_pattern_list = [re.compile(pattern) for pattern in config.rfLibraryRegex]
        self.res_pattern_list = [re.compile(pattern) for pattern in config.rfResourceRegex]

    def visit_test_theme(self, test_theme: TestThemeNode):
        self.test_suites[test_theme.value.baseInformation.uniqueID] = RobotInitFileBuilder(
            test_theme.value, test_theme.path
        ).create_file()

    def start_test_case_set(self, test_case_set: TestCaseSetNode):
        self.imports: Dict[str, Set[str]] = {}
        self.keywords = []
        self.tcs_path = Path(test_case_set.path)
        self.test_case_count = len(test_case_set.value.testCases)
        self.current_test_index = 0
        self.setting_section = SettingSection(
            header=SectionHeader.from_params(Token.SETTING_HEADER)
        )
        self.test_cases_section = TestCaseSection(
            header=SectionHeader.from_params(Token.TESTCASE_HEADER)
        )

    def end_test_case_set(self, test_case_set: TestCaseSetNode):
        for library in sorted(self.imports.get(LIBRARY_IMPORT_TYPE, [])):
            self.setting_section.body.append(LibraryImport.from_params(library))
        forced_libraries = [
            LibraryImport.from_params(name=library)
            for library in self.config.forcedImport.libraries
        ]
        self.setting_section.body.extend(forced_libraries)
        for resource in sorted(self.imports.get(RESOURCE_IMPORT_TYPE, [])):
            self.setting_section.body.append(
                ResourceImport.from_params(self._create_resource_path(resource))
            )
        forced_resources = [
            ResourceImport.from_params(name=resource)
            for resource in self.config.forcedImport.resources
        ]
        self.setting_section.body.extend(forced_resources)
        if self.config.forcedImport.variables:
            forced_variables = [
                VariablesImport.from_params(name=variable_file)
                for variable_file in self.config.forcedImport.variables
            ]
            self.setting_section.body.extend(forced_variables)
        for unknown in sorted(self.imports.get(UNKNOWN_IMPORT_TYPE, [])):
            self.setting_section.body.append(
                Comment.from_params(comment=f"# UNKNOWN    {unknown}", indent="")
            )
        self.setting_section.body.append(self._create_test_tags(test_case_set.value))
        self.setting_section.body.extend(
            [
                create_meta_data("UniqueID", test_case_set.value.uniqueID),
                create_meta_data("Name", test_case_set.value.name),
                create_meta_data("Numbering", test_case_set.value.numbering),
            ]
        )
        self.setting_section.body.extend(SECTION_SEPARATOR)
        sections = [self.setting_section, self.test_cases_section]
        if self.keywords:
            keyword_section = KeywordSection(header=SectionHeader.from_params(Token.KEYWORD_HEADER))
            for index, keyword in enumerate(self.keywords):
                if index > 0:
                    keyword_section.body.extend(LINE_SEPARATOR)
                keyword_section.body.append(keyword)
            sections[-1].body.extend(SECTION_SEPARATOR)
            sections.append(keyword_section)
        self.test_suites[test_case_set.value.uniqueID] = File(
            sections, source=str(test_case_set.path)
        )

    def start_test_case(self, test_case: TestCaseNode):
        self.test_case = TestCase(header=TestCaseName.from_params(test_case.value.uniqueID))
        self.setup_interactions = []
        self.flow_interactions = []
        self.teardown_interactions = []
        self.is_setup = False
        self.is_teardown = False
        tags = [keyword.name for keyword in test_case.value.spec.keywords]
        tags.extend([udf.robot_tag for udf in test_case.value.spec.udfs if udf.robot_tag])
        if tags:
            self.test_case.body.append(Tags.from_params(tags))
        self.current_test_index += 1

    def end_test_case(self, test_case: TestCaseNode):
        if len(self.setup_interactions) > 1:
            setup_name = f"Setup-{test_case.value.uniqueID}"
            kw = Keyword(header=TestCaseName.from_params(setup_name))
            for setup_interaction in self.setup_interactions:
                kw.body.append(self._interaction_2_keyword_call(setup_interaction))
            self.keywords.append(kw)
            self._add_setup_keyword_to_current_test(setup_name)
        else:
            for interaction in self.setup_interactions:
                self._add_setup_keyword_to_current_test(interaction)

        for flow_interaction in self.flow_interactions:
            self._add_keyword_to_current_test(flow_interaction)

        if len(self.teardown_interactions) > 1:
            teardown_name = f"Teardown-{test_case.value.uniqueID}"
            kw = Keyword(header=TestCaseName.from_params(teardown_name))
            for teardown_interaction in self.teardown_interactions:
                kw.body.append(self._interaction_2_keyword_call(teardown_interaction))
            self.keywords.append(kw)
            self._add_teardown_keyword_to_current_test(teardown_name)
        else:
            for interaction in self.teardown_interactions:
                self._add_teardown_keyword_to_current_test(interaction)

        self.test_cases_section.body.append(self.test_case)
        if self.current_test_index < self.test_case_count:
            self.test_cases_section.body.extend(LINE_SEPARATOR)

    def start_compound_interaction(self, interaction: CompoundInteractionNode):
        self.is_setup = bool(interaction.value.spec.sequencePhase == SequencePhase.Setup)
        self.is_teardown = bool(interaction.value.spec.sequencePhase == SequencePhase.Teardown)
        if not self.config.logCompoundInteractions:
            return
        if self.is_setup or interaction.value.spec.sequencePhase == SequencePhase.Setup:
            self.setup_interactions.append(interaction)
        elif self.is_teardown or interaction.value.spec.sequencePhase == SequencePhase.Teardown:
            self.teardown_interactions.append(interaction)
        else:
            self.flow_interactions.append(interaction)

    def end_compound_interaction(self, interaction: CompoundInteractionNode):
        pass

    def visit_atomic_interaction(self, interaction: AtomicInteractionNode):
        self._create_interaction_library_import(interaction.value)
        if self.is_setup or interaction.value.spec.sequencePhase == SequencePhase.Setup:
            self.setup_interactions.append(interaction)
        elif self.is_teardown or interaction.value.spec.sequencePhase == SequencePhase.Teardown:
            self.teardown_interactions.append(interaction)
        else:
            self.flow_interactions.append(interaction)

    def _add_keyword_to_current_test(self, interaction: AtomicInteractionNode):
        _, library_name = self.get_rf_import(interaction.value.path)
        call_prefix = (self.config.fullyQualified or False) * f"{library_name}."
        interaction_indent = (
            " " * (interaction.indent * 4) if self.config.logCompoundInteractions else SEPARATOR
        )
        self.test_case.body.append(
            KeywordCall.from_params(
                assign=tuple(
                    get_cbr_parameters(interaction.value),
                ),
                name=f"{call_prefix}{interaction.value.name}",
                args=tuple(get_cbv_parameters(interaction.value)),
                indent=interaction_indent,
            )
        )

    def _interaction_2_keyword_call(
        self, interaction: Union[AtomicInteractionNode, CompoundInteractionNode]
    ) -> KeywordCall:
        if isinstance(interaction, CompoundInteractionNode):
            interaction_indent = " " * (interaction.indent * 4)
            return Comment.from_params(
                comment=f"# {interaction.value.name}",
                indent=interaction_indent,
            )

        _, library_name = self.get_rf_import(interaction.value.path)
        call_prefix = (self.config.fullyQualified or False) * f"{library_name}."
        interaction_indent = (
            " " * (interaction.indent * 4) if self.config.logCompoundInteractions else SEPARATOR
        )
        return KeywordCall.from_params(
            assign=tuple(
                get_cbr_parameters(interaction.value),
            ),
            name=f"{call_prefix}{interaction.value.name}",
            args=tuple(get_cbv_parameters(interaction.value)),
            indent=interaction_indent,
        )

    def _add_setup_keyword_to_current_test(self, setup: Union[InteractionDetails, str]):
        setup_name = setup.value.name if isinstance(setup, AtomicInteractionNode) else setup
        setup_args = (
            get_cbv_parameters(setup.value) if isinstance(setup, AtomicInteractionNode) else []
        )
        self.test_case.body.append(
            Setup.from_params(
                name=setup_name,
                args=tuple(setup_args),
                indent=SEPARATOR,
            )
        )

    def _add_teardown_keyword_to_current_test(self, teardown: Union[InteractionDetails, str]):
        teardown_name = (
            teardown.value.name if isinstance(teardown, AtomicInteractionNode) else teardown
        )
        teardown_args = (
            get_cbv_parameters(teardown.value)
            if isinstance(teardown, AtomicInteractionNode)
            else []
        )
        self.test_case.body.append(
            Teardown.from_params(
                name=teardown_name,
                args=teardown_args,
                indent=SEPARATOR,
            )
        )

    def _create_resource_path(self, resource: str) -> str:
        subdivision_mapping = self.config.subdivisionsMapping.resources.get(resource)
        resource = re.sub(".resource", "", resource)
        if subdivision_mapping:
            subdivision_mapping = re.sub(
                r"^{resourceDirectory}", self.config.resourceDirectory, subdivision_mapping
            )
            if re.match(CWD_INDICATOR, subdivision_mapping):
                return self._get_relative_resource_import_path(
                    Path(self._replace_cwd_indicator(subdivision_mapping))
                )
            return subdivision_mapping
        if not self.config.resourceDirectory:
            return f"{resource}.resource"
        if re.match(CWD_INDICATOR, self.config.resourceDirectory):
            return self._get_relative_resource_import_path(
                Path(self._replace_cwd_indicator(self.config.resourceDirectory))
                / f"{resource}.resource"
            )
        return (Path(self.config.resourceDirectory) / f"{resource}.resource").as_posix()

    def _get_relative_resource_import_path(self, resource_import_path: Path) -> str:
        generation_directory = self._replace_cwd_indicator(self.config.generationDirectory)
        robot_file_path = Path(generation_directory) / self.tcs_path.parent
        resource_import = Path(os.path.relpath(resource_import_path, robot_file_path))
        return resource_import.as_posix()

    def _replace_cwd_indicator(self, path: str) -> str:
        root_path = Path(os.curdir).absolute()
        return re.sub(
            CWD_INDICATOR,
            root_path.as_posix(),
            path,
            flags=re.IGNORECASE,
        )

    def _create_interaction_library_import(self, interaction: InteractionDetails) -> str:
        import_type, import_name = self.get_rf_import(interaction.path)
        if self.imports.get(import_type):
            self.imports[import_type].add(import_name)
        else:
            self.imports[import_type] = {import_name}
        return import_name

    def get_rf_import(self, subdivison_path: str) -> str:
        for pattern in self.lib_pattern_list:
            match = pattern.search(subdivison_path)
            if match:
                return LIBRARY_IMPORT_TYPE, match[1].strip()
        for pattern in self.res_pattern_list:
            match = pattern.search(subdivison_path)
            if match:
                return RESOURCE_IMPORT_TYPE, match[1].strip()
        ia_path_parts = subdivison_path.split(".")
        if len(ia_path_parts) == 1:
            return UNKNOWN_IMPORT_TYPE, ia_path_parts[0]
        root_subdivision, library = ia_path_parts[:2]
        if root_subdivision in self.config.rfLibraryRoots:
            return LIBRARY_IMPORT_TYPE, library
        if root_subdivision in self.config.rfResourceRoots:
            return RESOURCE_IMPORT_TYPE, library
        return UNKNOWN_IMPORT_TYPE, library

    def _create_test_tags(self, test_case_set: TestCaseSetDetails) -> Union[TestTags, None]:
        tb_keyword_names = [keyword.name for keyword in test_case_set.spec.keywords]
        udfs = [udf.robot_tag for udf in test_case_set.spec.udfs if udf.robot_tag]
        test_tags = tb_keyword_names + udfs
        if test_tags:
            return TestTags.from_params(test_tags)
        return None


def get_cbr_parameters(interaction: InteractionDetails) -> List[str]:
    parameter = [
        param.value
        for param in interaction.parameters
        if param.parameterUseType
        in [ParameterUseType.CallByReference, ParameterUseType.CallByReferenceMandatory]
    ]
    for index, param in enumerate(parameter):
        if not param.startswith('${'):
            param[index] = f"${{{param}}}"
    return parameter


def get_cbv_parameters(interaction: InteractionDetails):
    cbv_params = {
        param.name: param.value
        for param in interaction.parameters
        if param.parameterUseType == ParameterUseType.CallByValue
    }
    parameter = []
    previous_arg_forces_named = False
    for name, value in cbv_params.items():
        if value == "undef.":
            previous_arg_forces_named = True
            continue
        if re.match(r'^\*\*\ ?', name):
            escaped_value = escape_argument_value(value, False, False)
            parameter.append(escaped_value)
        elif re.match(r'^\*\ ?', name):
            escaped_value = escape_argument_value(value, False)
            parameter.append(escaped_value)
            previous_arg_forces_named = True
        elif re.search(r'(^-\ ?|=$)', name) or previous_arg_forces_named:
            escaped_value = escape_argument_value(value, equal_sign_escaping=False)
            pure_name = re.sub(r'(^-\ ?|=$)', "", name)
            parameter.append(f"{pure_name}={escaped_value}")
            previous_arg_forces_named = True
        elif value.find("=") != -1 and value[: value.find("=")] in interaction.cbv_parameters:
            escaped_value = escape_argument_value(value)
            parameter.append(escaped_value)
        else:
            escaped_value = escape_argument_value(value, True, False)
            parameter.append(escaped_value)
    return parameter


def escape_argument_value(value: str, space_escaping=True, equal_sign_escaping=True) -> str:
    if space_escaping:
        value = re.sub(r'^(?= )|(?<= )$|(?<= )(?= )', r'\\', value)
    if equal_sign_escaping:
        value = re.sub(r'(?<!\\)=', r'\=', value)
    return re.sub(r'^#', r'\#', value)


class RobotInitFileBuilder:
    def __init__(self, test_theme: TestStructureTreeNode, tt_path: PurePath) -> None:
        self.test_theme = test_theme
        self.tt_path = PurePath(tt_path)

    def create_file(self) -> File:
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

    def _get_setting_section_metadata(self) -> Dict[str, str]:
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
