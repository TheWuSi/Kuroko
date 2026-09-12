from app.services.magnet_metadata_client import MagnetMetadataApiClient


class BtParserClient(MagnetMetadataApiClient):
    """兼容旧导入路径，并默认启用优雅降级。"""

    def parse(self, magnet_uri: str):
        return self.parse_with_fallback(magnet_uri)
