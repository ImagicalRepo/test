"""ページ画像の先読みとキャッシュ.

OK 案件を 1 件 30 秒で流すには、「次へ」を押した瞬間にページが出ている必要がある。
スキャン PDF の描画は重いので、裏で先に描いておく。

全 1 万件の工数見積もり（約 346 時間）は、ここが効くことを前提にしている。
"""
from __future__ import annotations

import queue
import threading
from collections import OrderedDict
from pathlib import Path

from PIL import Image

from . import pdfio

# 保持する枚数。1 件あたり数ページなので、数件分を持てば足りる。
DEFAULT_CACHE_SIZE = 48


class PageCache:
    """描画済みページの LRU キャッシュ（スレッド安全）."""

    def __init__(self, max_items: int = DEFAULT_CACHE_SIZE) -> None:
        self.max_items = max_items
        self._items: OrderedDict[tuple[str, int, int], Image.Image] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, pdf_path: Path, page_index: int, dpi: int) -> Image.Image | None:
        key = (str(pdf_path), page_index, dpi)
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def put(self, pdf_path: Path, page_index: int, dpi: int, image: Image.Image) -> None:
        key = (str(pdf_path), page_index, dpi)
        with self._lock:
            self._items[key] = image
            self._items.move_to_end(key)
            while len(self._items) > self.max_items:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)


class Prefetcher:
    """裏で先読みする常駐スレッド.

    `warm()` に次に開く PDF を渡しておくと、順に描画してキャッシュに載せる。
    `load()` はキャッシュにあれば即返し、無ければその場で描画する
    （先読みが間に合わなくても動作は正しい。遅くなるだけ）。
    """

    def __init__(self, cache: PageCache | None = None, dpi: int = pdfio.DPI_PREVIEW) -> None:
        # PageCache は __len__ を定義しているため、空のキャッシュは偽になる。
        # `cache or PageCache()` と書くと渡されたキャッシュが捨てられるので、必ず None 判定にする。
        self.cache = cache if cache is not None else PageCache()
        self.dpi = dpi
        self._queue: queue.Queue[tuple[Path, int] | None] = queue.Queue()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._stopped = threading.Event()
        self.errors: list[str] = []
        self._thread.start()

    def warm(self, pdf_path: Path, pages: int = 3) -> None:
        """この PDF の先頭数ページを先に描いておく."""
        for page_index in range(pages):
            self._queue.put((pdf_path, page_index))

    def load(self, pdf_path: Path, page_index: int, dpi: int | None = None) -> Image.Image:
        """ページを取り出す。キャッシュに無ければその場で描画する."""
        dpi = dpi or self.dpi
        cached = self.cache.get(pdf_path, page_index, dpi)
        if cached is not None:
            return cached
        image = pdfio.render_page(pdf_path, page_index, dpi=dpi)
        self.cache.put(pdf_path, page_index, dpi, image)
        return image

    def stop(self) -> None:
        self._stopped.set()
        self._queue.put(None)

    def _run(self) -> None:
        while not self._stopped.is_set():
            item = self._queue.get()
            if item is None:
                break
            pdf_path, page_index = item
            if self.cache.get(pdf_path, page_index, self.dpi) is not None:
                continue
            try:
                image = pdfio.render_page(pdf_path, page_index, dpi=self.dpi)
            except Exception as exc:  # noqa: BLE001
                # 先読みは失敗しても動作は正しい（その場で描き直される）。
                # ただし黙って消すと原因が追えないので記録は残す。
                self.errors.append(f"{pdf_path.name} p.{page_index + 1}: {exc}")
                continue
            self.cache.put(pdf_path, page_index, self.dpi, image)
