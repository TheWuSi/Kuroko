import re
from pathlib import PurePosixPath

# 顺序很重要：多段前缀必须先于通用前缀匹配，否则 FC2-PPV-123 会被截成 FC2。
DEFAULT_CODE_PATTERN = re.compile(
    r"(?ix)(?<![A-Z0-9])((?:FC2(?:[-_ ]?PPV)?|HEYZO|T\d{2,3}|[A-Z]{2,8})[-_ ]?\d{3,8})(?![A-Z0-9])"
)
PURE_NUMBER_PATTERN = re.compile(r"(?<![A-Z0-9])\d{4,8}(?![A-Z0-9])", re.IGNORECASE)
VARIANT_SUFFIX = re.compile(r"^[-_ .](UC|C|U)(?![A-Z0-9])", re.IGNORECASE)
PART_SUFFIX = re.compile(
    r"^(?:[-_ .]*\((\d{1,4})\)|[-_ .]*(?:CD|PART)[-_ .]?(\d{1,4})|[-_ .](\d{1,3}))(?![A-Z0-9])",
    re.IGNORECASE,
)
PART_FILE = re.compile(r"^(?:(?:CD|PART)[-_ .]?\d{1,4}|\(?\d{1,3}\)?)(?:[-_ .](?:UC|C|U))?$", re.I)


def _part_file_stem(name: str) -> str:
    return PurePosixPath(name).stem if re.search(r"\.[A-Z0-9]{2,5}$", name, re.I) else name


def _suffix_identity(suffix: str) -> tuple[str | None, int | None]:
    variant = part = None
    # 版本与分集可能先后互换，如 -C(1) 或 -CD1-UC，只读取紧跟番号的标记。
    for _ in range(2):
        version_match = VARIANT_SUFFIX.match(suffix)
        part_match = PART_SUFFIX.match(suffix)
        if version_match and variant is None:
            variant = version_match.group(1).upper()
            suffix = suffix[version_match.end() :]
        elif part_match and part is None:
            part = int(next(value for value in part_match.groups() if value is not None))
            suffix = suffix[part_match.end() :]
        else:
            break
    return variant, part


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


def extract_media_code(text: str, custom_patterns: list[str] | None = None) -> str | None:
    path = PurePosixPath(text[:4096])
    parent = extract_code(str(path.parent), custom_patterns)
    # CD001 等单独分集文件名会命中普通番号规则，FC2 作品目录对此提供更明确的身份。
    if parent and parent.startswith("FC2-PPV-") and PART_FILE.fullmatch(_part_file_stem(path.name)):
        return parent
    return extract_code(path.name, custom_patterns) or parent


def extract_variant(text: str, code: str | None = None) -> str:
    """只识别紧跟番号的版本后缀，不把目录名中无关的 C/U 当成版本。"""
    stem = _part_file_stem(PurePosixPath(text[:4096]).name)
    if code and code.startswith("FC2-PPV-") and PART_FILE.fullmatch(stem):
        variant, _ = _suffix_identity("-" + stem)
        if variant:
            return variant
    for pattern in (DEFAULT_CODE_PATTERN, PURE_NUMBER_PATTERN):
        # 文件名比父目录更具体；文件名没有版本后缀时再继承作品目录中的版本。
        for match in reversed(list(pattern.finditer(text[:4096]))):
            candidate = match.group(1) if match.lastindex else match.group(0)
            if code is not None and _normalize(candidate) != code:
                continue
            variant, _ = _suffix_identity(text[match.end() :])
            if variant:
                return variant
    return "original"


def extract_part_number(text: str, code: str) -> int | None:
    """FC2 的数字后缀表示分集，基础文件记为 0；其他番号保持原有版本查重规则。"""
    if not code.startswith("FC2-PPV-"):
        return None
    segments = text[:4096].replace("\\", "/").split("/")
    matches = {
        index: match
        for index, segment in enumerate(segments)
        for match in DEFAULT_CODE_PATTERN.finditer(segment)
        if _normalize(match.group(1)) == code
    }
    first = min(matches, default=len(segments) - 1)
    for index in range(len(segments) - 1, first - 1, -1):
        segment = segments[index]
        if index in matches:
            _, part = _suffix_identity(segment[matches[index].end() :])
            if part is not None:
                return part
        elif not extract_code(segment) or PART_FILE.fullmatch(_part_file_stem(segment)):
            # 作品目录内也可能只有 CD1.mp4、1.mkv 或 video(1).mp4；不读取作品目录之外的数字。
            stem = _part_file_stem(segment)
            stem = re.sub(r"[-_ .](UC|C|U)$", "", stem, flags=re.I)
            match = re.search(
                r"(?:^|[-_ .])(?:CD|PART)[-_ .]?(\d{1,4})$|(?:^|[-_ .])(\d{1,3})$|\((\d{1,4})\)$",
                stem,
                re.I,
            )
            if match:
                return int(next(value for value in match.groups() if value is not None))
    return 0
