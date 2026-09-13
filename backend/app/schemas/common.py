from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PageParams(BaseModel):
    page: int = Field(1, ge=1, le=100000)
    page_size: int = Field(20, ge=1, le=200)


# 沿用 Pydantic 泛型声明，兼容项目支持的早期 Pydantic 2.x 版本。
class PageData(BaseModel, Generic[T]):  # noqa: UP046
    total: int
    page: int
    page_size: int
    items: list[T]
