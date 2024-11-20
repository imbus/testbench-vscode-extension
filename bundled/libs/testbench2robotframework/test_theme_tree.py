from pathlib import PurePath
from typing import Dict, List, Union

from testbench2robotframework.model import (
    InteractionDetails,
    InteractionType,
    TestCaseDetails,
    TestCaseSetDetails,
    TestStructureTreeNode,
)
from testbench2robotframework.utils import replace_invalid_characters


class TestThemeTreeVisitor:
    def visit_test_theme(self, test_theme):
        raise NotImplementedError

    # def visit_test_case_set(self, test_case_set):
    #     raise NotImplementedError

    def start_test_case_set(self, test_case_set):
        raise NotImplementedError

    def end_test_case_set(self, test_case_set):
        raise NotImplementedError

    # def visit_test_case(self, test_case):
    #     raise NotImplementedError

    def start_test_case(self, test_case):
        raise NotImplementedError

    def end_test_case(self, test_case):
        raise NotImplementedError

    # def visit_compound_interaction(self, interaction):
    #     raise NotImplementedError

    def start_compound_interaction(self, interaction):
        raise NotImplementedError

    def end_compound_interaction(self, interaction):
        raise NotImplementedError

    def visit_atomic_interaction(self, interaction):
        raise NotImplementedError

    # def start_atomic_interaction(self, interaction):
    #     raise NotImplementedError

    # def end_atomic_interaction(self, interaction):
    #     raise NotImplementedError


def get_tse_index(tse_numbering: str) -> str:
    return tse_numbering.rsplit(".", 1)[-1]


def get_padded_index(
    tse: Union[TestStructureTreeNode, TestCaseSetDetails], parent_child_count: int
) -> str:
    if isinstance(tse, TestCaseSetDetails):
        index = get_tse_index(tse.numbering)
    else:
        index = get_tse_index(tse.baseInformation.numbering)
    max_length = len(str(parent_child_count))
    return index.zfill(max_length)


def file_prefix(
    tse: TestStructureTreeNode, parent_child_count: int, log_suite_numbering: bool
) -> str:
    prefix_separator = '_' * (not log_suite_numbering)
    return f"{get_padded_index(tse, parent_child_count)}_{prefix_separator}"


class RootNode:
    def __init__(self) -> None:
        self.children: Dict[str, TestThemeNode] = {}

    def visit(self, visitor: TestThemeTreeVisitor):
        for child in self.children.values():
            child.visit(visitor)


class TestThemeNode:
    def __init__(self, tt: TestStructureTreeNode, log_suite_numbering: bool) -> None:
        self.log_suite_numbering: bool = log_suite_numbering
        self.value: TestStructureTreeNode = tt
        self._path: PurePath = None
        self.parent: TestThemeNode = None
        self.children: Dict[str, Union[TestThemeNode, TestCaseSetNode]] = {}

    def visit(self, visitor: TestThemeTreeVisitor):
        visitor.visit_test_theme(self)
        for child in self.children.values():
            child.visit(visitor)

    @property
    def path(self):
        if not self._path:
            if not isinstance(self.parent, RootNode):
                self._path = (
                    self.parent.path
                    / f"{file_prefix(self.value, len(self.parent.children), self.log_suite_numbering)}{replace_invalid_characters(self.value.baseInformation.name)}"
                )
            else:
                self._path = PurePath(
                    f"{file_prefix(self.value, len(self.parent.children), self.log_suite_numbering)}{replace_invalid_characters(self.value.baseInformation.name)}"
                )
        return self._path


class TestCaseSetNode:
    def __init__(self, tcs: TestCaseSetDetails, log_suite_numbering: bool) -> None:
        self.log_suite_numbering: bool = log_suite_numbering
        self.value: TestCaseSetDetails = tcs
        self._path: PurePath = None
        self.parent: Union[TestThemeNode, TestCaseSetNode] = None
        self.children: Dict[str, Union[TestCaseSetNode, TestCaseNode]] = {}

    def visit(self, visitor: TestThemeTreeVisitor):
        visitor.start_test_case_set(self)
        for child in self.children.values():
            child.visit(visitor)
        visitor.end_test_case_set(self)

    @property
    def path(self):
        if not self._path:
            if not isinstance(self.parent, RootNode):
                self._path = (
                    self.parent.path
                    / f"{file_prefix(self.value, len(self.parent.children), self.log_suite_numbering)}{replace_invalid_characters(self.value.name)}"
                )
            else:
                self._path = f"{file_prefix(self.value, len(self.parent.children), self.log_suite_numbering)}{replace_invalid_characters(self.value.name)}"
        return self._path


class TestCaseNode:
    def __init__(self, tc: TestCaseDetails) -> None:
        self.value: TestCaseDetails = tc
        self.children: List[Union[CompoundInteractionNode, AtomicInteractionNode]] = []
        for interaction in tc.interactions:
            if interaction.interactionType == InteractionType.Compound:
                self.children.append(CompoundInteractionNode(interaction, 1))
            elif interaction.interactionType == InteractionType.Atomic:
                self.children.append(AtomicInteractionNode(interaction, 1))

    def visit(self, visitor: TestThemeTreeVisitor):
        visitor.start_test_case(self)
        for child in self.children:
            child.visit(visitor)
        visitor.end_test_case(self)


class CompoundInteractionNode:
    def __init__(self, compound_interaction: InteractionDetails, indent: int) -> None:
        self.indent = indent
        self.value: InteractionDetails = compound_interaction
        self.children: List[Union[CompoundInteractionNode, AtomicInteractionNode]] = []
        for interaction in compound_interaction.interactions:
            if interaction.interactionType == InteractionType.Compound:
                self.children.append(CompoundInteractionNode(interaction, self.indent + 1))
            elif interaction.interactionType == InteractionType.Atomic:
                self.children.append(AtomicInteractionNode(interaction, self.indent + 1))

    def visit(self, visitor: TestThemeTreeVisitor):
        visitor.start_compound_interaction(self)
        for child in self.children:
            child.visit(visitor)
        visitor.end_compound_interaction(self)


class AtomicInteractionNode:
    def __init__(self, atomic_interaction: InteractionDetails, indent: int) -> None:
        self.indent = indent
        self.value: InteractionDetails = atomic_interaction

    def visit(self, visitor: TestThemeTreeVisitor):
        visitor.visit_atomic_interaction(self)
