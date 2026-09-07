"""表示領域の座標計算.

作業窓は左右 2 カラムで、それぞれ独立に拡大・スクロールする。
「画面で囲んだ場所」と「ページ上の場所」の対応がずれると、
マークアップもマスキングも意味を失うため、計算だけを切り出して検証できるようにした。

座標系は 3 つある。
  ページ比率  … 0.0〜1.0。保存に使う（解像度に依存しない）
  画像ピクセル … 元画像の画素
  画面座標    … Canvas 上の位置
"""
from __future__ import annotations

from dataclasses import dataclass, replace

MIN_ZOOM = 0.1
MAX_ZOOM = 8.0


@dataclass(frozen=True)
class Viewport:
    """1 カラムの表示状態.

    pane_* は Canvas 上のこのカラムの矩形。
    offset_* は「画像のどこを左上に表示しているか」を画像ピクセルで表す。
    """

    image_width: int
    image_height: int
    pane_x: int
    pane_y: int
    pane_width: int
    pane_height: int
    zoom: float = 1.0
    offset_x: float = 0.0
    offset_y: float = 0.0

    # ---------- 倍率 ----------

    def fit_scale(self) -> float:
        """カラムに収まる倍率."""
        if not self.image_width or not self.image_height:
            return 1.0
        return min(
            self.pane_width / self.image_width,
            self.pane_height / self.image_height,
        )

    def fitted(self) -> "Viewport":
        """全体が見えるように収める（自動的に中央寄せになる）."""
        return replace(self, zoom=self.fit_scale())._clamped()

    def zoomed(self, factor: float, anchor: tuple[int, int] | None = None) -> "Viewport":
        """拡大・縮小する.

        anchor（画面座標）を指定すると、その点を動かさずに拡大する。
        指定しなければカラムの中心を基準にする。
        """
        new_zoom = _clamp(self.zoom * factor, MIN_ZOOM, MAX_ZOOM)
        if new_zoom == self.zoom:
            return self
        if anchor is None:
            anchor = (self.pane_x + self.pane_width // 2, self.pane_y + self.pane_height // 2)
        # 拡大前後で anchor が指す画像上の点を一致させる
        image_x = self.offset_x + (anchor[0] - self.pane_x) / self.zoom
        image_y = self.offset_y + (anchor[1] - self.pane_y) / self.zoom
        view = replace(
            self,
            zoom=new_zoom,
            offset_x=image_x - (anchor[0] - self.pane_x) / new_zoom,
            offset_y=image_y - (anchor[1] - self.pane_y) / new_zoom,
        )
        return view._clamped()

    def scrolled(self, dx: float, dy: float) -> "Viewport":
        """画面座標での移動量ぶんスクロールする."""
        return replace(
            self, offset_x=self.offset_x + dx / self.zoom, offset_y=self.offset_y + dy / self.zoom
        )._clamped()

    def resized(self, pane_x: int, pane_y: int, pane_width: int, pane_height: int) -> "Viewport":
        return replace(
            self, pane_x=pane_x, pane_y=pane_y, pane_width=pane_width, pane_height=pane_height
        )._clamped()

    # ---------- 座標変換 ----------

    def contains(self, point: tuple[int, int]) -> bool:
        x, y = point
        return (
            self.pane_x <= x < self.pane_x + self.pane_width
            and self.pane_y <= y < self.pane_y + self.pane_height
        )

    def to_ratio(self, point: tuple[float, float]) -> tuple[float, float]:
        """画面座標 → ページ比率（0.0〜1.0 に丸める）."""
        x, y = point
        image_x = self.offset_x + (x - self.pane_x) / self.zoom
        image_y = self.offset_y + (y - self.pane_y) / self.zoom
        return (
            _clamp(image_x / self.image_width, 0.0, 1.0) if self.image_width else 0.0,
            _clamp(image_y / self.image_height, 0.0, 1.0) if self.image_height else 0.0,
        )

    def to_canvas(self, ratio: tuple[float, float]) -> tuple[float, float]:
        """ページ比率 → 画面座標."""
        rx, ry = ratio
        return (
            self.pane_x + (rx * self.image_width - self.offset_x) * self.zoom,
            self.pane_y + (ry * self.image_height - self.offset_y) * self.zoom,
        )

    def ratio_box(
        self, start: tuple[float, float], end: tuple[float, float]
    ) -> tuple[float, float, float, float]:
        """2 点のドラッグから、正規化した比率の矩形を作る."""
        x0, y0 = self.to_ratio(start)
        x1, y1 = self.to_ratio(end)
        return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

    def canvas_box(
        self, box: tuple[float, float, float, float]
    ) -> tuple[float, float, float, float]:
        """比率の矩形 → 画面座標の矩形."""
        left, top, right, bottom = box
        x0, y0 = self.to_canvas((left, top))
        x1, y1 = self.to_canvas((right, bottom))
        return (x0, y0, x1, y1)

    def visible_source(self) -> tuple[tuple[int, int, int, int], tuple[int, int], tuple[int, int]] | None:
        """描画に必要な部分だけを求める.

        戻り値は (元画像から切り出す矩形, 拡大後の寸法, 画面上の配置位置)。
        拡大時に画像全体を作ると重いので、見えている範囲だけを切り出して拡大する。
        画像が表示範囲から完全に外れている場合は None。
        """
        left = max(0.0, self.offset_x)
        top = max(0.0, self.offset_y)
        right = min(float(self.image_width), self.offset_x + self.pane_width / self.zoom)
        bottom = min(float(self.image_height), self.offset_y + self.pane_height / self.zoom)
        if right <= left or bottom <= top:
            return None

        crop = (int(left), int(top), max(int(left) + 1, int(right)), max(int(top) + 1, int(bottom)))
        size = (
            max(1, round((crop[2] - crop[0]) * self.zoom)),
            max(1, round((crop[3] - crop[1]) * self.zoom)),
        )
        position = (
            round(self.pane_x + (crop[0] - self.offset_x) * self.zoom),
            round(self.pane_y + (crop[1] - self.offset_y) * self.zoom),
        )
        return crop, size, position

    def display_size(self) -> tuple[int, int]:
        """画像を描く際の表示寸法."""
        return (
            max(1, round(self.image_width * self.zoom)),
            max(1, round(self.image_height * self.zoom)),
        )

    # ---------- 内部 ----------

    def _clamped(self) -> "Viewport":
        """表示位置を妥当な範囲に収める.

        画像が表示領域より小さいときは中央に寄せる（オフセットが負になる）。
        大きいときは、画像の外側が見えないように端で止める。
        """
        return replace(
            self,
            offset_x=_fit_axis(self.offset_x, self.image_width, self.pane_width / self.zoom),
            offset_y=_fit_axis(self.offset_y, self.image_height, self.pane_height / self.zoom),
        )


def _fit_axis(offset: float, image_size: float, visible_size: float) -> float:
    if visible_size >= image_size:
        return (image_size - visible_size) / 2      # 中央寄せ
    return _clamp(offset, 0.0, image_size - visible_size)


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))
