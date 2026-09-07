"""作業リストの作成.

スキャンデータのファイル名は次の規則になっている。

    [2桁]A[受給者証7桁]A[3桁]_yyyymmdd_[通し番号].pdf
    例: 01A1234567A001_20260601_1.pdf

通し番号が奇数なら申請書一式、偶数なら臨床調査個人票。
臨個票はこの作業では扱わない（別ファイルに分離されており、判断のブレも無いため）。

受給者番号が重複する場合は、日付の古いものを申請書一式の本体とし、
残りを「不備解消または追加書類」として扱う。同一受給者番号・同一日付は発生しない。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

# [2桁]A[受給者証7桁]A[3桁]_yyyymmdd_[通し番号]
FILENAME_PATTERN = re.compile(
    r"^(?P<prefix>\d{2})A(?P<recipient>\d{7})A(?P<branch>\d{3})"
    r"_(?P<date>\d{8})_(?P<serial>\d+)$"
)


@dataclass(frozen=True)
class ScanFile:
    """1 つの PDF ファイル."""

    path: Path
    recipient_no: str      # 受給者番号 7 桁
    prefix: str            # 先頭 2 桁
    branch: str            # 末尾 3 桁
    received_on: date      # ファイル名の日付
    serial: int            # 通し番号

    @property
    def is_application(self) -> bool:
        """通し番号が奇数なら申請書一式."""
        return self.serial % 2 == 1

    @property
    def label(self) -> str:
        return f"{self.received_on:%Y/%m/%d}  {self.path.name}"


@dataclass
class Case:
    """1 申請＝作業リストの 1 行."""

    recipient_no: str
    primary: ScanFile                              # 申請書一式の本体（最古）
    additional: list[ScanFile] = field(default_factory=list)  # 不備解消・追加書類
    clinical: list[ScanFile] = field(default_factory=list)    # 臨個票（参照用・作業対象外）

    @property
    def received_on(self) -> date:
        return self.primary.received_on

    @property
    def has_additional(self) -> bool:
        return bool(self.additional)

    def swap_primary(self, new_primary: ScanFile) -> None:
        """本体を入れ替える.

        「最古＝申請書一式の本体」は既定であって絶対ではない。
        先に不備書類だけが届くこともあるため、画面から入れ替えられるようにする。
        """
        if new_primary is self.primary:
            return
        if new_primary not in self.additional:
            raise ValueError("この案件に含まれないファイルは本体にできません。")
        self.additional.remove(new_primary)
        self.additional.append(self.primary)
        self.additional.sort(key=_sort_key)
        self.primary = new_primary


def parse_filename(path: Path) -> ScanFile | None:
    """ファイル名を解析する。規則に合わなければ None."""
    match = FILENAME_PATTERN.match(path.stem)
    if not match:
        return None
    raw = match.group("date")
    try:
        received_on = date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
    except ValueError:
        return None  # 日付として成立しない（20261301 など）
    return ScanFile(
        path=path,
        recipient_no=match.group("recipient"),
        prefix=match.group("prefix"),
        branch=match.group("branch"),
        received_on=received_on,
        serial=int(match.group("serial")),
    )


def scan_folder(folder: Path) -> tuple[list[ScanFile], list[Path]]:
    """フォルダを再帰的に走査する.

    戻り値は (解析できたファイル, 解析できなかったファイル)。
    **解析できないものを黙って捨てない。** 人が見て判断できるよう必ず返す。
    """
    parsed: list[ScanFile] = []
    unparsed: list[Path] = []
    for path in sorted(folder.rglob("*.pdf")):
        if not path.is_file():
            continue
        scan = parse_filename(path)
        (parsed if scan else unparsed).append(scan or path)  # type: ignore[arg-type]
    return parsed, unparsed


def build_cases(scans: list[ScanFile]) -> list[Case]:
    """受給者番号でまとめ、最古を本体とする作業リストを作る.

    日付の古い順に並べて返す。
    申請書一式（奇数）が 1 つも無い受給者番号は、作業対象にならないので含めない。
    """
    grouped: dict[str, list[ScanFile]] = {}
    for scan in scans:
        grouped.setdefault(scan.recipient_no, []).append(scan)

    cases: list[Case] = []
    for recipient_no, files in grouped.items():
        applications = sorted((f for f in files if f.is_application), key=_sort_key)
        clinical = sorted((f for f in files if not f.is_application), key=_sort_key)
        if not applications:
            continue
        cases.append(
            Case(
                recipient_no=recipient_no,
                primary=applications[0],
                additional=applications[1:],
                clinical=clinical,
            )
        )
    return sorted(cases, key=lambda c: (c.received_on, c.recipient_no))


def orphan_clinical(scans: list[ScanFile]) -> list[ScanFile]:
    """申請書一式が無く、臨個票だけがある受給者番号のファイル.

    運用上はダミーの申請書を起こすため通常は発生しないが、
    取りこぼしに気づけるよう拾えるようにしておく。
    """
    grouped: dict[str, list[ScanFile]] = {}
    for scan in scans:
        grouped.setdefault(scan.recipient_no, []).append(scan)
    orphans = []
    for files in grouped.values():
        if not any(f.is_application for f in files):
            orphans.extend(files)
    return sorted(orphans, key=_sort_key)


def _sort_key(scan: ScanFile) -> tuple[date, int]:
    return (scan.received_on, scan.serial)
