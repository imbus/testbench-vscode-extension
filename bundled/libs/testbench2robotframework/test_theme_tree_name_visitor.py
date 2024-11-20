from testbench2robotframework.model import (
    InteractionDetails,
    TestCaseDetails,
    TestCaseSetDetails,
    TestStructureTreeNode,
)
from testbench2robotframework.test_theme_tree import (
    TestCaseSetNode,
    TestThemeNode,
    TestThemeTreeVisitor,
)
from .log import logger


class TestThemeTreeNameVisitor(TestThemeTreeVisitor):
    def visit_test_theme(self, test_theme: TestThemeNode):
        # logger.info(f"tt: {test_theme.value.baseInformation.numbering} {test_theme.value.baseInformation.name}")
        logger.info(f"tt: {test_theme.path}")

    def visit_test_case_set(self, test_case_set: TestCaseSetNode):
        # logger.info(f"tcs: {test_case_set.value.numbering} {test_case_set.value.name}")
        logger.info(f"tcs: {test_case_set.path}")

    def visit_test_case(self, test_case: TestCaseDetails):
        logger.info(f"tc: {test_case.value.uniqueID}")

    def visit_compound_interaction(self, interaction: InteractionDetails):
        logger.info(f"compound: {interaction.value.name}")

    def visit_atomic_interaction(self, interaction: InteractionDetails):
        logger.info(f"atomic: {interaction.value.name}")
