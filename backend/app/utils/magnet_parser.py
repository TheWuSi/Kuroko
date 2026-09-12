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
    info_hash = None
    display_name = None
    for key, item in parse_qsl(parsed.query, keep_blank_values=False):
        if key.lower() == "xt" and info_hash is None:
            match = re.fullmatch(r"urn:btih:(.+)", item, flags=re.IGNORECASE)
            if match:
                info_hash = normalize_info_hash(match.group(1))
        elif key.lower() == "dn" and display_name is None and item:
            display_name = item[:1024]
    if info_hash is None:
        raise ValueError("磁力链接缺少有效 xt 参数")
    # 部分离线工具不接受 urn%3Abtih%3A；仅显示名参与 URL 编码，URN 保持可读形式。
    suffix = "&" + urlencode({"dn": display_name}) if display_name else ""
    return f"magnet:?xt=urn:btih:{info_hash}{suffix}"
