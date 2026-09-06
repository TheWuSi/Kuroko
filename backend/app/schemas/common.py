from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PageParams(BaseModel):
    page: int = Field(1, ge=1, le=100000)
    page_size: int = Field(20, ge=1, le=200)


class PageData(BaseModel, Generic[T]):
    total: int
    page: int
    page_size: int
    items: list[T]
