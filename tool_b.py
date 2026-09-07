"""ツールB：審査判断支援ツール の起動口."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from shinsa.app_b import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
