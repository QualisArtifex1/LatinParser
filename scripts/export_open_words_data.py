from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def find_open_words_root() -> Path:
    env_path = os.getenv("OPEN_WORDS_PATH")
    candidates = [
        Path(env_path).expanduser() if env_path else None,
        Path.home() / "Documents" / "open_words",
        Path(__file__).resolve().parents[2] / "open_words",
    ]

    for candidate in candidates:
        if candidate and (candidate / "open_words" / "parse.py").exists():
            return candidate.resolve()

    raise SystemExit(
        "Could not find open_words. Set OPEN_WORDS_PATH to the folder containing open_words/parse.py."
    )


def write_json(path: Path, data: object) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def main() -> None:
    root = find_open_words_root()
    sys.path.insert(0, str(root))

    from open_words.addons import LatinAddons
    from open_words.dict_line import WordsDict
    from open_words.inflects import Inflects
    from open_words.stem_list import Stems
    from open_words.uniques import Uniques

    out_dir = Path(__file__).resolve().parents[1] / "public" / "open-words"
    out_dir.mkdir(parents=True, exist_ok=True)

    write_json(out_dir / "words.json", WordsDict)
    write_json(out_dir / "stems.json", Stems)
    write_json(out_dir / "inflects.json", Inflects)
    write_json(out_dir / "uniques.json", Uniques)
    write_json(out_dir / "addons.json", LatinAddons)

    metadata = {
        "source": str(root),
        "counts": {
            "words": len(WordsDict),
            "stems": len(Stems),
            "inflects": len(Inflects),
            "uniques": len(Uniques),
        },
    }
    write_json(out_dir / "metadata.json", metadata)

    print(f"Exported Open Words data to {out_dir}")


if __name__ == "__main__":
    main()
