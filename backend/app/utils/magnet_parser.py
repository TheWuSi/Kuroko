import re
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit


def magnet_display_name(value: str) -> str:
    """读取磁力 dn，仅用于元数据服务不可用时的保底展示。"""
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return ""
    for key, item in parse_qsl(parsed.query, keep_blank_values=False):
        if key == "dn":
            return unquote(item[:1024])
    return ""


def clean_magnet(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() != "magnet":
        raise ValueError("非法的磁力链接格式")
    params: list[tuple[str, str]] = []
    seen_xt = False
    seen_dn = False
    for key, item in parse_qsl(parsed.query, keep_blank_values=False):
        if key.lower() == "xt" and not seen_xt:
            match = re.fullmatch(r"urn:btih:([A-Za-z0-9]{32,40})", item, flags=re.IGNORECASE)
            if match:
                params.append(("xt", f"urn:btih:{match.group(1)}"))
                seen_xt = True
        elif key.lower() == "dn" and not seen_dn and item:
            params.append(("dn", item[:1024]))
            seen_dn = True
    if not seen_xt:
        raise ValueError("磁力链接缺少有效 xt 参数")
    return "magnet:?" + urlencode(params)
