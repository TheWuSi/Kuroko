import base64
import re
from urllib.parse import parse_qsl, urlencode, urlsplit


def normalize_info_hash(value: str) -> str:
    if re.fullmatch(r"[0-9a-fA-F]{40}", value):
        return value.lower()
    if re.fullmatch(r"[A-Za-z2-7]{32}", value):
        return base64.b32decode(value.upper()).hex()
    raise ValueError("磁力 Hash 必须为 40 位十六进制或 32 位 Base32")


def magnet_info_hash(value: str) -> str:
    for key, item in parse_qsl(urlsplit(clean_magnet(value)).query):
        if key == "xt":
            return item.removeprefix("urn:btih:")
    raise ValueError("磁力链接缺少有效 xt 参数")


def magnet_display_name(value: str) -> str:
    """读取磁力 dn，仅用于元数据服务不可用时的保底展示。"""
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return ""
    for key, item in parse_qsl(parsed.query, keep_blank_values=False):
        if key.lower() == "dn":
            return item[:1024]
    return ""


def clean_magnet(value: str) -> str:
    if not isinstance(value, str) or len(value) > 8192 or any(ord(char) < 32 for char in value):
        raise ValueError("磁力链接过长或包含控制字符")
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() != "magnet" or parsed.netloc or parsed.path or parsed.fragment:
        raise ValueError("非法的磁力链接格式")
    params: list[tuple[str, str]] = []
    seen_xt = False
    seen_dn = False
    for key, item in parse_qsl(parsed.query, keep_blank_values=False):
        if key.lower() == "xt" and not seen_xt:
            match = re.fullmatch(r"urn:btih:(.+)", item, flags=re.IGNORECASE)
            if match:
                params.append(("xt", f"urn:btih:{normalize_info_hash(match.group(1))}"))
                seen_xt = True
        elif key.lower() == "dn" and not seen_dn and item:
            params.append(("dn", item[:1024]))
            seen_dn = True
    if not seen_xt:
        raise ValueError("磁力链接缺少有效 xt 参数")
    return "magnet:?" + urlencode(params)
