from enum import Enum
from pathlib import Path
from typing import Optional, Union

from pydantic import BaseModel


class Status(str, Enum):
    ONE = "1"
    TWO = "2"
    THREE = "3"
    FOUR = "4"
    FIVE = "5"
    SIX = "6"

    @classmethod
    def _missing_(cls, value: Union[str, int]) -> "Status":
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


class SerialKey(BaseModel):
    serial: int


class TOVKey(SerialKey):
    pass


class SubdivisionKey(SerialKey):
    pass


class UserKey(SerialKey):
    pass


class InteractionKey(SerialKey):
    pass


class ElementKey(SerialKey):
    pass


class DataTypeKey(SerialKey):
    pass


class ConditionKey(SerialKey):
    pass


class TestElement(BaseModel):
    name: str
    uniqueID: str
    hasVersion: bool
    libraryTovKey: Optional[TOVKey] = None
    libraryKey: Optional[SubdivisionKey] = None
    lockerKey: UserKey
    Interaction_key: Optional[InteractionKey] = None
    parent: Optional[ElementKey] = None
    status: Optional[Status] = None
    DataType_key: Optional[DataTypeKey] = None
    kindOfDataType: Optional[KindOfDataType] = None
    Condition_key: Optional[ConditionKey] = None
    Subdivision_key: Optional[SubdivisionKey] = None


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
        {},
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
