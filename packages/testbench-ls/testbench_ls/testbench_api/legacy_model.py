from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class Status(str, Enum):
    ONE = "1"
    TWO = "2"
    THREE = "3"
    FOUR = "4"
    FIVE = "5"
    SIX = "6"

    @classmethod
    def _missing_(cls, value: str | int) -> "Status":
        if isinstance(value, int):
            str_value = str(value)
            for member in cls:
                if member.value == str_value:
                    return member
        return None


class KindOfDataType(str, Enum):
    REGULAR = "REGULAR"
    REFERENCE = "REFERENCE"
    GLOBAL = "GLOBAL"
    ACCEPTING_GLOBAL = "ACCEPTING_GLOBAL"


@dataclass
class SerialKey:
    serial: int | None = None


@dataclass
class TOVKey(SerialKey):
    pass


@dataclass
class SubdivisionKey(SerialKey):
    pass


@dataclass
class UserKey(SerialKey):
    pass


@dataclass
class InteractionKey(SerialKey):
    pass


@dataclass
class ElementKey(SerialKey):
    pass


@dataclass
class DataTypeKey(SerialKey):
    pass


@dataclass
class ConditionKey(SerialKey):
    pass


@dataclass
class ForeignLibraryTovKey(SerialKey):
    pass


@dataclass
class ForeignLibraryKey(SerialKey):
    pass


@dataclass
class TestElement:
    name: str
    uniqueID: str
    hasVersion: bool
    lockerKey: UserKey
    libraryTovKey: TOVKey | None = None
    libraryKey: SubdivisionKey | None = None
    foreignLibraryTovKey: ForeignLibraryTovKey | None = None
    foreignLibraryKey: ForeignLibraryKey | None = None
    Interaction_key: InteractionKey | None = None
    parent: ElementKey | None = None
    status: Status | None = None
    DataType_key: DataTypeKey | None = None
    kindOfDataType: KindOfDataType | None = None
    Condition_key: ConditionKey | None = None
    Subdivision_key: SubdivisionKey | None = None


def is_interaction(test_element: TestElement) -> bool:
    return bool(test_element.Interaction_key)


def get_test_element_uid(test_elements: list[TestElement], test_element_key: str):
    element = next(
        filter(
            lambda test_element: (
                test_element.Subdivision_key
                and test_element.Subdivision_key.serial == test_element_key
            )
            or (
                test_element.Interaction_key
                and test_element.Interaction_key.serial == test_element_key
            ),
            test_elements,
        ),
        TestElement(name="", uniqueID="", hasVersion=False, lockerKey=UserKey()),
    )
    return element.uniqueID


def get_interaction_parent_key(test_elements: list[TestElement], test_element: TestElement) -> str:
    parent = test_element.parent or test_element.libraryKey
    return parent.serial


def get_interactions_resource_path(
    test_elements: list[TestElement], interaction: TestElement
) -> Path:
    parent_key = get_interaction_parent_key(test_elements, interaction)
    path_parts = []
    subdivisions = {
        test_element.Subdivision_key.serial: test_element
        for test_element in test_elements
        if test_element.Subdivision_key
    }
    while parent_key and parent_key != "0":
        path_parts.insert(0, subdivisions.get(parent_key).name)
        parent_key = subdivisions.get(parent_key).parent.serial
    path_parts[-1] = f"{path_parts[-1]}.resource"
    return Path.cwd() / Path(*path_parts)


def get_interaction_key(test_element: TestElement) -> str:
    return test_element.Interaction_key.serial
