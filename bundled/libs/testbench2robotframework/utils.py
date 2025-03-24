import re
import shutil
import sys
from pathlib import Path, PurePath
from typing import Optional
from zipfile import ZipFile

from testbench2robotframework.model import (
    TestStructureElementType,
    TestStructureTree,
    TestStructureTreeNode,
)


class PathResolver:
    def __init__(
        self,
        test_theme_tree: TestStructureTree,
        uids_of_existing_tcs: tuple[str, ...],
        log_suite_numbers: bool,
    ):
        self.tcs_catalog: dict[str, TestStructureTreeNode] = {}
        self.tt_catalog: dict[str, TestStructureTreeNode] = {}
        self.tree_dict: dict[str, TestStructureTreeNode] = {}
        self._last_child_indices: dict[str, int] = {}
        self._log_suite_numbers = log_suite_numbers
        self._uids_of_existing_tcs = uids_of_existing_tcs
        self._analyze_tree(test_theme_tree)
        self.tcs_paths = self._get_paths(self.tcs_catalog)
        self.tt_paths = self._get_paths(self.tt_catalog)

    def _analyze_tree(self, test_theme_tree: TestStructureTree):
        self.tree_dict[test_theme_tree.root.base.key] = test_theme_tree.root
        self._add_existing_tcs_to_catalog(test_theme_tree.root)
        for tse in test_theme_tree.nodes:
            self._add_existing_tcs_to_catalog(tse)
            self.tree_dict[tse.base.key] = tse
            self._store_highest_child_index(tse)

    def _store_highest_child_index(self, tse):
        self._last_child_indices[tse.base.parentKey] = max(
            int(get_tse_index(tse)),
            self._last_child_indices.get(tse.base.parentKey, 0),
        )

    def _add_existing_tcs_to_catalog(self, tse):
        if (
            tse.elementType == TestStructureElementType.TestCaseSetNode
            and tse.base.uniqueID in self._uids_of_existing_tcs
        ):
            self.tcs_catalog[tse.base.uniqueID] = tse

    def _get_paths(self, tse_catalog: dict[str, TestStructureTreeNode]) -> dict[str, PurePath]:
        return {uid: self._resolve_tse_path(tse) for uid, tse in tse_catalog.items()}

    def _resolve_tse_path(self, tse: TestStructureTreeNode) -> PurePath:
        self._add_tt_to_tt_catalog(tse)
        if tse.elementType == TestStructureElementType.RootNode:
            return PurePath()
        tse_name = replace_invalid_characters(tse.base.name)
        if tse.base.parentKey not in self.tree_dict:
            return PurePath(f"{self._file_prefix(tse)}{tse_name}")
        parent_path = self._resolve_tse_path(self.tree_dict[tse.base.parentKey])
        return parent_path / f"{self._file_prefix(tse)}{tse_name}"

    def _add_tt_to_tt_catalog(self, tse):
        if (
            tse.elementType == TestStructureElementType.TestThemeNode
            and tse.base.uniqueID not in self.tt_catalog
        ):
            self.tt_catalog[tse.base.uniqueID] = tse

    def _file_prefix(self, tse) -> str:
        prefix_separator = "_" * self._log_suite_numbers
        return f"{self._get_padded_index(tse)}_{prefix_separator}"

    def _get_padded_index(self, tse) -> str:
        index = get_tse_index(tse)
        max_length = len(str(self._last_child_indices.get(tse.base.parentKey, "")))
        return index.zfill(max_length)


def get_directory(json_report_path: Optional[str]) -> str:
    if json_report_path is None:
        return ""
    if not Path(json_report_path).exists():
        sys.exit("Error opening " + json_report_path + ". Path does not exist.")
    if Path(json_report_path).is_dir():
        return str(Path(json_report_path).resolve())
    ext = Path(json_report_path).suffix
    filename = str(Path(json_report_path).parent / Path(json_report_path).stem)
    if ext.lower() == ".zip":
        with ZipFile(json_report_path, "r") as zip_ref:
            zip_ref.extractall(filename)
        return str(Path(filename).resolve())
    sys.exit("Error opening " + json_report_path + ". File is not a ZIP file.")


def extract_to_working_directory(zip_file: Path, working_dir: Path) -> None:
    ext = zip_file.suffix
    if ext.lower() != ".zip":
        sys.exit(f"Error opening '{zip_file.as_posix()}'. File is not a ZIP file.")
    with ZipFile(zip_file, "r") as zip_ref:
        zip_ref.extractall(working_dir)


def is_zip_file(path: Path) -> bool:
    return path.suffix.lower() == ".zip"


def ensure_dir_exists(cli_output_dir):
    if not Path(cli_output_dir).is_dir():
        Path(cli_output_dir).mkdir(parents=True, exist_ok=True)


def replace_invalid_characters(name: str) -> str:
    return re.sub(r'[<>:"/\\|?* ]', "_", name)


def get_tse_index(tse: TestStructureTreeNode) -> str:
    return tse.base.numbering.rsplit(".", 1)[-1]


def directory_to_zip(directory: Path, new_path: Optional[str] = None):
    if new_path:
        shutil.make_archive(str(new_path), "zip", str(directory))
    else:
        shutil.make_archive(str(directory), "zip", str(directory))


def get_list_item(lst, index, default: Optional[str]):
    try:
        return lst[index]
    except IndexError:
        return default
