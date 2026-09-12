import re

# 顺序很重要：多段前缀必须先于通用前缀匹配，否则 FC2-PPV-123 会被截成 FC2。
DEFAULT_CODE_PATTERN = re.compile(
    r"(?ix)(?<![A-Z0-9])((?:FC2(?:[-_ ]?PPV)?|HEYZO|T\d{2,3}|[A-Z]{2,8})[-_ ]?\d{3,8})(?![A-Z0-9])"
)
PURE_NUMBER_PATTERN = re.compile(r"(?<![A-Z0-9])\d{4,8}(?![A-Z0-9])", re.IGNORECASE)


def _normalize(value: str) -> str:
    value = re.sub(r"[_ ]+", "-", value.strip().upper())
    value = re.sub(r"-+", "-", value)
    # PPV 不参与 FC2 身份判定，保留既有可读格式，避免同一作品被分成两个番号。
    value = re.sub(r"^FC2(?:-?PPV)?-?(\d+)$", r"FC2-PPV-\1", value)
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


def canonical_code(value: str) -> str:
    """将手工输入的番号与扫描提取结果统一，版本信息另行保存。"""
    return extract_code(value) or _normalize(value)


def extract_variant(text: str, code: str | None = None) -> str:
    """只识别紧跟番号的版本后缀，不把目录名中无关的 C/U 当成版本。"""
    for pattern in (DEFAULT_CODE_PATTERN, PURE_NUMBER_PATTERN):
        # 文件名比父目录更具体；文件名没有版本后缀时再继承作品目录中的版本。
        for match in reversed(list(pattern.finditer(text[:4096]))):
            candidate = match.group(1) if match.lastindex else match.group(0)
            if code is not None and _normalize(candidate) != code:
                continue
            suffix = re.match(r"[-_ ](UC|C|U)(?![A-Z0-9])", text[match.end() :], re.IGNORECASE)
            if suffix:
                return suffix.group(1).upper()
    return "original"
