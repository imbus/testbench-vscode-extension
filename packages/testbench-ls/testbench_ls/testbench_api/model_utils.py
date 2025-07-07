from dataclasses import fields, is_dataclass
from enum import Enum
from types import UnionType as TypesUnion
from typing import Any, TypeVar, get_args, get_origin, get_type_hints
from typing import Union as TypingUnion

T = TypeVar("T")

ERROR_NOT_A_DATACLASS = "The provided class '{dataclass}' is not a dataclass."
ERROR_UNKNOWN_TYPE_HINT_ORIGIN = "Unknown type hint origin."
ERROR_UNION_MISMATCH = "Value does not match any of the union types."
ERROR_NOT_A_LIST = "Value is not of type list."
ERROR_LIST_ARGUMENTS_MISMATCH = "List type hint must have exactly one argument, got {args}."
ERROR_UNION_WITHOUT_ARGUMENTS = "Union type hint must have at least one argument."
ERROR_TOO_MANY_DATA_FIELDS = "Data dictionary contains more fields than the dataclass has."
ERROR_NONETYPE_DATA = "Data cannot be None."


class Origin(Enum):
    NO_ORIGIN = "NO_ORIGIN"
    UNION = "UNION"
    LIST = "LIST"


PRIMITIVE_TYPES = (int, float, str, bool)


def get_origin_from_type_hint(type_hint):
    type_hint_origin = get_origin(type_hint)
    if type_hint_origin is None:
        return Origin("NO_ORIGIN")
    if type_hint_origin is TypesUnion or type_hint_origin is TypingUnion:
        return Origin("UNION")
    if type_hint_origin is list:
        return Origin("LIST")
    raise ValueError(ERROR_UNKNOWN_TYPE_HINT_ORIGIN)


def from_dict(cls: type[T], data: dict) -> T:
    if not is_dataclass(cls):
        raise ValueError(ERROR_NOT_A_DATACLASS.format(dataclass=cls.__name__))
    if data is None:
        raise ValueError(ERROR_NONETYPE_DATA)
    cls_dict = {}
    class_type_hints = get_type_hints(cls)
    class_fields = fields(cls)
    if len(class_fields) < len(data):
        raise ValueError(ERROR_TOO_MANY_DATA_FIELDS)
    for cls_field in class_fields:
        if cls_field.name not in data:
            continue
        field_value = data.get(cls_field.name)
        field_type_hint = class_type_hints[cls_field.name]
        cls_dict[cls_field.name] = convert_value(field_value, field_type_hint)
    return cls(**cls_dict)


def convert_value_without_origin(value: Any, type_hint: Any) -> Any:
    if value is None:
        return None
    if is_dataclass(type_hint):
        return from_dict(type_hint, value)
    return type_hint(value)


def convert_value_with_union_type(value: Any, type_hint: Any) -> Any:
    args = get_args(type_hint)
    if value is None:
        if args and type(None) in args:
            return None
        raise TypeError(ERROR_UNION_MISMATCH)
    if len(args) == 0:
        raise TypeError(ERROR_UNION_WITHOUT_ARGUMENTS)
    primitive_args = []
    for arg in args:
        if arg in PRIMITIVE_TYPES:
            primitive_args.append(arg)
            continue
        try:
            return convert_value(value, arg)
        except (TypeError, ValueError):
            continue
    for arg in primitive_args:
        try:
            return convert_value(value, arg)
        except (TypeError, ValueError):
            continue
    raise TypeError(ERROR_UNION_MISMATCH)


def convert_value_with_list_type(value: Any, type_hint: Any) -> Any:
    if not isinstance(value, list):
        raise TypeError(ERROR_NOT_A_LIST)
    args = get_args(type_hint)
    if len(args) != 1:
        raise TypeError(ERROR_LIST_ARGUMENTS_MISMATCH.format(args=len(args)))
    list_item_type_hint = args[0]
    return [convert_value(item, list_item_type_hint) for item in value]


def convert_value(value: Any, type_hint: Any) -> Any:
    origin = get_origin_from_type_hint(type_hint)
    if origin is Origin.NO_ORIGIN:
        return convert_value_without_origin(value, type_hint)
    if origin is Origin.UNION:
        return convert_value_with_union_type(value, type_hint)
    return convert_value_with_list_type(value, type_hint)
