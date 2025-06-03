import types
from dataclasses import fields, is_dataclass
from enum import Enum
from typing import Any, TypeVar, Union, get_args, get_origin, get_type_hints

T = TypeVar("T")


def get_field_type(field_type):
    origin = get_origin(field_type)
    if origin is types.UnionType or origin is Union:
        args = get_args(field_type)
        for arg in args:
            if arg is not type(None):
                return arg
    return field_type


def convert_enum_value(value, field_type):
    if (
        value is not None
        and isinstance(value, (str, int))
        and isinstance(field_type, type)
        and issubclass(field_type, Enum)
    ):
        try:
            return field_type(value)
        except ValueError:
            pass
    return value


def convert_nested_dictionary(value, field_type):
    if is_dataclass(field_type) and isinstance(value, dict):
        return from_dict(field_type, value)
    return value


def convert_list_items(value, field_type):
    origin = get_origin(field_type)
    if not (isinstance(value, list) and origin is list):
        return value
    args = get_args(field_type)
    if not (args and len(args) == 1):
        return value
    item_type = args[0]
    if is_dataclass(item_type):
        return [from_dict(item_type, item) for item in value if isinstance(item, dict)]
    if isinstance(item_type, type) and issubclass(item_type, Enum):
        return [item_type(item) for item in value if isinstance(item, (str, int))]
    return value


def convert_field_value(value, type_hints):
    if value is None:
        return None
    type_hint = get_field_type(type_hints)
    value = convert_enum_value(value, type_hint)
    value = convert_nested_dictionary(value, type_hint)
    value = convert_list_items(value, type_hint)
    return value


def from_dict(cls: type[T], data: dict) -> T:
    if not is_dataclass(cls):
        raise ValueError(f"{cls.__name__} is not a dataclass")
    type_hints = get_type_hints(cls)
    cls_dict = {}
    for field in fields(cls):
        field_value = data.get(field.name)
        field_type_hints = type_hints.get(field.name, Any)
        cls_dict[field.name] = convert_field_value(field_value, field_type_hints)
    return cls(**cls_dict)
