# docksmith/parser.py
# ============================================================
# File 1: Docksmithfile Parser
# ============================================================

import json
from dataclasses import dataclass

VALID_INSTRUCTIONS = {"FROM", "COPY", "RUN", "WORKDIR", "ENV", "CMD"}


@dataclass
class Instruction:
    type: str
    args: str
    line_number: int

    def __repr__(self):
        return f"Instruction(type={self.type!r}, args={self.args!r}, line={self.line_number})"


def parse_docksmithfile(filepath: str) -> list:
    instructions = []
    try:
        with open(filepath, "r") as f:
            lines = f.readlines()
    except FileNotFoundError:
        raise FileNotFoundError(f"[BUILD ERROR] Docksmithfile not found at: {filepath}")

    for i, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        parts   = line.split(None, 1)
        keyword = parts[0].upper()
        args    = parts[1].strip() if len(parts) > 1 else ""

        if keyword not in VALID_INSTRUCTIONS:
            raise ValueError(
                f"[PARSE ERROR] Line {i}: Unknown instruction '{parts[0]}'.\n"
                f"  Valid instructions: {', '.join(sorted(VALID_INSTRUCTIONS))}\n"
                f"  Got: {line!r}"
            )

        _validate_args(keyword, args, i)
        instructions.append(Instruction(type=keyword, args=args, line_number=i))

    if not instructions:
        raise ValueError("[PARSE ERROR] Docksmithfile is empty or has no valid instructions.")

    if instructions[0].type != "FROM":
        raise ValueError(
            f"[PARSE ERROR] Line {instructions[0].line_number}: "
            f"Docksmithfile must start with FROM, got '{instructions[0].type}'"
        )

    return instructions


def _validate_args(keyword, args, line_number):
    if keyword == "FROM":
        if not args:
            raise ValueError(f"[PARSE ERROR] Line {line_number}: FROM needs an image name.")
    elif keyword == "COPY":
        if len(args.split(None, 1)) < 2:
            raise ValueError(f"[PARSE ERROR] Line {line_number}: COPY needs <src> and <dest>.")
    elif keyword == "RUN":
        if not args:
            raise ValueError(f"[PARSE ERROR] Line {line_number}: RUN needs a command.")
    elif keyword == "WORKDIR":
        if not args:
            raise ValueError(f"[PARSE ERROR] Line {line_number}: WORKDIR needs a path.")
    elif keyword == "ENV":
        if "=" not in args:
            raise ValueError(f"[PARSE ERROR] Line {line_number}: ENV must be KEY=value. Got: {args!r}")
    elif keyword == "CMD":
        try:
            result = json.loads(args)
            if not isinstance(result, list) or not all(isinstance(x, str) for x in result):
                raise ValueError()
        except (json.JSONDecodeError, ValueError):
            raise ValueError(
                f"[PARSE ERROR] Line {line_number}: CMD must be a JSON string array.\n"
                f"  Example: CMD [\"python\", \"main.py\"]\n"
                f"  Got: {args!r}"
            )


def parse_from_args(args: str) -> tuple:
    if ":" in args:
        name, tag = args.split(":", 1)
    else:
        name, tag = args, "latest"
    return name.strip(), tag.strip()


def parse_env_args(args: str) -> tuple:
    if "=" not in args:
        raise ValueError(f"[PARSE ERROR] ENV must be KEY=value format. Got: {args!r}")
    key, _, value = args.partition("=")
    return key.strip(), value.strip()


def parse_copy_args(args: str) -> tuple:
    parts = args.split(None, 1)
    if len(parts) < 2:
        raise ValueError(f"[PARSE ERROR] COPY needs <src> and <dest>. Got: {args!r}")
    return parts[0], parts[1]


def parse_cmd_args(args: str) -> list:
    try:
        result = json.loads(args)
        if not isinstance(result, list):
            raise ValueError()
        return result
    except (json.JSONDecodeError, ValueError):
        raise ValueError(f"[PARSE ERROR] CMD must be a JSON array. Got: {args!r}")
