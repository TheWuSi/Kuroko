import re

# 顺序很重要：多段前缀必须先于通用前缀匹配，否则 FC2-PPV-123 会被截成 FC2。
DEFAULT_CODE_PATTERN = re.compile(
    r"(?ix)(?<![A-Z0-9])((?:FC2[-_ ]?PPV|HEYZO|T\d{2,3}|[A-Z]{2,8})[-_ ]?\d{3,8})(?![A-Z0-9])"
)
PURE_NUMBER_PATTERN = re.compile(r"(?<![A-Z0-9])\d{4,8}(?![A-Z0-9])")


def _normalize(value: str) -> str:
    value = re.sub(r"[_ ]+", "-", value.strip().upper())
    value = re.sub(r"-+", "-", value)
    # FC2PPV-123 和 FC2-PPV-123 对用户而言是同一类番号，统一显示为可读形式。
    value = re.sub(r"^FC2PPV-", "FC2-PPV-", value)
    if re.fullmatch(r"[A-Z]+\d+", value):
        value = re.sub(r"([A-Z])(?=\d)", r"\1-", value, count=1)
    return value


def extract_code(text: str, custom_patterns: list[str] | None = None) -> str | None:
    """从文件名或路径提取番号，支持自定义正则并限制结果长度。"""
    patterns = []
    for expression in custom_patterns or []:
        if len(expression) > 256:
            continue
        try:
            patterns.append(re.compile(expression, re.IGNORECASE))
        except re.error:
            continue
    for pattern in patterns + [DEFAULT_CODE_PATTERN, PURE_NUMBER_PATTERN]:
        match = pattern.search(text[:4096])
        if not match:
            continue
        candidate = match.group(1) if match.lastindex else match.group(0)
        candidate = _normalize(candidate)
        if 3 <= len(candidate) <= 64:
            return candidate
    return None
