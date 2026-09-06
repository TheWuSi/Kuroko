import re

DEFAULT_CODE_PATTERN = re.compile(r"(?i)(?<![A-Z0-9])([A-Z]{2,5})[-_ ]?(\d{3,5})(?!\d)")


def extract_code(text: str) -> str | None:
    match = DEFAULT_CODE_PATTERN.search(text)
    if not match:
        return None
    return f"{match.group(1).upper()}-{match.group(2)}"
